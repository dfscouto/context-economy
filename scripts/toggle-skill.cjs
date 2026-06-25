#!/usr/bin/env node
/*
 * Enable/disable a Claude Code skill (moves between ~/.claude/skills and skills.disabled).
 *   node toggle-skill.cjs off course-builder
 *   node toggle-skill.cjs on course-builder
 */
const { toggleSkill } = require('./lib/skill-toggle.cjs');

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const action = args[0];
const folder = args[1];

if (!action || !folder || !['on', 'off'].includes(action)) {
  console.error('Usage: node toggle-skill.cjs <on|off> <skill-folder>');
  process.exit(1);
}

try {
  const res = toggleSkill(folder, action === 'on');
  console.log((res.enabled ? '✅ enabled' : '⏸ disabled') + ': ' + res.folder);
  console.log('Restart Claude Code to apply.');
} catch (e) {
  console.error('Error:', e.message);
  process.exit(1);
}