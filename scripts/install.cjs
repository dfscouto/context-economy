#!/usr/bin/env node
/*
 * context-economy v3 / install.cjs
 * Installs the 2 light SessionStart hooks and removes the heavy v2 machinery
 * (Stop/PostToolUse + session-init/handoff-append/clear-moment/track-tool).
 *   node install.cjs [--dry-run]
 *
 * SAFE: never overwrites an existing settings.json that has invalid JSON —
 * that would erase permissions/env/model/statusline. Makes a .bak backup and writes atomically.
 */
const fs = require('fs');
const path = require('path');
const { skillDir, settingsPath } = require('./lib/paths.cjs');

const DEAD = /session-init|handoff-append|clear-moment|track-tool/; // scripts removed in v3

// Reads settings distinguishing "doesn't exist" (→ {} is correct, clean install) from
// "exists but invalid" (→ THROWS; never silently return {}, which would lead to overwriting).
function readSettings(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return {}; // doesn't exist yet
    throw e;                            // real I/O error (permission, lock) → don't proceed
  }
  if (!raw.trim()) return {};           // empty → {} ok
  try {
    const clean = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw; // tolerates BOM
    return JSON.parse(clean);
  } catch (e) {
    const err = new Error(
      'settings.json exists but is invalid JSON (' + e.message + '). ' +
      'I will NOT overwrite it to avoid losing your configs (permissions/env/model). ' +
      'Fix the JSON and run again.');
    err.code = 'EINVALIDJSON';
    throw err;
  }
}

// Writes with a .bak backup (of the previous content, if any) and atomically (tmp + rename),
// so the file isn't corrupted if the process dies mid-write.
function writeSettingsAtomic(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    const prev = fs.readFileSync(file, 'utf8');
    if (prev.trim()) fs.writeFileSync(file + '.bak', prev);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e; // no backup only if the file didn't exist
  }
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

// removes from ALL events any of our hooks that point to a script that's dead in v3
function purgeDead(hooks) {
  for (const ev of Object.keys(hooks)) {
    hooks[ev] = (hooks[ev] || [])
      .map(b => ({ ...b, hooks: (b.hooks || []).filter(h => !DEAD.test(h.command || '')) }))
      .filter(b => (b.hooks || []).length);
    if (!hooks[ev].length) delete hooks[ev];
  }
}

function upsert(list, matcher, command) {
  const e = matcher != null ? list.find(x => x.matcher === matcher) : list.find(x => x.matcher == null);
  const hook = { type: 'command', command };
  if (e) { e.hooks = e.hooks || []; if (!e.hooks.some(h => h.command === command)) e.hooks.push(hook); }
  else { const b = { hooks: [hook] }; if (matcher != null) b.matcher = matcher; list.push(b); }
}

function main() {
  const DRY = process.argv.includes('--dry-run');
  const SD = skillDir();
  const nodeCmd = s => 'node ' + JSON.stringify(path.join(SD, 'scripts', s));
  const file = settingsPath();

  let settings;
  try {
    settings = readSettings(file);
  } catch (e) {
    console.error('❌ context-economy · install ABORTED');
    console.error('   ' + e.message);
    console.error('   file: ' + file);
    process.exitCode = 1;
    return;
  }

  settings.hooks = settings.hooks || {};
  purgeDead(settings.hooks);

  const usage = nodeCmd('usage.cjs'), dashboard = nodeCmd('dashboard.cjs');
  settings.hooks.SessionStart = settings.hooks.SessionStart || [];
  upsert(settings.hooks.SessionStart, 'clear', usage);  // /clear -> usage summary + bloat
  upsert(settings.hooks.SessionStart, null, dashboard); // every session -> regenerates data.js

  console.log('⚙️  context-economy v3 · install' + (DRY ? ' (dry-run)' : ''));
  console.log('   light hooks: SessionStart(clear)->usage · SessionStart->dashboard');
  console.log('   removed: Stop/PostToolUse + session-init/handoff/clear-moment/track-tool');
  if (DRY) { console.log('   (dry-run: nothing written)'); return; }

  writeSettingsAtomic(file, settings);
  console.log('   ✅ settings.json updated (backup in settings.json.bak). Restart Claude Code.');
  console.log('   📊 dashboard: open ' + path.join(SD, 'dashboard', 'index.html') + ' in the browser');
  console.log('      (spend/day + which skills cost the most per session · all local)');
}

if (require.main === module) main();
module.exports = { readSettings, writeSettingsAtomic, purgeDead, upsert };
