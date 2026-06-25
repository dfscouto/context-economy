const fs = require('fs');
const path = require('path');

const HANDOFF_NAMES = [
  'ANDAMENTO.md', 'STATUS.md', 'docs/ANDAMENTO.md', 'docs/STATUS.md',
  'docs/estado.md', 'MEMORY.md', 'docs/BOOT.md',
];

function countLines(file) {
  try {
    const buf = fs.readFileSync(file, 'utf8');
    if (!buf) return 0;
    let n = 1;
    for (let i = 0; i < buf.length; i++) if (buf[i] === '\n') n++;
    return n;
  } catch {
    return 0;
  }
}

function findClaudeMd(dir) {
  const candidates = [
    path.join(dir, 'CLAUDE.md'),
    path.join(dir, 'claude.md'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function findHandoff(dir) {
  for (const rel of HANDOFF_NAMES) {
    const full = path.join(dir, rel);
    if (fs.existsSync(full)) return rel;
  }
  return null;
}

module.exports = {
  countLines,
  findClaudeMd,
  findHandoff,
  HANDOFF_NAMES,
};
