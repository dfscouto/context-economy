const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { projectsRoot, skillDate } = require('./lib/paths.cjs');
const { billedOf, median, percentile } = require('./lib/billing.cjs');
const { localDateKey } = require('./lib/dates.cjs');
const { listJsonlFiles, isTopLevelSessionFile } = require('./lib/log-scan.cjs');

const SKILL_DATE = skillDate();
const WIN_MS = 5 * 60 * 60 * 1000; // 5-hour window — the real unit of the plan's rolling limit

function modelFamily(m) {
  m = String(m || '').toLowerCase();
  if (m.includes('opus')) return 'opus';
  if (m.includes('sonnet')) return 'sonnet';
  if (m.includes('haiku')) return 'haiku';
  if (m.includes('fable')) return 'fable';
  return 'other';
}
function weekStart(dateStr) {
  // Monday of the ISO week containing the local date (YYYY-MM-DD)
  const [y, mo, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  const dow = dt.getUTCDay();
  dt.setUTCDate(dt.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
  return dt.toISOString().slice(0, 10);
}

async function ingestFile(full, fb, proj, byDay, agg = {}) {
  const byWindow = agg.windows || (agg.windows = {});
  const byModel = agg.models || (agg.models = {});
  const byWeekModel = agg.weekModels || (agg.weekModels = {});
  const byDayModel = agg.dayModels || (agg.dayModels = {});
  const byDayShots = agg.dayShots || (agg.dayShots = {});
  const rl = readline.createInterface({ input: fs.createReadStream(full), crlfDelay: Infinity });
  const s = { msgs: 0, billed: 0, startup: 0 };

  for await (const line of rl) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }

    // Count screenshot tool calls (independent of usage lines)
    const msg = o.message || o;
    if ((msg.role || o.type) === 'assistant' && Array.isArray(msg.content)) {
      const dateShot = (typeof o.timestamp === 'string' ? localDateKey(o.timestamp) : null) || fb;
      let shots = 0;
      for (const item of msg.content) {
        if (item.type === 'tool_use' && /screenshot/i.test(item.name || '')) shots++;
      }
      if (shots > 0) byDayShots[dateShot] = (byDayShots[dateShot] || 0) + shots;
    }

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
    // split by model family (the real driver of the weekly cap) + by ISO week
    const fam = modelFamily((o.message && o.message.model) || o.model);
    const fm = byModel[fam] || (byModel[fam] = { billed: 0, msgs: 0 });
    fm.billed += b; fm.msgs++;
    const wk = weekStart(date);
    const wr = byWeekModel[wk] || (byWeekModel[wk] = { opus: 0, sonnet: 0, haiku: 0, fable: 0, other: 0, msgs: 0 });
    wr[fam] += b; wr.msgs++;
    const dr = byDayModel[date] || (byDayModel[date] = { opus: 0, sonnet: 0, haiku: 0, fable: 0, other: 0, msgs: 0 });
    dr[fam] += b; dr.msgs++;
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
  const agg = { windows: {}, models: {}, weekModels: {}, dayModels: {} };
  const sessions = [];
  const byProject = {};

  for (const { name, path: dir } of projDirs) {
    const files = listJsonlFiles(dir);
    const proj = byProject[name] || (byProject[name] = { billed: 0, msgs: 0, sessions: 0 });

    for (const full of files) {
      let fb;
      try { fb = localDateKey(fs.statSync(full).mtimeMs) || SKILL_DATE; } catch { fb = SKILL_DATE; }

      const s = await ingestFile(full, fb, proj, byDay, agg);
      if (s.msgs && isTopLevelSessionFile(dir, full)) {
        sessions.push({ ...s, project: name });
        proj.sessions++;
      }
    }
  }

  const byDayModel = agg.dayModels;
  const byDayShots = agg.dayShots || {};
  const days = Object.keys(byDay).sort().map(date => {
    const d = byDay[date];
    const m = byDayModel[date] || { opus: 0, sonnet: 0, haiku: 0, fable: 0, other: 0 };
    return {
      date,
      billed: Math.round(billedOf(d)),
      cache: Math.round(d.cr * 0.1 + d.cw * 1.25),
      work: d.in + d.out,
      msgs: d.msgs,
      screenshots: byDayShots[date] || 0,
      opus: Math.round(m.opus),
      sonnet: Math.round(m.sonnet),
      haiku: Math.round(m.haiku),
      fable: Math.round(m.fable),
      other: Math.round(m.other),
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

  const byWindow = agg.windows;
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

  const byModel = agg.models;
  const modelTotal = Object.keys(byModel).reduce((a, k) => a + byModel[k].billed, 0) || 1;
  const models = {
    total: Math.round(modelTotal),
    families: Object.keys(byModel)
      .map(name => ({ name, billed: Math.round(byModel[name].billed), msgs: byModel[name].msgs, pct: Math.round(100 * byModel[name].billed / modelTotal) }))
      .sort((a, b) => b.billed - a.billed),
  };

  const byWeekModel = agg.weekModels;
  const weeks = Object.keys(byWeekModel).sort().map(w => {
    const r = byWeekModel[w];
    const total = r.opus + r.sonnet + r.haiku + r.fable + r.other;
    return { week: w, opus: Math.round(r.opus), sonnet: Math.round(r.sonnet), haiku: Math.round(r.haiku), fable: Math.round(r.fable), other: Math.round(r.other), total: Math.round(total), msgs: r.msgs };
  });

  return {
    generatedAt: new Date().toISOString(),
    skillDate: SKILL_DATE,
    skillDateConfigured: !!process.env.CONTEXT_ECONOMY_START,
    version: 2,
    days,
    stats,
    windows,
    models,
    weeks,
  };
}

module.exports = { aggregate, SKILL_DATE, ingestFile };