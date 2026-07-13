#!/usr/bin/env node
/*
 * Enable/disable a LOCAL MCP server (the ones configured in ~/.claude.json → mcpServers).
 *   node toggle-mcp.cjs off playwright
 *   node toggle-mcp.cjs on playwright
 *   node toggle-mcp.cjs list
 *
 * Disabling moves the entry to `mcpServersDisabled` (a key Claude Code ignores) —
 * reversible, nothing is deleted. Writes atomically with a .bak backup, and never
 * touches a ~/.claude.json that fails to parse.
 *
 * ⚠️ Platform-managed connectors (claude.ai) do NOT live in this file — those can
 * only be toggled inside Claude Code with /mcp or at claude.ai settings.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const FILE = path.join(os.homedir(), '.claude.json');

function readConfig() {
  const raw = fs.readFileSync(FILE, 'utf8');
  const clean = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;
  return JSON.parse(clean); // throws on invalid JSON → we abort instead of overwriting
}

function writeAtomic(obj) {
  const prev = fs.readFileSync(FILE, 'utf8');
  fs.writeFileSync(FILE + '.bak', prev);
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  fs.renameSync(tmp, FILE);
}

function main() {
  const [action, name] = process.argv.slice(2).filter(a => !a.startsWith('--'));

  let cfg;
  try { cfg = readConfig(); } catch (e) {
    console.error('❌ ~/.claude.json unreadable or invalid JSON — aborting without writing (' + e.message + ')');
    process.exit(1);
  }
  const on = cfg.mcpServers || {};
  const off = cfg.mcpServersDisabled || {};

  if (action === 'list' || !action) {
    console.log('local MCP servers (~/.claude.json):');
    for (const k of Object.keys(on)) console.log('  🟢 ' + k);
    for (const k of Object.keys(off)) console.log('  ⏸️  ' + k + ' (disabled)');
    if (!Object.keys(on).length && !Object.keys(off).length) console.log('  (none — your MCPs are platform-managed: toggle with /mcp)');
    return;
  }

  if (!name || !['on', 'off'].includes(action)) {
    console.error('Usage: node toggle-mcp.cjs <on|off|list> [server-name]');
    process.exit(1);
  }

  if (action === 'off') {
    if (!on[name]) {
      console.error('❌ "' + name + '" not in mcpServers. Local servers: ' + (Object.keys(on).join(', ') || '(none)'));
      console.error('   Platform-managed connectors can only be toggled with /mcp inside Claude Code.');
      process.exit(1);
    }
    cfg.mcpServersDisabled = { ...off, [name]: on[name] };
    delete on[name];
    cfg.mcpServers = on;
  } else {
    if (!off[name]) {
      console.error('❌ "' + name + '" not in mcpServersDisabled. Disabled: ' + (Object.keys(off).join(', ') || '(none)'));
      process.exit(1);
    }
    cfg.mcpServers = { ...on, [name]: off[name] };
    delete off[name];
    cfg.mcpServersDisabled = off;
    if (!Object.keys(off).length) delete cfg.mcpServersDisabled;
  }

  writeAtomic(cfg);
  console.log((action === 'off' ? '⏸️  disabled' : '✅ enabled') + ': ' + name + ' (backup in ~/.claude.json.bak)');
  console.log('Restart Claude Code to apply.');
}

main();
