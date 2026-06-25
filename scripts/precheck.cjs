#!/usr/bin/env node
/*
 * context-economy / precheck.cjs
 * Separates SAFETY (can it write?) from ROI (is it worth it?).
 *   node precheck.cjs [project-dir]
 */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { recentProjects, decodeProjectDir } = require('./lib/paths.cjs');
const { findClaudeMd, findHandoff, countLines } = require('./lib/project-scan.cjs');

const target = path.resolve(process.argv[2] || process.cwd());
const QUIET_MIN = 10;
const IGNORE = new Set(['.git', 'node_modules', '.next', 'dist', 'build', '.firebase', '.turbo', 'coverage', '.cache', 'out', '.vercel']);
const BUILD_HINT = /\.next|\.firebase|\.turbo|dist|build|coverage|\.cache/;

function gitStatus(dir) {
  try {
    const o = cp.execSync('git -C "' + dir + '" status --short', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const lines = o.split('\n').filter(l => l.trim());
    return { isRepo: true, dirty: lines.length, lines: lines.slice(0, 6) };
  } catch { return { isRepo: false, dirty: 0, lines: [] }; }
}

function newestEditMin(dir) {
  let newest = 0, buildOnly = true;
  (function walk(d, lvl) {
    if (lvl > 7) return;
    let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) { if (!IGNORE.has(e.name)) walk(full, lvl + 1); }
      else {
        let m; try { m = fs.statSync(full).mtimeMs; } catch { continue; }
        if (m > newest) { newest = m; buildOnly = BUILD_HINT.test(full); }
      }
    }
  })(dir, 0);
  if (!newest) return { min: null, buildOnly: true };
  return { min: (Date.now() - newest) / 60000, buildOnly };
}

const scopeMismatch = path.resolve(process.cwd()) !== target;
const git = gitStatus(target);
const edit = newestEditMin(target);
const claudePath = findClaudeMd(target);
const claudeLines = claudePath ? countLines(claudePath) : 0;
const handoff = findHandoff(target);

// ── Safety ──
let safety = 0;
const safetySignals = [];
if (scopeMismatch) { safety += 25; safetySignals.push(['scope', 'session outside ' + target, 25]); }
if (git.dirty > 0) { safety += 25; safetySignals.push(['git dirty', git.dirty + ' file(s)', 25]); }
if (edit.min != null && !edit.buildOnly) {
  const w = edit.min < 3 ? 45 : edit.min < 10 ? 30 : edit.min < 30 ? 15 : edit.min < 120 ? 5 : 0;
  if (w) { safety += w; safetySignals.push(['recent edit', '~' + Math.round(edit.min) + ' min', w]); }
}
if (edit.min != null && edit.buildOnly && edit.min < 5) {
  safety += 10;
  safetySignals.push(['dev server', 'build artifacts active', 10]);
}
safety = Math.min(95, safety);

// ── ROI ──
let roi = 0;
const roiSignals = [];
if (!claudePath) { roi += 25; roiSignals.push(['no CLAUDE.md', 'create boot loader', 25]); }
else if (claudeLines > 200) { roi += 30; roiSignals.push(['CLAUDE.md bloated', claudeLines + ' lines', 30]); }
else if (claudeLines > 100) { roi += 20; roiSignals.push(['CLAUDE.md large', claudeLines + ' lines', 20]); }
else if (claudeLines > 60) { roi += 10; roiSignals.push(['CLAUDE.md above target', claudeLines + ' lines', 10]); }
if (!handoff) { roi += 15; roiSignals.push(['no handoff', 'create ANDAMENTO/STATUS', 15]); }
roi = Math.min(95, roi);

const safetyVerdict = safety >= 50 ? '🔴 unsafe'
  : safety >= 25 ? '🟡 confirm'
  : '🟢 safe';

const roiVerdict = roi >= 40 ? '🟢 high ROI'
  : roi >= 20 ? '🟡 medium ROI'
  : '⚪ low ROI (already lean)';

const cond = [];
if (scopeMismatch) cond.push('session INSIDE ' + target);
if (git.dirty > 0) cond.push('git clean');
const quietETA = (edit.min != null && edit.min < QUIET_MIN) ? Math.ceil(QUIET_MIN - edit.min) : 0;
if (quietETA > 0) cond.push('repo quiet ~' + quietETA + ' min');
else cond.push('repo quiet for ' + (edit.min == null ? '∞' : Math.round(edit.min)) + ' min');

console.log('🧭 context-economy · precheck');
console.log('   project: ' + target);
console.log('');
console.log('   SAFETY: ' + safetyVerdict + '  ("don\'t write": ' + safety + '%)');
for (const s of safetySignals) console.log('     • ' + s[0] + ': ' + s[1] + ' (+' + s[2] + '%)');
if (!safetySignals.length) console.log('     • no blockers');
console.log('');
console.log('   ROI: ' + roiVerdict + '  (potential: ' + roi + '%)');
for (const s of roiSignals) console.log('     • ' + s[0] + ': ' + s[1] + ' (+' + s[2] + '%)');
if (!roiSignals.length) console.log('     • boot loader already lean — focus on /clear discipline');
console.log('');
console.log('   ⏰ ideal: ' + cond.join(' · '));

if (scopeMismatch) {
  console.log('');
  console.log('   💡 recent projects in the logs:');
  for (const p of recentProjects(3)) {
    const guess = decodeProjectDir(p.name);
    console.log('      • ' + (guess || p.name));
  }
}

const canWrite = safety < 50;
const worthIt = roi >= 20;
console.log('');
console.log('   ⮕ ' + (canWrite ? (worthIt ? 'CAN run — high expected return' : 'CAN run — marginal gain, only review stale') : 'DO NOT write — resolve safety first'));