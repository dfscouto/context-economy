#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { aggregate } = require('./aggregate.cjs');
const { scanBloat, matchUsage, readClaudeJson } = require('./lib/bloat-scan.cjs');
const { listDisabledSkillMeta } = require('./lib/skill-toggle.cjs');
const { k } = require('./lib/billing.cjs');
const { skillDir, readPlan } = require('./lib/paths.cjs');
const {
  listProjectOptions,
  buildProjectContext,
  scanProjectSkillUsage,
  assessSkillForProject,
} = require('./lib/skill-project.cjs');

const OUT = path.join(skillDir(), 'dashboard', 'data.js');
const REPORT = process.argv.includes('--report');
const BLOAT_ONLY = process.argv.includes('--bloat-only');

// Reuse the already-computed billing aggregate (days/stats) from the current data.js.
// A skill toggle only changes the `bloat`/`project` sections — re-running the full
// aggregate() (reads every transcript, ~30s+) just to flip an enabled flag froze the
// dashboard server on every toggle. bloat-only patches the cheap parts and keeps the rest.
function readExistingData() {
  try {
    const raw = fs.readFileSync(OUT, 'utf8');
    const m = raw.match(/window\.USAGE_DATA\s*=\s*(\{[\s\S]*\})\s*;/);
    return m ? JSON.parse(m[1]) : null;
  } catch { return null; }
}

// slim version of bloat for the dashboard: ESTIMATED cost per skill (chars/4) + MCP (placeholder).
// It's an estimate, not an exact measurement — the relative ranking is what matters for deciding.
function slimBloat(b, projectCtx, projectUsage) {
  const usage = readClaudeJson().skillUsage || {};
  const invokes = projectUsage?.invokes || {};
  const reads = projectUsage?.reads || {};

  function withVerdict(s, disabled) {
    let usageCount = s.usageCount;
    let neverUsed = s.neverUsed;
    if (disabled) {
      const u = matchUsage(usage, [s.name, s.folder]);
      usageCount = u.usageCount;
      neverUsed = u.usageCount === 0;
    }
    const row = {
      folder: s.folder,
      name: s.name,
      desc: s.desc || '',
      estTokens: s.estTokens,
      neverUsed,
      usageCount,
      disabled,
      canToggle: true,
      projectCount: invokes[s.folder] || 0,
      projectReads: reads[s.folder] || 0,
    };
    const v = assessSkillForProject(row, projectCtx, projectUsage);
    return {
      ...row,
      verdict: v.code,
      verdictLabel: v.label,
      verdictReason: v.reason,
      canDisable: v.canDisable,
    };
  }

  const active = b.skills
    .filter(s => s.env === 'claude-code')
    .map(s => withVerdict(s, false));
  const disabled = listDisabledSkillMeta().map(s => withVerdict(s, true));
  const byFolder = new Map();
  for (const s of active) byFolder.set(s.folder, s);
  for (const s of disabled) byFolder.set(s.folder, s);
  const merged = [...byFolder.values()].sort((a, z) => {
    if (a.disabled !== z.disabled) return a.disabled ? 1 : -1;
    return z.estTokens - a.estTokens;
  });
  return {
    estTokensPerSession: b.summary.estTokensPerSession,
    estSkillTokens: b.summary.estSkillTokens,
    estMcpTokens: b.summary.estMcpTokens,
    skills: merged,
    estMcpTokensHi: b.summary.estMcpTokensHi,
    mcp: b.mcp.servers
      .filter(s => s.status === 'active' || s.status === 'enabled-project' || s.status === 'project-file')
      .map(s => ({ name: s.name, estTokens: s.estTokens, estHi: s.estHi, toolCount: s.toolCount }))
      .sort((a, z) => z.estTokens - a.estTokens),
  };
}

