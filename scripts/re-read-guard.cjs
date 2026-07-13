#!/usr/bin/env node
/**
 * context-economy · re-read-guard — PreToolUse hook.
 *
 * Fires on the Read tool. Two nudges:
 *   1) second+ read of the same file_path within a session → content is already
 *      in context; re-reading adds the entire file again.
 *   2) FIRST read of a big file (>100 KB) without offset/limit → suggest slicing
 *      (Grep + offset/limit) or delegating to a subagent.
 *
 * State: a tiny JSON file in %TEMP% keyed by session_id (fallback: transcript path).
 * One file per session → no cross-session leakage; OS eventually cleans up.
 *
 * Never blocks. Claude decides whether to proceed — this is a nudge.
 * Disable for one session: CE_REGUARD=off
 */
'use strict';
const fs   = require('fs');
const path = require('path');
const os   = require('os');

let raw = '';
process.stdin.on('data', d => (raw += d));
process.stdin.on('end', () => {
  try {
    if (process.env.CE_REGUARD === 'off') return;
    let payload = {};
    try { payload = JSON.parse(raw); } catch {}

    const tool = String(payload.tool_name || '');
    if (tool !== 'Read') return; // safety: only fire on the Read tool

    const input = payload.tool_input || {};
    const filePath = String(input.file_path || '');
    if (!filePath) return;

    // session-scoped state file — session_id comes in every PreToolUse payload;
    // transcript_path is the fallback for older Claude Code versions.
    const sidSource = String(payload.session_id || '')
      || path.basename(String(payload.transcript_path || ''), '.jsonl');
    if (!sidSource) return;
    const sessionId = sidSource.replace(/[^a-zA-Z0-9_-]/g, '_');
    const stateFile = path.join(os.tmpdir(), 'ce-reguard-' + sessionId + '.json');

    let seen = [];
    try { seen = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch {}
    if (!Array.isArray(seen)) seen = [];

    // Windows paths are case-insensitive — C:\Code\x.js and c:\code\X.js are the same file.
    let normalised = path.normalize(filePath);
    if (process.platform === 'win32') normalised = normalised.toLowerCase();
    if (!seen.includes(normalised)) {
      seen.push(normalised);
      try { fs.writeFileSync(stateFile, JSON.stringify(seen)); } catch {}

      // First read of a BIG file without offset/limit: nudge to slice or delegate.
      // 100 KB ≈ 25k tokens entering context in one call, re-read every turn after.
      const hasSlice = input.offset != null || input.limit != null || input.pages != null;
      if (!hasSlice) {
        let size = 0;
        try { size = fs.statSync(filePath).size; } catch {}
        if (size > 100 * 1024) {
          const kb = Math.round(size / 1024);
          const relBig = filePath.length > 70 ? '…' + filePath.slice(-67) : filePath;
          process.stdout.write(JSON.stringify({
            hookSpecificOutput: { additionalContext:
              '[context-economy · re-read-guard] `' + relBig + '` is ' + kb + ' KB and this Read has no '
              + 'offset/limit — the whole file enters context (roughly ' + Math.round(kb / 4) + 'k tokens, '
              + 're-read every turn). Prefer: Grep for the symbol first, Read with offset/limit around it, '
              + 'or delegate to a subagent ("read X, return a 10-line summary + anchors").' },
          }));
        }
      }
      return; // first read — no re-read warning
    }

    // second+ read of the same file
    const rel = filePath.length > 70 ? '…' + filePath.slice(-67) : filePath;
    const note =
      '[context-economy · re-read-guard] '
      + '`' + rel + '` was already read in this session. '
      + 'Re-reading adds the full file to context again (re-read every turn). '
      + 'If the content is still in context, use it directly. '
      + 'Re-read ONLY if the file may have changed since the last read (e.g. after an Edit by another agent).';

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { additionalContext: note },
    }));
  } catch { /* never block Claude on a guard error */ }
});
