const fs = require('fs');
const path = require('path');
const { claudeDir } = require('./paths.cjs');


function skillsDir() {
  return path.join(claudeDir(), 'skills');
}

function disabledDir() {
  return path.join(claudeDir(), 'skills.disabled');
}

function clipDesc(s, max = 200) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.45 ? cut.slice(0, sp) : cut) + '…';
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

function metaFromFolder(baseDir, folder) {
  const skillMd = path.join(baseDir, folder, 'SKILL.md');
  if (!fs.existsSync(skillMd)) return null;
  let text = '';
  try { text = fs.readFileSync(skillMd, 'utf8'); } catch { return null; }
  const fm = parseFrontmatter(text);
  const name = fm.name || folder;
  const desc = fm.description || '';
  return {
    folder,
    name,
    desc: clipDesc(desc),
    env: 'claude-code',
    estTokens: Math.round((desc.length + name.length) / 4),
    neverUsed: true,
    usageCount: 0,
    disabled: baseDir === disabledDir(),
    canToggle: true,
  };
}

function listDisabledSkillMeta() {
  const dir = disabledDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => {
      try { return fs.statSync(path.join(dir, name)).isDirectory(); } catch { return false; }
    })
    .map((folder) => metaFromFolder(dir, folder))
    .filter(Boolean);
}

function canToggleSkill(folder) {
  if (!folder || /[\\/]/.test(folder)) return false;
  return fs.existsSync(path.join(skillsDir(), folder))
    || fs.existsSync(path.join(disabledDir(), folder));
}

function toggleSkill(folder, enable) {
  if (!folder || /[\\/]/.test(folder)) throw new Error('invalid skill name');
  if (!canToggleSkill(folder)) throw new Error('skill not found: ' + folder);

  const src = enable ? path.join(disabledDir(), folder) : path.join(skillsDir(), folder);
  const dst = enable ? path.join(skillsDir(), folder) : path.join(disabledDir(), folder);

  if (!fs.existsSync(src)) throw new Error((enable ? 'disabled' : 'enabled') + ' skill not found: ' + folder);

  fs.mkdirSync(path.dirname(dst), { recursive: true });
  if (fs.existsSync(dst)) throw new Error('destination already exists: ' + folder);
  fs.renameSync(src, dst);

  return { folder, enabled: !!enable };
}

module.exports = {
  skillsDir,
  disabledDir,
  listDisabledSkillMeta,
  canToggleSkill,
  toggleSkill,
};