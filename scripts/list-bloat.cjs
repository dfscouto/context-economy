#!/usr/bin/env node
/*
 * context-economy / list-bloat.cjs
 * Inventories skills + MCPs loaded into the prompt and suggests what to disable.
 *
 *   node list-bloat.cjs [project-dir]
 *   node list-bloat.cjs --json [project-dir]
 *   node list-bloat.cjs --compact   # one line (SessionStart hook)
 *   node list-bloat.cjs --off       # ready-to-paste commands: disable/re-enable the 0× skills
 */
const { scanBloat, KEEP_ALWAYS } = require('./lib/bloat-scan.cjs');

const JSON_OUT = process.argv.includes('--json');
const COMPACT = process.argv.includes('--compact');
const OFF = process.argv.includes('--off');
const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const projectDir = args[0] || process.cwd();

const SEV = { high: '🔴', medium: '🟡', low: '⚪' };

// ── redundant-MCP detector ─────────────────────────────────────────────────────
// Servers in the same functional category overlap: each one pads EVERY session's
// prompt, but a task only ever drives one of them. ≥2 active in a category →
// recommend keeping one and disabling the rest (via /mcp for managed connectors).
const MCP_CATEGORIES = [
  { label: 'browser/desktop automation', re: /playwright|chrome|browser|puppeteer|selenium|computer.?use|preview/i },
  { label: 'web search/fetch',           re: /firecrawl|brave|tavily|serp|websearch|fetch/i },
];

function detectRedundantMcp(servers) {
  const active = (servers || []).filter(s =>
    s.status === 'active' || s.status === 'enabled-project' || s.status === 'project-file');
  const groups = [];
  for (const cat of MCP_CATEGORIES) {
    const hits = active.filter(s => cat.re.test(String(s.name || '')));
    if (hits.length >= 2) {
      groups.push({
        label: cat.label,
        servers: hits.slice().sort((a, b) => (b.estHi || b.estTokens || 0) - (a.estHi || a.estTokens || 0)),
      });
    }
  }
  return groups;
}

function printRedundantMcp(groups) {
  if (!groups.length) return;
  console.log('── Redundant MCPs (same category loaded ≥2×) ──');
  for (const g of groups) {
    const tot = g.servers.reduce((a, s) => a + (s.estHi || s.estTokens || 0), 0);
    console.log(`   🔁 ${g.label}: ${g.servers.length} servers ≈ up to ${tot.toLocaleString()} tok/session combined`);
    for (const s of g.servers) {
      const tok = s.estBasis === 'tools' ? `~${s.estTokens}–${s.estHi} tok` : `~${s.estTokens} tok`;
      console.log(`      • ${s.name} (${tok})`);
    }
    console.log('      → keep ONE, disable the rest: /mcp in Claude Code (managed) or node toggle-mcp.cjs off <name> (local)');
  }
  console.log('');
}

function printHuman(data) {
  const { skills, mcp, recommendations, summary } = data;

  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  context-economy · skills/MCP inventory            ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');
  console.log('Each active skill/MCP enters the system prompt (~tokens/session).');
  console.log('Disable = move the folder out of the scan or remove it from ~/.claude.json.');
  console.log('');

  console.log('── Summary ──');
  console.log(`   Claude Code skills: ${summary.skillCounts['claude-code']} (prompt)`);
  if (summary.skillCounts.managed) {
    console.log(`   managed skills:      ${summary.skillCounts.managed} (platform plugins, ≥1 use — not measurable offline; there are other unused invisible ones)`);
  }
  console.log(`   Cursor/Grok skills:  ${summary.skillCounts.cursor + summary.skillCounts.grok + summary.skillCounts['grok-bundled']} (other IDE)`);
  console.log(`   active MCPs:         ${summary.mcpCounts.active}${summary.mcpCounts.fromSession ? ` (${summary.mcpCounts.fromSession} seen in the session log)` : ''}`);
  console.log(`   estimate:            ~${summary.estTokensPerSession.toLocaleString()}–${summary.estTokensPerSessionHi.toLocaleString()} tok/session`);
  console.log(`     • skills: ~${summary.estSkillTokens.toLocaleString()} (name+description)`);
  console.log(`     • MCP:    ~${summary.estMcpTokens.toLocaleString()}–${summary.estMcpTokensHi.toLocaleString()} (floor = only deferred tool names · ceiling = inline schemas)`);
  console.log(`   recommendations:     ${summary.recommendations} (${summary.high} high priority)`);
  console.log('');

  if (mcp.servers.length) {
    console.log('── MCPs ──');
    for (const s of mcp.servers.slice().sort((a, b) => b.estTokens - a.estTokens)) {
      const st = s.status === 'disabled-project' ? '⏸️ ' : '🟢';
      const tools = s.toolCount != null ? `${s.toolCount} tools` : 'tools? (not in log)';
      const tok = s.estBasis === 'tools' ? `~${s.estTokens}–${s.estHi} tok` : `~${s.estTokens} tok (floor)`;
      console.log(`   ${st} ${s.name}  [${s.scope}]  ${tools} · ${tok}`);
    }
    console.log('   ⚠️ local MCP = only ~/.claude.json + .mcp.json. The managed connectors (claude.ai/');
    console.log('      enterprise) don\'t live in a file — these come from the LOG of the last session (best effort).');
    console.log('');
    printRedundantMcp(detectRedundantMcp(mcp.servers));
  }

  const claude = skills.filter(s => s.env === 'claude-code').sort((a, b) => b.estTokens - a.estTokens);
  console.log('── Claude Code skills (top 15 by size in the prompt) ──');
  for (const s of claude.slice(0, 15)) {
    const use = s.neverUsed ? '0×' : `${s.usageCount}×`;
    const stale = s.daysSinceUse != null ? ` · ${s.daysSinceUse}d` : '';
    console.log(`   ${s.estTokens.toString().padStart(4)} tok  ${use.padEnd(4)}${stale}  ${s.folder}`);
  }
  if (claude.length > 15) {
    console.log(`   … +${claude.length - 15} skills (run --json for the full list)`);
  }
  console.log('');

  if (recommendations.length) {
    console.log('── Disable / trim ──');
    const order = { high: 0, medium: 1, low: 2 };
    const sorted = [...recommendations].sort((a, b) => order[a.severity] - order[b.severity]);
    for (const r of sorted.slice(0, 12)) {
      console.log(`   ${SEV[r.severity]} [${r.kind}] ${r.id}`);
      console.log(`      ${r.reason}`);
      console.log(`      → ${r.action}`);
    }
    if (sorted.length > 12) {
      console.log(`   … +${sorted.length - 12} (run --json)`);
    }
    console.log('');
  }

  console.log('── How to disable ──');
  console.log('   Skills:  node list-bloat.cjs --off   (ready-to-paste commands: disable/re-enable the 0×)');
  console.log('   MCP:     /mcp in Claude Code (toggle) or remove from ~/.claude.json → mcpServers');
  console.log('   Cursor:  Settings → MCP → disable server');
  console.log('');
}

