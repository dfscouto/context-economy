const fs = require('fs');
const path = require('path');

/** Lists .jsonl recursively (subagents/, etc.) — same logic as the skills scanner. */
function listJsonlFiles(logDir, maxDepth = 4) {
  const out = [];
  function walk(dir, depth) {
    if (depth > maxDepth) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full, depth + 1);
      else if (ent.isFile() && ent.name.endsWith('.jsonl')) out.push(full);
    }
  }
  walk(logDir, 0);
  out.sort((a, b) => {
    try { return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs; } catch { return 0; }
  });
  return out;
}

function isTopLevelSessionFile(logDir, filePath) {
  return path.normalize(path.dirname(filePath)) === path.normalize(logDir);
}

module.exports = { listJsonlFiles, isTopLevelSessionFile };