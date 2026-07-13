#!/usr/bin/env node
/**
 * context-economy · session-meter — Stop hook.
 *
 * After each Claude response prints a compact line:
 *   ⏱ 10 turns · ~120k billed
 *   🟡 20 turns · ~300k billed · session warming up
 *   🟠 50 turns · ~800k billed · consider /clear when this task is done
 *   🔴 100 turns · ~1.8m billed · /clear recommended
 *
 * Shows at turn 10, then every 10 turns — plus immediately when a NEW screenshot
 * lands (heaviest per-event cost). Emitted as {systemMessage} so the UI shows it;
 * plain stdout on Stop hooks is silently dropped in most setups.
 * Disable for one session: CE_METER=off
 */
'use strict';
const fs       = require('fs');
const path     = require('path');
const os       = require('os');
const readline = require('readline');
const { resolveLogDir } = require('./lib/paths.cjs');

const CR = 0.1, CW = 1.25;

function fmt(n) {
  return n >= 1e9 ? (n / 1e9).toFixed(1) + 'b'
       : n >= 1e6 ? (n / 1e6).toFixed(1) + 'm'
       : n >= 1e3 ? (n / 1e3).toFixed(0) + 'k'
       : String(n | 0);
}

async function readSession(filePath) {
  let turns = 0, billed = 0, screenshots = 0;
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    const m = o.message || o;
    if ((m.role || o.type) === 'assistant') {
      turns++;
      if (Array.isArray(m.content)) {
        for (const item of m.content) {
          if (item.type !== 'tool_use') continue;
          const isShot = /screenshot/i.test(item.name || '')
            || (/__computer/i.test(item.name || '') && /^(screenshot|zoom)$/i.test(String((item.input || {}).action || '')));
          if (isShot) screenshots++;
        }
      }
    }
    const u = (o.message && o.message.usage) || o.usage;
    if (u) {
      billed += (u.input_tokens || 0)
              + (u.output_tokens || 0)
              + (u.cache_creation_input_tokens || 0) * CW
              + (u.cache_read_input_tokens  || 0) * CR;
    }
  }
  return { turns, billed, screenshots };
}

function findSession(transcriptPath, cwd) {
  if (transcriptPath) {
    try { if (fs.existsSync(transcriptPath)) return transcriptPath; } catch {}
  }
  // fallback: most recently modified .jsonl in the project log dir
  const logDir = resolveLogDir(cwd || process.cwd());
  if (!logDir) return null;
  try {
    const files = fs.readdirSync(logDir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => { const fp = path.join(logDir, f); return { fp, mt: fs.statSync(fp).mtimeMs }; })
      .sort((a, b) => b.mt - a.mt);
    return files.length ? files[0].fp : null;
  } catch { return null; }
}

function meterLine(turns, billed, screenshots) {
  const cost = '~' + fmt(billed) + ' billed';
  const shots = screenshots > 0 ? ' · 📸 ' + screenshots + ' screenshots' : '';
  if (turns >= 100) return '🔴 ' + turns + ' turns · ' + cost + shots + ' · /clear recommended (very long session)';
  if (turns >= 50)  return '🟠 ' + turns + ' turns · ' + cost + shots + ' · consider /clear when this task is done';
  if (turns >= 20)  return '🟡 ' + turns + ' turns · ' + cost + shots + ' · session warming up';
  return                   '⏱  ' + turns + ' turns · ' + cost + shots;
}

let raw = '';
process.stdin.on('data', d => (raw += d));
process.stdin.on('end', async () => {
  try {
    if (process.env.CE_METER === 'off') return;
    let payload = {};
    try { payload = JSON.parse(raw); } catch {}
    const fp = findSession(payload.transcript_path, payload.cwd);
    if (!fp) return;
    const { turns, billed, screenshots } = await readSession(fp);
    if (turns === 0) return;

    // Screenshots are the single heaviest per-event cost (~500k–2M tok each, re-read every
    // turn), so a NEW screenshot forces an early report instead of waiting for the next
    // multiple of 10. State: last screenshot count reported, per session, in tmp.
    const sid = String(payload.session_id || path.basename(fp, '.jsonl')).replace(/[^a-zA-Z0-9_-]/g, '_');
    const stateFile = path.join(os.tmpdir(), 'ce-meter-' + sid + '.json');
    let lastShots = 0;
    try { lastShots = JSON.parse(fs.readFileSync(stateFile, 'utf8')).shots || 0; } catch {}
    const newShots = screenshots > lastShots;

    if (turns % 10 !== 0 && !newShots) return; // show at 10, 20, 30 … or on a new screenshot
    try { fs.writeFileSync(stateFile, JSON.stringify({ shots: screenshots })); } catch {}

    // systemMessage is the only Stop-hook field guaranteed to surface in the UI;
    // plain stdout is dropped silently in most setups.
    process.stdout.write(JSON.stringify({ systemMessage: meterLine(turns, billed, screenshots) }));
  } catch { /* never block Claude on a meter error */ }
});
