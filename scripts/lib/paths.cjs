const fs = require('fs');
const os = require('os');
const path = require('path');
const { localDateKey } = require('./dates.cjs');

function skillDir() {
  return path.join(__dirname, '..', '..');
}

function claudeDir() {
  return path.join(os.homedir(), '.claude');
}

function settingsPath() {
  return path.join(claudeDir(), 'settings.json');
}

function encodeCwd(cwd) {
  return cwd.replace(/[:\\/]/g, '-');
}

function projectsRoot() {
  return path.join(claudeDir(), 'projects');
}

function skillDate() {
  // before/after split for the dashboard. Set CONTEXT_ECONOMY_START=YYYY-MM-DD to mark when
  // you started; otherwise defaults to today (everything counts as "after").
  return process.env.CONTEXT_ECONOMY_START || localDateKey(Date.now());
}

function recentProjects(limit = 5) {
  const root = projectsRoot();
  try {
    return fs.readdirSync(root)
      .map(name => {
        const full = path.join(root, name);
        try {
          const st = fs.statSync(full);
          if (!st.isDirectory()) return null;
          return { name, path: full, mtime: st.mtimeMs };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, limit);
  } catch {
    return [];
  }
}

function decodeProjectDir(encodedName) {
  // Best-effort: C--code-foo -> C:\code\foo on Windows
  if (process.platform === 'win32' && /^[A-Z]--/.test(encodedName)) {
    const drive = encodedName[0] + ':\\';
    const rest = encodedName.slice(3).replace(/-/g, path.sep);
    return path.join(drive, rest);
  }
  return null;
}

function resolveLogDir(cwd) {
  const base = cwd || process.cwd();
  const guess = path.join(projectsRoot(), encodeCwd(base));
  if (fs.existsSync(guess)) return guess;
  return null;
}

module.exports = {
  skillDir,
  claudeDir,
  settingsPath,
  encodeCwd,
  projectsRoot,
  skillDate,
  recentProjects,
  decodeProjectDir,
  resolveLogDir,
};
