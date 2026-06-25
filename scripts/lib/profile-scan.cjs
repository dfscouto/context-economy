/**
 * profile-scan.cjs — shared core for the per-profile context breakdown.
 * Used by scripts/context-profile.cjs (full CLI report) and scripts/usage.cjs
 * (one-line SessionStart summary). Local only, zero AI tokens.
 *
 * Token figures are estimates (chars ÷ 4) over conversation CONTENT in transcripts
 * (≈ what accumulates and is re-read each turn). Does NOT include the fixed
 * per-session boot context (system + tool schemas + MCP).
 */
const fs = require('fs');
const readline = require('readline');

const CHARS_PER_TOK = 4;
const IMG_RE = /\.(png|jpe?g|webp|gif|bmp|svg|tiff?|heic)$/i;
const PDF_RE = /\.(pdf)$/i;

// content -> char length (proxy for tokens), recursive over the message shapes
function clen(c) {
  if (c == null) return 0;
  if (typeof c === 'string') return c.length;
  if (Array.isArray(c)) return c.reduce((s, x) => s + clen(x), 0);
  if (typeof c === 'object') {
    if (typeof c.text === 'string') return c.text.length;
    if (c.content !== undefined) return clen(c.content);
    if (c.source && typeof c.source.data === 'string') return c.source.data.length; // inline base64 image
    return JSON.stringify(c).length;
  }
  return 0;
}

function classify(name, input) {
  name = name || '';
  if (name.startsWith('mcp__')) {
    if (/screenshot|snapshot|image|capture/i.test(name)) return 'images';
    return 'mcp';
  }
  if (name === 'Read') {
    const f = (input && input.file_path) || '';
    if (IMG_RE.test(f)) return 'images';
    if (PDF_RE.test(f)) return 'pdf';
    return 'fileReads';
  }
  if (name === 'Bash' || name === 'PowerShell') return 'commandOutput';
  if (name === 'Grep' || name === 'Glob') return 'search';
  if (name === 'WebFetch' || name === 'WebSearch') return 'web';
  if (name === 'Agent' || /^Task/.test(name)) return 'subagents';
  if (name === 'Edit' || name === 'Write' || name === 'NotebookEdit') return 'edits';
  return 'otherTools';
}

const CAT = {
  images:        { label: 'Images / screenshots',          ctrl: 'yes',    profile: 'Screenshot-heavy', tip: "Take fewer screenshots and don't re-read the same image. Verify via text (DOM snapshot, console logs, curl) when a pixel-perfect look isn't required." },
  pdf:           { label: 'PDF / document reads',          ctrl: 'yes',    profile: 'PDF-heavy',        tip: 'Extract only the pages/text you need once into a small file and read that; never re-read the whole PDF each turn.' },
  commandOutput: { label: 'Command output (logs/build)',   ctrl: 'yes',    profile: 'Log-heavy',        tip: 'Pipe noisy commands through head/grep or to a file; print only failures + a summary line (e.g. test runners) instead of full green logs.' },
  fileReads:     { label: 'Code / text file reads',        ctrl: 'partly', profile: 'File-read-heavy',  tip: 'Grep to locate, then Read a narrow line range; avoid re-reading files you just edited or already read this session.' },
  search:        { label: 'Search results (Grep/Glob)',    ctrl: 'yes',    profile: 'Search-heavy',     tip: 'Tighten patterns; use files_with_matches / head_limit instead of dumping full matching content.' },
  web:           { label: 'Web (fetch/search)',            ctrl: 'yes',    profile: 'Web-heavy',        tip: 'Fetch once, summarize, reference the summary; avoid pulling whole pages repeatedly.' },
  subagents:     { label: 'Subagent / task outputs',       ctrl: 'partly', profile: 'Subagent-heavy',   tip: 'Tell subagents to return only the conclusion, not file dumps or raw excerpts.' },
  mcp:           { label: 'MCP tool outputs',              ctrl: 'partly', profile: 'MCP-heavy',        tip: 'Disable MCP servers you never use (list-bloat.cjs); request compact responses where possible.' },
  edits:         { label: 'Edits / writes',                ctrl: 'no',     profile: '',                 tip: '' },
  otherTools:    { label: 'Other tool outputs',            ctrl: 'no',     profile: '',                 tip: '' },
  asstText:      { label: 'Assistant messages (output)',   ctrl: 'partly', profile: 'Verbose-replies',  tip: "The model's own verbosity adds up and is re-read every turn — favor tighter answers." },
  userText:      { label: 'Your messages + tool inputs',   ctrl: 'no',     profile: '',                 tip: '' },
};
const ORDER = ['images', 'pdf', 'commandOutput', 'fileReads', 'search', 'web', 'subagents', 'mcp', 'edits', 'otherTools', 'asstText', 'userText'];

