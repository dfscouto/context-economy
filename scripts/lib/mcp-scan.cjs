/*
 * context-economy / mcp-scan.cjs
 * Discovers the MCPs ACTUALLY in play in a session — including the connectors managed
 * by the platform (claude.ai/enterprise), which do NOT live in ~/.claude.json or in .mcp.json.
 *
 * Why read the transcript: ~/.claude.json only lists the MCPs configured locally
 * (often 1, or none). Managed connectors are injected by the runtime and only
 * appear in the session logs, as calls/mentions `mcp__<server>__<tool>`. So the log
 * is the only local source that sees the real MCP overhead.
 */
const fs = require('fs');
const path = require('path');
const { resolveLogDir } = require('./paths.cjs');

// Cost of an MCP tool in the prompt — two regimes:
//   • deferred (ToolSearch): only the tool NAME enters the system prompt until it's fetched → floor
//   • inline: the full schema (name+description+JSONSchema of the params) enters → ceiling
// base = fixed overhead per server (instructions/wrapper). floor = guess when there is no
// tool count (no readable log). These are ESTIMATES — good for ranking, not for the exact number.
const MCP_TOK = { base: 150, perName: 15, perSchema: 200, floor: 800 };

function newestTranscript(projectDir) {
  const dir = resolveLogDir(projectDir || process.cwd());
  if (!dir || !fs.existsSync(dir)) return null;
  let best = null, bestM = -1;
  let files = [];
  try { files = fs.readdirSync(dir); } catch { return null; }
  for (const f of files) {
    if (!f.endsWith('.jsonl')) continue;
    const full = path.join(dir, f);
    let m; try { m = fs.statSync(full).mtimeMs; } catch { continue; }
    if (m > bestM) { bestM = m; best = full; }
  }
  return best;
}

// names that are NOT real servers — they come from docs/placeholders citing `mcp__server__tool`
// (happens when the transcript being read talks about the tool itself).
const NOT_A_SERVER = new Set(['server', 'servidor', 'name', 'tool']);

// Reads the project's most recent transcript and extracts { serverKey: { name, tools:Set } }.
// Synchronous on purpose (just 1 file) so the whole scanBloat chain doesn't become async.
function discoverSessionMcp(projectDir) {
  const file = newestTranscript(projectDir);
  if (!file) return { servers: {}, file: null };
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return { servers: {}, file: null }; }

  const servers = {};
  const re = /mcp__[A-Za-z0-9_-]+/g;
  let m;
  while ((m = re.exec(text))) {
    const parts = m[0].split('__');
    if (parts.length < 3) continue;            // needs the mcp__server__tool form
    const name = parts[1];
    const tool = parts.slice(2).join('__');
    if (!name || !tool) continue;
    if (NOT_A_SERVER.has(name.toLowerCase())) continue;
    const key = name.toLowerCase().replace(/[-_]+/g, ''); // unifies Claude_in_Chrome ↔ claude-in-chrome
    (servers[key] || (servers[key] = { name, tools: new Set() })).tools.add(tool);
  }
  return { servers, file };
}

// Per-server estimate from the tool count. Returns a floor→ceiling range.
function estMcpServerTokens(toolCount) {
  if (!(toolCount > 0)) {
    return { est: MCP_TOK.floor, lo: MCP_TOK.floor, hi: MCP_TOK.floor, basis: 'floor' };
  }
  const lo = MCP_TOK.base + toolCount * MCP_TOK.perName;   // deferred: only names in the prompt
  const hi = MCP_TOK.base + toolCount * MCP_TOK.perSchema;  // inline: full schemas
  return { est: lo, lo, hi, basis: 'tools' };
}

module.exports = { discoverSessionMcp, estMcpServerTokens, newestTranscript, MCP_TOK };
