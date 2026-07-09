#!/usr/bin/env node
/**
 * context-economy · re-read-guard — PreToolUse hook.
 *
 * Fires on the Read tool. On the second+ read of the same file_path within
 * a session, injects a reminder that the content is already in context and
 * re-reading adds the entire file again (re-read every turn by the model).
 *
 * State: a tiny JSON file in %TEMP% keyed by session transcript path.
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

    const filePath = String((payload.tool_input || {}).file_path || '');
    if (!filePath) return;

    const transcriptPath = String(payload.transcript_path || '');
    if (!transcriptPath) return;

    // session-scoped state file
    const sessionId = path.basename(transcriptPath, '.jsonl').replace(/[^a-zA-Z0-9_-]/g, '_');
    const stateFile = path.join(os.tmpdir(), 'ce-reguard-' + sessionId + '.json');

    let seen = [];
    try { seen = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch {}
    if (!Array.isArray(seen)) seen = [];

    const normalised = path.normalize(filePath);
    if (!seen.includes(normalised)) {
      seen.push(normalised);
      try { fs.writeFileSync(stateFile, JSON.stringify(seen)); } catch {}
      return; // first read — no warning
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
