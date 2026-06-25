const fs = require('fs');
const os = require('os');
const path = require('path');
const { claudeDir } = require('./paths.cjs');
const { discoverSessionMcp, estMcpServerTokens } = require('./mcp-scan.cjs');

const STALE_DAYS = 90;
const MS_PER_DAY = 86400000;

const KEEP_ALWAYS = new Set([
  'context-economy',
  'using-superpowers',
  'verification-before-completion',
]);

function claudeJsonPath() {
  return path.join(os.homedir(), '.claude.json');
}

function readClaudeJson() {
  try {
    return JSON.parse(fs.readFileSync(claudeJsonPath(), 'utf8'));
  } catch {
    return {};
  }
}

function skillRoots() {
  const home = os.homedir();
  return [
    { env: 'claude-code', dir: path.join(claudeDir(), 'skills'), loadsInPrompt: true },
    { env: 'cursor', dir: path.join(home, '.agents', 'skills'), loadsInPrompt: true },
    { env: 'grok', dir: path.join(home, '.grok', 'skills'), loadsInPrompt: true },
    { env: 'grok-bundled', dir: path.join(home, '.grok', 'bundled', 'skills'), loadsInPrompt: true },
  ];
}

function isArchived(relPath) {
  const parts = relPath.split(/[\\/]/);
  return parts.some(p => p.startsWith('_') || p === 'node_modules');
}

function findSkillFiles(rootDir) {
  const results = [];
  if (!fs.existsSync(rootDir)) return results;

  function walk(dir, rel = '') {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      const relChild = rel ? path.join(rel, ent.name) : ent.name;
      if (isArchived(relChild)) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === 'node_modules') continue;
        walk(full, relChild);
      } else if (ent.name === 'SKILL.md') {
        results.push({ file: full, rel: relChild });
      }
    }
  }
  walk(rootDir);
  return results;
}

function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (!kv) continue;
    let val = kv[2].trim();
    if (val === '>-' || val === '|' || val === '>') continue;
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[kv[1]] = val;
  }
  const descBlock = m[1].match(/description:\s*>-?\s*\r?\n([\s\S]*?)(?=\r?\n[a-zA-Z_-]+:|\s*$)/);
  if (descBlock) out.description = descBlock[1].replace(/\r?\n\s+/g, ' ').trim();
  return out;
}

function countLines(text) {
  if (!text) return 0;
  let n = 1;
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') n++;
  return n;
}

function clipDesc(s, max = 200) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.45 ? cut.slice(0, sp) : cut) + '…';
}

const normId = s => String(s || '').toLowerCase().replace(/[-_]/g, '');
const usageBase = key => (key.includes(':') ? key.slice(key.lastIndexOf(':') + 1) : key);

// Matches a skill's usage against ALL the skillUsage keys, tolerating:
//   • plugin namespacing    (anthropic-skills:humanizer ~ folder "humanizer")
//   • hyphen vs underscore   (foo_bar ~ foo-bar)
// Errs on purpose toward the SAFE side (over-matching > under-matching): a false-"used" only
// stops a disable recommendation; a false-"0×" would recommend disabling a skill you use.
function matchUsage(usage, candidates) {
  const wanted = new Set((candidates || []).filter(Boolean).map(normId));
  let usageCount = 0, lastUsedAt = null;
  const hitKeys = [];
  for (const [key, val] of Object.entries(usage || {})) {
    if (!wanted.has(normId(usageBase(key))) && !wanted.has(normId(key))) continue;
    hitKeys.push(key);
    usageCount = Math.max(usageCount, val.usageCount || 0);
    const lu = val.lastUsedAt || 0;
    if (lu > (lastUsedAt || 0)) lastUsedAt = lu;
  }
  return { usageCount, lastUsedAt, hitKeys };
}

function folderKey(relPath) {
  const parts = relPath.split(/[\\/]/);
  return parts[parts.length - 2] || parts[0];
}