function printCompact(data) {
  const { summary, recommendations } = data;
  const high = recommendations.filter(r => r.severity === 'high');
  const n = summary.skillCounts['claude-code'];
  const m = summary.mcpCounts.active;
  const lo = summary.estTokensPerSession;
  const hi = summary.estTokensPerSessionHi;
  if (n < 25 && m <= 1 && high.length === 0) return;
  const hint = high.length
    ? `disable: ${high.map(r => r.id).slice(0, 3).join(', ')}`
    : 'run list-bloat.cjs --off to disable the never-used ones';
  const range = hi > lo ? `${lo.toLocaleString()}–${hi.toLocaleString()}` : `${lo.toLocaleString()}`;
  console.log(`📦 context-economy · ${n} skills + ${m} MCP ≈ ${range} tok/session · ${hint}`);
}

// Ready-to-paste commands to disable/re-enable the 0× skills (moves to ~/.claude/skills.disabled,
// OUTSIDE the scanned folder — proof against recursive scan. Reversible: it's a move, not a delete).
function printOff(data) {
  const { skills, mcp } = data;
  const off = skills
    .filter(s => s.env === 'claude-code' && s.neverUsed && !KEEP_ALWAYS.has(s.folder) && !KEEP_ALWAYS.has(s.name))
    .map(s => s.folder)
    .sort();
  const activeMcp = mcp.servers.filter(s =>
    s.status === 'active' || s.status === 'enabled-project' || s.status === 'project-file');

  console.log('');
  console.log('── Disable never-used skills (0×) — ready-to-paste commands ──');
  if (!off.length) {
    console.log('   No 0× skills to disable. 👍');
  } else {
    console.log('   Candidates (0× in logs): ' + off.join(', '));
    console.log('   They go to ~/.claude/skills.disabled/ (outside the scan, bulletproof). Reversible.');
    console.log("   ⚠️ '0×' = never triggered, not necessarily useless — some are generic capabilities");
    console.log('      (e.g. test-driven-development) worth keeping on standby. Curation is yours: edit the list.');
    console.log('      Restart Claude Code afterwards.');
    console.log('');
    if (process.platform === 'win32') {
      const ps = off.map(f => '"' + f + '"').join(',');
      console.log('   # PowerShell · DISABLE');
      console.log('   $b="$env:USERPROFILE\\.claude"; $o="$b\\skills.disabled"; New-Item -ItemType Directory -Force $o | Out-Null');
      console.log('   ' + ps + ' | ForEach-Object { Move-Item "$b\\skills\\$_" "$o\\$_" -Force }');
      console.log('');
      console.log('   # PowerShell · RE-ENABLE');
      console.log('   $b="$env:USERPROFILE\\.claude"; $o="$b\\skills.disabled"');
      console.log('   ' + ps + ' | ForEach-Object { Move-Item "$o\\$_" "$b\\skills\\$_" -Force }');
    } else {
      const sh = off.join(' ');
      console.log('   # sh · DISABLE');
      console.log('   b="$HOME/.claude"; o="$b/skills.disabled"; mkdir -p "$o"');
      console.log('   for s in ' + sh + '; do mv "$b/skills/$s" "$o/$s"; done');
      console.log('');
      console.log('   # sh · RE-ENABLE');
      console.log('   b="$HOME/.claude"; o="$b/skills.disabled"');
      console.log('   for s in ' + sh + '; do mv "$o/$s" "$b/skills/$s"; done');
    }
  }
  if (activeMcp.length) {
    console.log('');
    console.log('   active MCP (managed → /mcp · local → node toggle-mcp.cjs off <name>):');
    for (const s of activeMcp.slice().sort((a, b) => b.estTokens - a.estTokens)) {
      const tc = s.toolCount != null ? `${s.toolCount} tools, ` : '';
      const tok = s.estBasis === 'tools' ? `~${s.estTokens}–${s.estHi} tok` : `~${s.estTokens} tok`;
      console.log(`     • ${s.name} (${tc}${tok})`);
    }
    console.log('   (platform-managed connectors don\'t live in a file — only /mcp removes them)');
    console.log('');
    printRedundantMcp(detectRedundantMcp(mcp.servers));
  }
  console.log('');
}

function main() {
  const data = scanBloat(projectDir);
  if (JSON_OUT) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  if (COMPACT) {
    printCompact(data);
    return;
  }
  if (OFF) {
    printOff(data);
    return;
  }
  printHuman(data);
}

main();
