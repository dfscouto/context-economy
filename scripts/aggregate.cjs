const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { projectsRoot, skillDate } = require('./lib/paths.cjs');
const { billedOf, median, percentile } = require('./lib/billing.cjs');
const { localDateKey } = require('./lib/dates.cjs');
const { listJsonlFiles, isTopLevelSessionFile } = require('./lib/log-scan.cjs');

const SKILL_DATE = skillDate();
const WIN_MS = 5 * 60 * 60 * 1000; // 5-hour window — the real unit of the plan's rolling limit

async function ingestFile(full, fb, proj, byDay, byWindow = {}) {
  const rl = readline.createInterface({ input: fs.createReadStream(full), crlfDelay: Infinity });
  const s = { msgs: 0, billed: 0, startup: 0 };

  for await (const line of rl) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    const raw = (o.message && o.message.usage) || o.usage;
    if (!raw) continue;
    const u = {
      in: raw.input_tokens || 0,
      out: raw.output_tokens || 0,
      cr: raw.cache_read_input_tokens || 0,
      cw: raw.cache_creation_input_tokens || 0,
    };
    const date = (typeof o.timestamp === 'string' ? localDateKey(o.timestamp) : null) || fb;
    const d = byDay[date] || (byDay[date] = { in: 0, out: 0, cr: 0, cw: 0, msgs: 0 });
    d.in += u.in; d.out += u.out; d.cr += u.cr; d.cw += u.cw; d.msgs++;
    const b = billedOf(u);
    // bucket into 5-hour windows (the real unit of the plan's rolling limit), keyed by epoch ms
    const tsMs = typeof o.timestamp === 'string' ? Date.parse(o.timestamp) : NaN;
    if (!Number.isNaN(tsMs)) {
      const bucket = Math.floor(tsMs / WIN_MS) * WIN_MS;
      const w = byWindow[bucket] || (byWindow[bucket] = { billed: 0, msgs: 0 });
      w.billed += b; w.msgs++;
    }
    s.msgs++;
    s.billed += b;
    if (s.msgs <= 50) s.startup += b;
    proj.billed += b;
    proj.msgs++;
  }
  return s;
}

async function aggregate() {
  const root = projectsRoot();
  let projDirs = [];
  try {
    projDirs = fs.readdirSync(root)
      .map(d => ({ name: d, path: path.join(root, d) }))
      .filter(p => { try { return fs.statSync(p.path).isDirectory(); } catch { return false; } });
  } catch {}

  const byDay = {};
  const byWindow = {};
  const sessions = [];
  const byProject = {};

  for (const { name, path: dir } of projDirs) {
    const files = listJsonlFiles(dir);
    const proj = byProject[name] || (byProject[name] = { billed: 0, msgs: 0, sessions: 0 });

    for (const full of files) {
      let fb;
      try { fb = localDateKey(fs.statSync(full).mtimeMs) || SKILL_DATE; } catch { fb = SKILL_DATE; }

      const s = await ingestFile(full, fb, proj, byDay, byWindow);
      if (s.msgs && isTopLevelSessionFile(dir, full)) {
        sessions.push({ ...s, project: name });
        proj.sessions++;
      }
    }
  }

  const days = Object.keys(byDay).sort().map(date => {
    const d = byDay[date];
    return {
      date,
      billed: Math.round(billedOf(d)),
      cache: Math.round(d.cr * 0.1 + d.cw * 1.25),
      work: d.in + d.out,
      msgs: d.msgs,
    };
  });

  const preD = days.filter(d => d.date < SKILL_DATE);
  const postD = days.filter(d => d.date >= SKILL_DATE);
  const avgB = arr => arr.length ? Math.round(arr.reduce((s, d) => s + d.billed, 0) / arr.length) : 0;
  const avgCPM = arr => arr.length ? Math.round(arr.reduce((a, s) => a + s.billed / s.msgs, 0) / arr.length) : 0;

  const longS = sessions.filter(s => s.msgs >= 1000);
  const shortS = sessions.filter(s => s.msgs <= 300);
  const marathonPct = arr => arr.length ? Math.round(100 * arr.filter(s => s.msgs >= 1000).length / arr.length) : 0;

  const msgCounts = sessions.map(s => s.msgs);
  const startupCosts = sessions.filter(s => s.msgs >= 10).map(s => s.startup);

  const topProjects = Object.entries(byProject)
    .map(([name, p]) => ({ name, ...p, cpm: p.msgs ? Math.round(p.billed / p.msgs) : 0 }))
    .sort((a, b) => b.billed - a.billed)
    .slice(0, 8);

  const stats = {
    preAvgDay: avgB(preD),
    postAvgDay: avgB(postD),
    preDays: preD.length,
    postDays: postD.length,
    marathonCPM: avgCPM(longS),
    shortCPM: avgCPM(shortS),
    longCount: longS.length,
    shortCount: shortS.length,
    ratio: (avgCPM(longS) && avgCPM(shortS)) ? +(avgCPM(longS) / avgCPM(shortS)).toFixed(1) : null,
    sessions: sessions.length,
    marathonPct: marathonPct(sessions),
    p50Msgs: median(msgCounts),
    p90Msgs: percentile(msgCounts, 90),
    avgStartup50: startupCosts.length ? Math.round(startupCosts.reduce((a, b) => a + b, 0) / startupCosts.length) : 0,
    topProjects,
  };

  const winArr = Object.keys(byWindow)
    .map(key => ({ start: Number(key), billed: Math.round(byWindow[key].billed), msgs: byWindow[key].msgs }))
    .sort((a, b) => a.start - b.start);
  const winBilled = winArr.map(w => w.billed);
  const windows = {
    bucketHours: WIN_MS / 3600000,
    count: winArr.length,
    peak: winArr.length ? winArr.reduce((m, w) => (w.billed > m.billed ? w : m), winArr[0]) : null,
    p50: median(winBilled),
    p90: percentile(winBilled, 90),
    top: [...winArr].sort((a, b) => b.billed - a.billed).slice(0, 6),
  };

  return {
    generatedAt: new Date().toISOString(),
    skillDate: SKILL_DATE,
    skillDateConfigured: !!process.env.CONTEXT_ECONOMY_START,
    version: 2,
    days,
    stats,
    windows,
  };
}

module.exports = { aggregate, SKILL_DATE, ingestFile };