function emptyAcc() {
  return { total: 0, cat: Object.fromEntries(ORDER.map(k => [k, 0])), reads: [] };
}

async function scanFile(full, acc) {
  const idToName = {};
  const idToInput = {};
  const rl = readline.createInterface({ input: fs.createReadStream(full), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    const m = o.message || o;
    const role = m.role || o.type;
    const content = m.content;
    if (!Array.isArray(content)) {
      if (typeof content === 'string') {
        const L = content.length;
        acc.total += L;
        acc.cat[role === 'assistant' ? 'asstText' : 'userText'] += L;
      }
      continue;
    }
    for (const it of content) {
      if (it.type === 'tool_use') {
        if (it.id) { idToName[it.id] = it.name; idToInput[it.id] = it.input || {}; }
        const L = clen(it.input);
        acc.total += L; acc.cat.userText += L;
      } else if (it.type === 'tool_result') {
        const L = clen(it.content);
        const name = idToName[it.tool_use_id] || '?';
        const input = idToInput[it.tool_use_id] || {};
        const cat = classify(name, input);
        acc.total += L; acc.cat[cat] = (acc.cat[cat] || 0) + L;
        if (name === 'Read') {
          const f = (input.file_path) || '?';
          acc.reads.push({ f, size: L, ranged: input.offset != null || input.limit != null, img: IMG_RE.test(f) });
        }
      } else if (it.type === 'text') {
        const L = clen(it.text);
        acc.total += L;
        acc.cat[role === 'assistant' ? 'asstText' : 'userText'] += L;
      } else if (it.type === 'image') {
        const L = clen(it);
        acc.total += L; acc.cat.images += L;
      }
    }
  }
  return acc;
}

async function scanFiles(files, acc) {
  acc = acc || emptyAcc();
  for (const f of files) { try { await scanFile(f, acc); } catch { /* skip unreadable */ } }
  return acc;
}

function readWaste(reads) {
  const seen = {};
  let reread = 0, rereadCode = 0, fullFile = 0, fullFileCode = 0;
  for (const r of reads) {
    if (seen[r.f] !== undefined) { reread += r.size; if (!r.img) rereadCode += r.size; }
    seen[r.f] = 1;
    if (!r.ranged) { fullFile += r.size; if (!r.img) fullFileCode += r.size; }
  }
  return { reread, rereadCode, fullFile, fullFileCode, uniq: Object.keys(seen).length, count: reads.length };
}

const pctOf = (x, t) => t ? +(100 * x / t).toFixed(1) : 0;

function summarize(acc) {
  const rows = ORDER.map(k => ({ key: k, ...CAT[k], tok: acc.cat[k] || 0, pct: pctOf(acc.cat[k] || 0, acc.total) }))
    .filter(r => r.tok > 0).sort((a, b) => b.tok - a.tok);
  const dom = rows.find(r => (r.ctrl === 'yes' || r.ctrl === 'partly') && r.profile) || null;
  return { totalTok: Math.round(acc.total / CHARS_PER_TOK), rows, waste: readWaste(acc.reads), dom };
}

module.exports = { CHARS_PER_TOK, IMG_RE, PDF_RE, clen, classify, CAT, ORDER, emptyAcc, scanFile, scanFiles, readWaste, summarize, pctOf };
