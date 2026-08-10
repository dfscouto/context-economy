#!/usr/bin/env node
/**
 * context-economy · session-meter — Stop hook.
 *
 * After each Claude response prints a compact line based on the LIVE context
 * window (what actually decides /clear), not accumulated billing:
 *   🟡 ~112k context · session warming up
 *   🟠 ~145k context · consider /clear when this task is done
 *   🔴 ~190k context · /clear recommended
 *
 * Fires when the window crosses UP into a new tier (state kept per session in
 * tmp, so it never spams the same tier), when it keeps growing +20k inside the
 * red tier, or when a NEW screenshot lands (heaviest per-event cost).
 *
 * The window = input + cache_read + cache_creation of the last request — the
 * real size of what's in context this turn. Earlier versions gated on
 * `turns % 10`, but `turns` counted every assistant block (many per response)
 * and jumped in irregular steps, so it almost never landed on a multiple of 10
 * and the meter stayed silent through huge sessions. See CHANGELOG v1.2.1.
 *
 * Emitted as {systemMessage} so the UI shows it; plain stdout on Stop hooks is
 * silently dropped in most setups. Disable for one session: CE_METER=off
 */
'use strict';
const fs       = require('fs');
const path     = require('path');
const os       = require('os');
const readline = require('readline');
const { resolveLogDir } = require('./lib/paths.cjs');

function fmt(n) {
  return n >= 1e9 ? (n / 1e9).toFixed(1) + 'b'
       : n >= 1e6 ? (n / 1e6).toFixed(1) + 'm'
       : n >= 1e3 ? (n / 1e3).toFixed(0) + 'k'
       : String(n | 0);
}

async function readSession(filePath) {
  let screenshots = 0, win = 0;
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    const m = o.message || o;
    if ((m.role || o.type) === 'assistant' && Array.isArray(m.content)) {
      for (const item of m.content) {
        if (item.type !== 'tool_use') continue;
        const isShot = /screenshot/i.test(item.name || '')
          || (/__computer/i.test(item.name || '') && /^(screenshot|zoom)$/i.test(String((item.input || {}).action || '')));
        if (isShot) screenshots++;
      }
    }
    // Live context window = the last request's real footprint. Keep the latest
    // (not max): after a /compact or auto-compact the window shrinks and we want
    // to reflect that. Ignore records with no meaningful usage.
    const u = (o.message && o.message.usage) || o.usage;
    if (u && ((u.input_tokens || 0) + (u.cache_read_input_tokens || 0) > 100)) {
      win = (u.input_tokens || 0)
          + (u.cache_read_input_tokens || 0)
          + (u.cache_creation_input_tokens || 0);
    }
  }
  return { win, screenshots };
}

// Live-window tiers (tokens). 0 = quiet. Tuned for a ~200k context limit.
function tierOf(win) {
  if (win >= 180000) return 3;
  if (win >= 140000) return 2;
  if (win >= 100000) return 1;
  return 0;
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

function meterLine(win, screenshots, tier) {
  const ctx = '~' + fmt(win) + ' context';
  const shots = screenshots > 0 ? ' · 📸 ' + screenshots + ' screenshots' : '';
  if (tier >= 3) return '🔴 ' + ctx + shots + ' · /clear recommended';
  if (tier >= 2) return '🟠 ' + ctx + shots + ' · consider /clear when this task is done';
  return              '🟡 ' + ctx + shots + ' · session warming up';
}

// Fire when the window crosses UP into a new tier, keeps growing +20k while
// already red, or a new screenshot lands (tier >= warming). Never re-announces a
// flat tier. Pure so it can be unit-tested without stdin/tmp/spawn.
function shouldShow(tier, win, screenshots, last) {
  const newShots = screenshots > last.shots;
  const grewInRed = tier >= 3 && win >= last.win + 20000;
  return tier > last.tier || grewInRed || (newShots && tier >= 1);
}

module.exports = { tierOf, meterLine, shouldShow, readSession };

if (require.main !== module) return;

let raw = '';
process.stdin.on('data', d => (raw += d));
process.stdin.on('end', async () => {
  try {
    if (process.env.CE_METER === 'off') return;
    let payload = {};
    try { payload = JSON.parse(raw); } catch {}
    const fp = findSession(payload.transcript_path, payload.cwd);
    if (!fp) return;
    const { win, screenshots } = await readSession(fp);
    const tier = tierOf(win);

    // Per-session state in tmp: last tier announced, last window at announce, last
    // screenshot count. Screenshots are the heaviest per-event cost (~500k–2M tok,
    // re-read every turn), so a NEW one forces a report regardless of tier.
    const sid = String(payload.session_id || path.basename(fp, '.jsonl')).replace(/[^a-zA-Z0-9_-]/g, '_');
    const stateFile = path.join(os.tmpdir(), 'ce-meter-' + sid + '.json');
    let last = { tier: 0, win: 0, shots: 0 };
    try { last = { ...last, ...JSON.parse(fs.readFileSync(stateFile, 'utf8')) }; } catch {}

    if (!shouldShow(tier, win, screenshots, last)) {
      // Still record screenshots so the next real report has an accurate count.
      if (screenshots > last.shots) { try { fs.writeFileSync(stateFile, JSON.stringify({ ...last, shots: screenshots })); } catch {} }
      return;
    }
    try { fs.writeFileSync(stateFile, JSON.stringify({ tier, win, shots: screenshots })); } catch {}

    // systemMessage is the only Stop-hook field guaranteed to surface in the UI;
    // plain stdout is dropped silently in most setups.
    process.stdout.write(JSON.stringify({ systemMessage: meterLine(win, screenshots, tier) }));
  } catch { /* never block Claude on a meter error */ }
});
