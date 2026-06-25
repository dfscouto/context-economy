/*
 * Per-PROJECT skill usage — reads the transcripts ~/.claude/projects/<encoded>/.
 * Signals:
 *   • strong: "Base directory for this skill: …/.claude/skills/<folder>" (= invoked)
 *   • medium: a read of …/.claude/skills/<folder>/SKILL.md in the transcript
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { resolveLogDir, recentProjects, decodeProjectDir } = require('./paths.cjs');
const { findClaudeMd, findHandoff } = require('./project-scan.cjs');
const { listJsonlFiles } = require('./log-scan.cjs');

// Only user-installed skills (~/.claude/skills or skills.disabled) — ignores plugins/skills.sh.
const SLASH = '[\\\\/]+';
const INVOKE_RE = new RegExp('Base directory for this skill:[^\\n]*?\\.claude' + SLASH + 'skills' + SLASH + '([A-Za-z0-9][A-Za-z0-9_.-]*)', 'gi');
const READ_RE = new RegExp('\\.claude' + SLASH + 'skills' + SLASH + '([A-Za-z0-9][A-Za-z0-9_.-]*)' + SLASH + 'SKILL\\.md', 'gi');
const READ_OFF_RE = new RegExp('skills\\.disabled' + SLASH + '([A-Za-z0-9][A-Za-z0-9_.-]*)' + SLASH + 'SKILL\\.md', 'gi');
const READ_TOOL_RE = new RegExp('\\.claude' + SLASH + 'skills' + SLASH + '([A-Za-z0-9][A-Za-z0-9_.-]*)' + SLASH + 'SKILL\\.md', 'i');

// Optional tuning: map a skill folder to keywords that strongly imply a project needs it,
// so the relevance check won't suggest disabling it. Generic examples only — add your own
// skills here if you want sharper matching. The check still works without any entry (it falls
// back to the skill's own name/description and your invocation history).
const STRONG_ALIASES = {
  'context-economy': ['context economy', 'token spend', 'handoff'],
  'instagram-carousel': ['instagram', 'carousel', '1080'],
};

// Generic words — they only warn, they do NOT block disabling.
const WEAK_ALIASES = {
  'playwright-skill': ['playwright', 'e2e', 'browser test'],
  'webapp-testing': ['playwright', 'webapp', 'browser'],
  'frontend-design': ['design system', 'dashboard'],
  'ux-methodology': ['ux methodology', 'usability'],
  'modular-planning': ['module', 'architecture', 'schema'],
};

const NEGATION_RE = /\b(no|not|never|without|skip|skips|skipped|avoid|avoids|instead|rather|unused|unneeded)\b/i;

function saneFolder(name) {
  return name
    && name.length <= 64
    && /^[a-z0-9]/i.test(name)
    && !/_tokens$/i.test(name)
    && !/^browser-/i.test(name)
    && !/^(carrocel|carousel)$/i.test(name);
}

function bump(map, folder) {
  if (!saneFolder(folder)) return;
  map[folder] = (map[folder] || 0) + 1;
}

function scanLineText(line, invokes, reads) {
  if (!line || line.length < 24) return;
  if (!/skill|Skill|SKILL|Base directory/i.test(line)) return;

  INVOKE_RE.lastIndex = 0;
  let m;
  while ((m = INVOKE_RE.exec(line))) bump(invokes, m[1]);

  for (const re of [READ_RE, READ_OFF_RE]) {
    re.lastIndex = 0;
    while ((m = re.exec(line))) bump(reads, m[1]);
  }
}

function scanLineJson(line, invokes, reads) {
  if (!line.startsWith('{')) return;
  try {
    const j = JSON.parse(line);
    const blocks = [];
    if (Array.isArray(j.message?.content)) blocks.push(...j.message.content);
    if (Array.isArray(j.content)) blocks.push(...j.content);
    for (const b of blocks) {
      if (b?.type === 'tool_use' && b.name === 'Read' && b.input?.file_path) {
        const rm = String(b.input.file_path).match(READ_TOOL_RE)
          || String(b.input.file_path).match(/skills\.disabled[\\/]([A-Za-z0-9][A-Za-z0-9_.-]*)[\\/]SKILL\.md/i);
        if (rm) bump(reads, rm[1]);
      }
    }
  } catch { /* truncated or non-json line */ }
}

function scanFileLines(full, invokes, reads) {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({
      input: fs.createReadStream(full, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });
    rl.on('line', (line) => {
      scanLineText(line, invokes, reads);
      scanLineJson(line, invokes, reads);
    });
    rl.on('close', resolve);
    rl.on('error', reject);
  });
}

function listProjectOptions(limit = 12) {
  return recentProjects(limit)
    .map((p) => {
      const decoded = decodeProjectDir(p.name);
      return {
        encoded: p.name,
        path: decoded,
        label: decoded || p.name,
        mtime: p.mtime,
      };
    })
    .filter((p) => p.path && fs.existsSync(p.path));
}