function scanSkills() {
  const claudeJson = readClaudeJson();
  const usage = claudeJson.skillUsage || {};
  const now = Date.now();
  const all = [];
  const consumed = new Set();   // skillUsage keys already attributed to an on-disk skill

  for (const root of skillRoots()) {
    for (const { file, rel } of findSkillFiles(root.dir)) {
      let text = '';
      try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
      const fm = parseFrontmatter(text);
      const folder = folderKey(rel);
      const name = fm.name || folder;
      const desc = fm.description || '';
      const lines = countLines(text);
      const u = matchUsage(usage, [name, folder]);
      u.hitKeys.forEach(k => consumed.add(k));
      const daysSinceUse = u.lastUsedAt
        ? Math.floor((now - u.lastUsedAt) / MS_PER_DAY)
        : null;

      all.push({
        env: root.env,
        loadsInPrompt: root.loadsInPrompt,
        folder,
        name,
        file,
        lines,
        desc: clipDesc(desc),
        descChars: desc.length,
        // honest: per session only name+description enter the context (the SKILL.md body only
        // loads when the skill is invoked). Do NOT count the body lines (overestimated ~7x).
        estTokens: Math.round((desc.length + name.length) / 4),
        usageCount: u.usageCount,
        lastUsedAt: u.lastUsedAt,
        daysSinceUse,
        neverUsed: u.usageCount === 0,
      });
    }
  }

  // Skills managed by the platform (plugins: anthropic-skills:*, cowork:* …) don't live on
  // disk — they only appear in skillUsage, and only the ones ALREADY USED. Make them visible
  // (instead of pretending the on-disk ones are the whole universe) and NEVER recommend disabling
  // them. Their exact token cost isn't measurable offline (the description isn't on disk)
  // → estTokens = 0 + managed flag.
  for (const [key, val] of Object.entries(usage)) {
    if (consumed.has(key) || !key.includes(':') || !(val.usageCount > 0)) continue;
    all.push({
      env: 'managed',
      loadsInPrompt: true,
      folder: usageBase(key),
      name: key,
      file: null,
      lines: 0,
      descChars: 0,
      estTokens: 0,                 // not measurable offline (no description on disk)
      usageCount: val.usageCount || 0,
      lastUsedAt: val.lastUsedAt || null,
      daysSinceUse: val.lastUsedAt ? Math.floor((now - val.lastUsedAt) / MS_PER_DAY) : null,
      neverUsed: false,
      managed: true,
    });
  }

  return all;
}

