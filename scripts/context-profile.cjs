#!/usr/bin/env node
/**
 * context-profile.cjs — where do YOUR context tokens actually go?
 *
 * Reads your Claude Code transcripts and breaks the conversation content down by
 * SOURCE (images, PDFs, command logs, file reads, search, web, subagents, MCP…),
 * flags recoverable waste (re-reads, whole-file reads), and prints a per-profile
 * verdict: your biggest *controllable* leak + the specific fix for it.
 *
 * Everyone's pain is different — one person bleeds on screenshots, another on PDF
 * reads, another on build logs. This points at YOURS instead of giving everyone
 * the same generic "compress your logs" advice.
 *
 * Local only. Zero AI tokens. Token figures are estimates (chars ÷ 4) over the
 * conversation CONTENT in transcripts (≈ what accumulates and is re-read each
 * turn). It does NOT include the fixed per-session boot context (system prompt +
 * tool schemas + MCP), which is separate and mostly not yours to trim.
 *
 * Usage:
 *   node scripts/context-profile.cjs                 # most recent project, recent sessions
 *   node scripts/context-profile.cjs --files 8       # scan more session files
 *   node scripts/context-profile.cjs --project C--code-foo
 *   node scripts/context-profile.cjs --all           # every project
 *   node scripts/context-profile.cjs --json
 */
const path = require('path');
const { projectsRoot, recentProjects } = require('./lib/paths.cjs');
const { listJsonlFiles, isTopLevelSessionFile } = require('./lib/log-scan.cjs');
const { CHARS_PER_TOK, emptyAcc, scanFiles, summarize, pctOf } = require('./lib/profile-scan.cjs');

const ktok = chars => Math.round(chars / CHARS_PER_TOK / 1000);

function bar(pct, width = 24) {
  const n = Math.max(0, Math.min(width, Math.round((pct / 100) * width)));
  return '█'.repeat(n) + '·'.repeat(width - n);
}

async function main() {
  const args = process.argv.slice(2);
  const get = (flag, def) => { const i = args.indexOf(flag); return i >= 0 ? (args[i + 1] || def) : def; };
  const wantJson = args.includes('--json');
  const all = args.includes('--all');
  const filesN = parseInt(get('--files', '6'), 10) || 6;
  const projArg = get('--project', null);

  let projects;
  if (all) projects = recentProjects(50);
  else if (projArg) projects = [{ name: projArg, path: path.join(projectsRoot(), projArg) }];
  else projects = recentProjects(1);
  if (!projects.length) { console.error('No transcripts found under ~/.claude/projects.'); process.exit(1); }

  const acc = emptyAcc();
  let filesScanned = 0;
  const scannedProjects = [];
  for (const p of projects) {
    const files = listJsonlFiles(p.path).filter(f => isTopLevelSessionFile(p.path, f)).slice(0, all ? 3 : filesN);
    if (files.length) scannedProjects.push(p.name);
    await scanFiles(files, acc);
    filesScanned += files.length;
  }

  const { totalTok, rows, waste, dom } = summarize(acc);

  if (wantJson) {
    console.log(JSON.stringify({ totalTok, filesScanned, projects: scannedProjects, rows, waste, profile: dom ? dom.profile : null }, null, 2));
    return;
  }

  console.log('\n  CONTEXT PROFILE — where your conversation tokens go');
  console.log('  ' + '─'.repeat(58));
  console.log(`  scanned ${filesScanned} session file(s) · ${scannedProjects.slice(0, 3).join(', ')}${scannedProjects.length > 3 ? '…' : ''}`);
  console.log(`  measured content ≈ ${totalTok.toLocaleString()} tokens (estimate, chars÷4)\n`);

  for (const r of rows) {
    const flag = r.ctrl === 'yes' ? '◀ trimmable' : r.ctrl === 'partly' ? '◀ partly' : '';
    console.log(`  ${r.label.padEnd(30)} ${String(r.pct).padStart(5)}%  ${bar(r.pct)}  ${flag}`);
  }

  if (acc.reads.length) {
    console.log('\n  Read waste (recoverable):');
    console.log(`    re-reads of the same file : ~${ktok(waste.reread)}k tok (${pctOf(waste.reread, acc.total)}% of ctx) · code-only ${pctOf(waste.rereadCode, acc.total)}%`);
    console.log(`    whole-file reads (no range): ~${ktok(waste.fullFile)}k tok (${pctOf(waste.fullFile, acc.total)}% of ctx) · code-only ${pctOf(waste.fullFileCode, acc.total)}%`);
  }

  console.log('\n  ' + '─'.repeat(58));
  if (dom) {
    console.log(`  YOUR PROFILE: ${dom.profile}  (${dom.label} = ${dom.pct}% of context)`);
    console.log('  FIX: ' + dom.tip);
  } else {
    console.log('  No single controllable leak dominates — your context is lean.');
  }
  console.log('\n  Note: this is conversation content only. The fixed per-session boot');
  console.log('  context (system + tools + MCP) is separate — trim that with list-bloat.cjs.');
  console.log('  Biggest lever overall is still /clear at task boundaries (avoids re-reading');
  console.log('  the whole accumulated context every turn).\n');
}

main().catch(e => { console.error(e); process.exit(1); });