function buildProjectContext(projectDir) {
  const name = path.basename(projectDir);
  let claudeSnippet = '';
  let handoffSnippet = '';
  const cm = findClaudeMd(projectDir);
  if (cm) {
    try { claudeSnippet = fs.readFileSync(cm, 'utf8').slice(0, 4000); } catch { /* */ }
  }
  const hf = findHandoff(projectDir);
  if (hf) {
    try { handoffSnippet = fs.readFileSync(path.join(projectDir, hf), 'utf8').slice(0, 2000); } catch { /* */ }
  }
  const haystack = (name + ' ' + claudeSnippet + ' ' + handoffSnippet).toLowerCase();
  return { dir: projectDir, name, claudeSnippet, handoffSnippet, haystack };
}

function aliasInHaystack(haystack, alias) {
  const a = alias.toLowerCase();
  let idx = 0;
  while ((idx = haystack.indexOf(a, idx)) >= 0) {
    const before = haystack.slice(Math.max(0, idx - 36), idx);
    if (!NEGATION_RE.test(before)) return true;
    idx += a.length;
  }
  return false;
}

function projectRelation(skill, ctx) {
  if (!ctx?.haystack) return { level: 'none' };

  for (const t of [skill.folder, skill.name].filter(Boolean)) {
    const bare = t.replace(/-/g, ' ');
    const tight = t.replace(/-/g, '');
    if (ctx.haystack.includes(bare) || ctx.haystack.includes(tight)) {
      return { level: 'strong', why: 'skill name in the CLAUDE.md/handoff' };
    }
  }

  for (const alias of STRONG_ALIASES[skill.folder] || []) {
    if (aliasInHaystack(ctx.haystack, alias)) {
      return { level: 'strong', why: `strong keyword "${alias}" in the project` };
    }
  }

  for (const alias of WEAK_ALIASES[skill.folder] || []) {
    if (aliasInHaystack(ctx.haystack, alias)) {
      return { level: 'weak', why: `generic term "${alias}" in text — check before disabling` };
    }
  }

  return { level: 'none' };
}

async function scanProjectSkillUsage(projectDir, opts = {}) {
  const maxFiles = opts.maxFiles ?? 80;
  const logDir = resolveLogDir(projectDir);
  const invokes = {};
  const reads = {};
  if (!logDir || !fs.existsSync(logDir)) {
    return { invokes, reads, counts: invokes, filesScanned: 0, logDir: logDir || null, jsonlTotal: 0 };
  }

  const files = listJsonlFiles(logDir);
  const slice = files.slice(0, maxFiles);
  let filesScanned = 0;
  for (const full of slice) {
    try {
      await scanFileLines(full, invokes, reads);
      filesScanned += 1;
    } catch { /* corrupted file */ }
  }
  return { invokes, reads, counts: invokes, filesScanned, logDir, jsonlTotal: files.length };
}

/** @deprecated use projectRelation — kept for legacy tests */
function heuristicMatch(skill, ctx) {
  return projectRelation(skill, ctx).level !== 'none';
}

function assessSkillForProject(skill, projectCtx, projectUsage) {
  const invokes = projectUsage?.invokes || projectUsage || {};
  const reads = projectUsage?.reads || {};

  if (skill.disabled) {
    const pc = invokes[skill.folder] || 0;
    const pr = reads[skill.folder] || 0;
    return {
      code: 'off',
      label: 'disabled',
      canDisable: false,
      reason: pc || pr
        ? `Disabled, but appears ${pc}× invoked / ${pr}× read in this project's logs.`
        : 'Already in ~/.claude/skills.disabled/.',
    };
  }
  const invokeCount = invokes[skill.folder] || 0;
  const readCount = reads[skill.folder] || 0;
  const globalCount = skill.usageCount || 0;

  if (invokeCount > 0) {
    return {
      code: 'in-use',
      label: 'in use here',
      canDisable: false,
      reason: `Invoked ${invokeCount}× in this project's logs — don't disable if you still work here.`,
    };
  }

  if (readCount > 0) {
    return {
      code: 'caution',
      label: 'caution',
      canDisable: false,
      reason: `SKILL.md read ${readCount}× in this project (no full invocation recorded).`,
    };
  }

  const rel = projectRelation(skill, projectCtx);
  if (rel.level === 'strong') {
    return {
      code: 'caution',
      label: 'caution',
      canDisable: false,
      reason: globalCount > 0
        ? `${rel.why} · used ${globalCount}× overall.`
        : `${rel.why} — may be useful in this repo.`,
    };
  }
  if (rel.level === 'weak') {
    return {
      code: 'caution',
      label: 'caution',
      canDisable: true,
      reason: `${rel.why}${globalCount > 0 ? ` · ${globalCount}× overall.` : '.'}`,
    };
  }

  if (globalCount > 0) {
    return {
      code: 'caution',
      label: 'caution',
      canDisable: true,
      reason: `Used ${globalCount}× in other projects, 0× here — disable only if you don't need it generally.`,
    };
  }

  return {
    code: 'safe',
    label: 'safe to disable',
    canDisable: true,
    reason: '0× in this project and 0× in global history — safe candidate to disable.',
  };
}

module.exports = {
  listProjectOptions,
  buildProjectContext,
  scanProjectSkillUsage,
  scanLineText,
  bump,
  saneFolder,
  projectRelation,
  heuristicMatch,
  assessSkillForProject,
  STRONG_ALIASES,
  WEAK_ALIASES,
};