function findProjectMcpJson(projectDir) {
  const candidates = [
    path.join(projectDir, '.mcp.json'),
    path.join(projectDir, '.claude', '.mcp.json'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function scanMcp(projectDir) {
  const claudeJson = readClaudeJson();
  const global = claudeJson.mcpServers || {};
  const projects = claudeJson.projects || {};
  const projKey = projectDir ? path.resolve(projectDir) : null;
  const projState = projKey && projects[projKey] ? projects[projKey] : {};
  const enabled = new Set(projState.enabledMcpjsonServers || []);
  const disabled = new Set(projState.disabledMcpjsonServers || []);

  // index by name (lower) to merge local config + session without duplicating
  const byKey = new Map();
  const put = (srv) => {
    const key = srv.name.toLowerCase();
    const cur = byKey.get(key);
    if (!cur) { byKey.set(key, srv); return; }
    if (srv.toolCount != null) cur.toolCount = Math.max(cur.toolCount || 0, srv.toolCount);
    if (srv.inSession) cur.inSession = true;
  };

  for (const [name, cfg] of Object.entries(global)) {
    put({
      name, scope: 'global', source: '~/.claude.json',
      type: cfg.type || 'stdio', command: cfg.command || cfg.url || '',
      status: disabled.has(name) ? 'disabled-project' : 'active',
    });
  }

  const mcpFile = projectDir ? findProjectMcpJson(projectDir) : null;
  if (mcpFile) {
    try {
      const raw = JSON.parse(fs.readFileSync(mcpFile, 'utf8'));
      const local = raw.mcpServers || raw;
      for (const [name, cfg] of Object.entries(local)) {
        if (name === 'mcpServers') continue;
        const st = disabled.has(name) ? 'disabled-project'
          : enabled.has(name) ? 'enabled-project'
            : 'project-file';
        put({
          name, scope: 'project', source: mcpFile,
          type: cfg.type || 'stdio', command: cfg.command || cfg.url || '', status: st,
        });
      }
    } catch { /* skip */ }
  }

  // Session: connectors actually in play (includes the platform-managed ones, which don't
  // live in any file). Source = the project's most recent .jsonl transcript.
  let sessionFile = null;
  try {
    const sess = discoverSessionMcp(projectDir);
    sessionFile = sess.file;
    for (const key of Object.keys(sess.servers)) {
      const s = sess.servers[key];
      put({
        name: s.name, scope: 'session', source: 'session-log', type: 'managed',
        command: '', status: 'active', toolCount: s.tools.size, inSession: true,
      });
    }
  } catch { /* no readable log: falls back to config-only */ }

  const servers = [...byKey.values()].map(s => {
    const e = estMcpServerTokens(s.toolCount);
    return { ...s, estTokens: e.est, estHi: e.hi, estBasis: e.basis };
  });

  const plugins = claudeJson.pluginUsage || {};
  const inactivePlugins = Object.entries(plugins)
    .filter(([, v]) => (v.usageCount || 0) === 0)
    .map(([k]) => k);

  return { servers, inactivePlugins, sessionFile };
}

function buildRecommendations(skills, mcp) {
  const recs = [];

  const claudeSkills = skills.filter(s => s.env === 'claude-code');
  for (const s of claudeSkills) {
    if (KEEP_ALWAYS.has(s.folder) || KEEP_ALWAYS.has(s.name)) continue;
    if (s.descChars > 600) {
      recs.push({
        kind: 'skill',
        severity: 'medium',
        id: s.folder,
        env: s.env,
        reason: `long description (${s.descChars} chars ≈ +${Math.round(s.descChars / 4)} tok/session)`,
        action: 'shorten the description in SKILL.md or archive it',
      });
    }
    // gate by the real per-session COST (description), not by the body size: the SKILL.md
    // body only loads when the skill is invoked; what weighs every day is name+description.
    if (s.neverUsed && s.descChars > 150) {
      recs.push({
        kind: 'skill',
        severity: 'medium',
        id: s.folder,
        env: s.env,
        reason: `never used (0× in the logs) · ~${Math.round((s.descChars + (s.name || '').length) / 4)} tok/session`,
        action: 'disable: list-bloat --off (moves to skills.disabled)',
      });
    } else if (s.daysSinceUse != null && s.daysSinceUse > STALE_DAYS && s.usageCount <= 2) {
      recs.push({
        kind: 'skill',
        severity: 'low',
        id: s.folder,
        env: s.env,
        reason: `unused for ${s.daysSinceUse}d (${s.usageCount}× total)`,
        action: 'disable if not part of the current project: list-bloat --off',
      });
    }
  }

  const firecrawlSubs = claudeSkills.filter(s => s.folder.startsWith('firecrawl-'));
  if (firecrawlSubs.length >= 5) {
    const unused = firecrawlSubs.filter(s => s.neverUsed).length;
    if (unused >= 3) {
      recs.push({
        kind: 'skill-pack',
        severity: 'high',
        id: 'firecrawl-*',
        env: 'claude-code',
        reason: `${firecrawlSubs.length} firecrawl skills (${unused} never used) — each one enters the prompt`,
        action: 'keep only firecrawl + the 1–2 you use; archive the rest',
      });
    }
  }

  const isActive = s => s.status === 'active' || s.status === 'enabled-project' || s.status === 'project-file';

  // managed connectors (seen in the session log): aggregate into a single rec — otherwise 10+ lines drown out the rest
  const sessionMcp = mcp.servers.filter(s => s.inSession && isActive(s));
  if (sessionMcp.length) {
    const tools = sessionMcp.reduce((a, s) => a + (s.toolCount || 0), 0);
    const lo = sessionMcp.reduce((a, s) => a + s.estTokens, 0);
    recs.push({
      kind: 'mcp',
      severity: 'medium',
      id: `${sessionMcp.length} connectors`,
      env: 'claude-code',
      reason: `${sessionMcp.length} MCPs active in the session (~${tools} tools, ~${lo}+ tok) — mostly managed connectors, outside ~/.claude.json`,
      action: '/mcp to disable the ones you don\'t use in this session (a managed connector can\'t be removed via file)',
    });
  }

  // local-config MCP that did NOT appear in the log: individual rec (can be removed via file)
  for (const srv of mcp.servers) {
    if (!isActive(srv) || srv.inSession) continue;
    recs.push({
      kind: 'mcp',
      severity: srv.name === 'playwright' ? 'medium' : 'low',
      id: srv.name,
      env: 'claude-code',
      reason: `active MCP (${srv.type}) — tool schemas in the startup context`,
      action: srv.scope === 'global'
        ? `remove "${srv.name}" from ~/.claude.json → mcpServers (or /mcp off in the session)`
        : `disable in the project: disabledMcpjsonServers in ~/.claude.json → projects`,
    });
  }

  if (mcp.inactivePlugins.length) {
    recs.push({
      kind: 'plugin',
      severity: 'low',
      id: mcp.inactivePlugins.join(', '),
      env: 'claude-code',
      reason: 'installed plugins with 0 uses',
      action: 'uninstall unused plugins in Claude Code (/plugins)',
    });
  }

  const seen = new Set();
  return recs.filter(r => {
    const key = `${r.kind}:${r.id}:${r.reason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function summarize(skills, mcp, recs) {
  const claude = skills.filter(s => s.env === 'claude-code');
  const promptSkills = skills.filter(s => s.loadsInPrompt);
  const activeMcp = mcp.servers.filter(s =>
    s.status === 'active' || s.status === 'enabled-project' || s.status === 'project-file'
  );
  const estSkillTok = claude.reduce((a, s) => a + s.estTokens, 0);
  const estMcpTok = activeMcp.reduce((a, s) => a + s.estTokens, 0);          // floor (deferred tools = names only)
  const estMcpTokHi = activeMcp.reduce((a, s) => a + (s.estHi || s.estTokens), 0); // ceiling (inline schemas)
  const sessionMcp = activeMcp.filter(s => s.inSession).length;

  return {
    skillCounts: {
      'claude-code': claude.length,
      cursor: skills.filter(s => s.env === 'cursor').length,
      grok: skills.filter(s => s.env === 'grok').length,
      'grok-bundled': skills.filter(s => s.env === 'grok-bundled').length,
      managed: skills.filter(s => s.env === 'managed').length,  // managed plugins, seen via skillUsage
      total: skills.length,
      inPrompt: promptSkills.length,
    },
    mcpCounts: {
      active: activeMcp.length,
      fromSession: sessionMcp,                 // seen in the log (includes managed ones)
      disabled: mcp.servers.filter(s => s.status === 'disabled-project').length,
      total: mcp.servers.length,
    },
    estTokensPerSession: estSkillTok + estMcpTok,
    estTokensPerSessionHi: estSkillTok + estMcpTokHi,
    estSkillTokens: estSkillTok,
    estMcpTokens: estMcpTok,
    estMcpTokensHi: estMcpTokHi,
    recommendations: recs.length,
    high: recs.filter(r => r.severity === 'high').length,
  };
}

function scanBloat(projectDir) {
  const skills = scanSkills();
  const mcp = scanMcp(projectDir);
  const recommendations = buildRecommendations(skills, mcp);
  const summary = summarize(skills, mcp, recommendations);
  return { skills, mcp, recommendations, summary };
}

module.exports = {
  scanBloat,
  scanSkills,
  scanMcp,
  buildRecommendations,
  matchUsage,
  readClaudeJson,
  KEEP_ALWAYS,
  STALE_DAYS,
};