(async () => {
  const rawProject = process.env.CONTEXT_ECONOMY_PROJECT || '__all__';
  const isAll = !rawProject || rawProject === '__all__';
  let projectCtx = null;
  let projectUsage = { invokes: {}, reads: {}, counts: {}, filesScanned: 0, logDir: null, jsonlTotal: 0 };
  if (!isAll && fs.existsSync(rawProject)) {
    projectCtx = buildProjectContext(rawProject);
    projectUsage = await scanProjectSkillUsage(rawProject);
  }

  let data = null;
  if (BLOAT_ONLY) data = readExistingData();   // toggle/fast path: keep days+stats, regen only bloat
  if (!data) data = await aggregate();          // full path (or fallback if data.js is missing)
  const scanDir = !isAll && fs.existsSync(rawProject) ? rawProject : process.cwd();
  try { data.bloat = slimBloat(scanBloat(scanDir), projectCtx, projectUsage); } catch { data.bloat = null; }
  data.project = {
    mode: isAll ? 'all' : 'project',
    dir: isAll ? null : (projectCtx?.dir || rawProject),
    name: isAll ? null : (projectCtx?.name || null),
    filesScanned: projectUsage.filesScanned,
    jsonlTotal: projectUsage.jsonlTotal || 0,
    logDir: projectUsage.logDir,
    options: listProjectOptions(12),
  };
  try { data.plan = readPlan(); } catch { data.plan = null; }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, 'window.USAGE_DATA = ' + JSON.stringify(data) + ';\n');

  if (REPORT) {
    const s = data.stats;
    console.log('=== context-economy · report (real logs) ===');
    console.log('days: ' + data.days.length + ' · sessions: ' + s.sessions + ' · skill since: ' + data.skillDate);
    console.log('');
    console.log('-- CPM (cost-equiv per message) — main metric --');
    console.log('  marathon (≥1000 msgs, ' + s.longCount + ' sess.): ' + k(s.marathonCPM) + '/msg');
    console.log('  short    (≤300 msgs, ' + s.shortCount + ' sess.):  ' + k(s.shortCPM) + '/msg');
    if (s.ratio) console.log('  ⮕ marathon costs ~' + s.ratio + '× more per msg (= what /clear cuts)');
    console.log('');
    console.log('-- Sessions --');
    console.log('  marathons: ' + (s.marathonPct || 0) + '% of sessions');
    console.log('  p50 msgs/session: ' + s.p50Msgs + ' · p90: ' + s.p90Msgs);
    console.log('  avg cost first 50 msgs: ' + k(s.avgStartup50));
    console.log('');
    if (!process.env.CONTEXT_ECONOMY_START) {
      console.log('-- Before/after: NOT configured --');
      console.log('  set CONTEXT_ECONOMY_START=YYYY-MM-DD (when the discipline started) for this');
      console.log('  comparison to matter — without it the cutoff is "today" and everything counts as "before".');
    } else {
      console.log('-- Per day (weak reference — mixes light/heavy days) --');
      console.log('  before (' + s.preDays + ' days):  ' + k(s.preAvgDay) + '/day');
      console.log('  after (' + s.postDays + ' days): ' + (s.postDays ? k(s.postAvgDay) + '/day' : 'no data'));
    }
    if (s.topProjects && s.topProjects.length) {
      console.log('');
      console.log('-- Top projects (billed total) --');
      for (const p of s.topProjects.slice(0, 5)) {
        console.log('  ' + p.name + ': ' + k(p.billed) + ' · ' + k(p.cpm) + '/msg · ' + p.sessions + ' sess.');
      }
    }
    console.log('');
    console.log('data.js → ' + OUT);
    console.log('dashboard → ' + path.join(skillDir(), 'dashboard', 'index.html'));
  }
  // Daily digest at SessionStart: yesterday's real numbers in one line, so the daily
  // spend is visible every morning without opening the dashboard. Data is already
  // computed by aggregate() above — this costs nothing extra.
  if (!BLOAT_ONLY && Array.isArray(data.days) && data.days.length) {
    try {
      const now = new Date();
      const today = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0')
        + '-' + String(now.getDate()).padStart(2, '0'); // local date, not UTC
      const prev = data.days.filter(d => d.date < today).pop(); // most recent full day
      if (prev && prev.billed > 0) {
        const opusPct = Math.round((prev.opus || 0) / prev.billed * 100);
        const shots = prev.screenshots ? ' · 📸 ' + prev.screenshots : '';
        console.log('📅 ' + prev.date + ': ' + k(prev.billed) + ' tok · Opus ' + opusPct + '%' + shots
          + ' · ' + prev.msgs + ' msgs');
      }
    } catch { /* digest is best-effort */ }
  }
  // fixed skills/MCP overhead at SessionStart (the "📦 …tok/session" line; came from session-init, removed in v3)
  if (!BLOAT_ONLY) {
    try { process.stdout.write(require('child_process').execSync('node ' + JSON.stringify(path.join(__dirname, 'list-bloat.cjs')) + ' --compact', { encoding: 'utf8' })); } catch {}
  }
})();