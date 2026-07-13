#!/usr/bin/env node
/**
 * context-economy · bash-guard — PreToolUse hook (Bash / PowerShell).
 *
 * Fires when the command is a known BIG-OUTPUT dumper running without any output
 * cap (tail/head/-n/--quiet/redirect). Build logs and package installs routinely
 * dump 500–5000 lines into context, re-read every turn afterwards.
 *
 * Conservative on purpose: only patterns with a high dump probability, and it
 * stays silent as soon as ANY capping construct is present in the command.
 *
 * Never blocks. Disable for one session: CE_BASHGUARD=off
 */
'use strict';

// A command is considered "capped" if it pipes/limits/redirects its output.
const CAPPED = /\|\s*(tail|head|grep|findstr|sed|awk|wc|Select-Object|Select-String|Out-Null)|>\s*\S|--quiet|--silent|\s-q(\s|$)|-o\s+\S+\.(log|txt)|2>&1\s*\|/i;

// High-probability dumpers → short reason used in the nudge.
const DUMPERS = [
  [/\bnpm\s+(install|ci|update)\b/i,            'npm install prints hundreds of lines'],
  [/\bnpm\s+run\s+build\b|\byarn\s+build\b|\bpnpm\s+build\b/i, 'build logs are huge'],
  [/\bpip3?\s+install\b/i,                      'pip install prints hundreds of lines'],
  [/\bgit\s+log\b(?!.*\s-n\s*\d|.*--max-count|.*\s-\d)/i, 'git log without -n dumps the whole history'],
  [/\bgit\s+diff\b(?!.*--stat|.*--name-only|.*--shortstat)/i, 'a full git diff can be thousands of lines'],
  [/\b(npx\s+)?(tsc|eslint|prettier)\b(?!.*--quiet)/i, 'linter/compiler output can be very long'],
  [/\b(gradle|mvn|cargo\s+build|dotnet\s+build|make)\b/i, 'build output is very long'],
  [/\bfind\s+\/|\bGet-ChildItem\b.*-Recurse/i,  'recursive listings can be thousands of lines'],
];

let raw = '';
process.stdin.on('data', d => (raw += d));
process.stdin.on('end', () => {
  try {
    if (process.env.CE_BASHGUARD === 'off') return;
    let payload = {};
    try { payload = JSON.parse(raw); } catch {}

    const tool = String(payload.tool_name || '');
    if (!/^(Bash|PowerShell)$/i.test(tool)) return;

    const cmd = String((payload.tool_input || {}).command || '');
    if (!cmd || CAPPED.test(cmd)) return;

    const hit = DUMPERS.find(([re]) => re.test(cmd));
    if (!hit) return;

    const note =
      '[context-economy · bash-guard] This command tends to dump big output (' + hit[1] + '), '
      + 'and everything it prints enters context and is re-read every turn. '
      + 'Prefer capping it: append `| tail -20`, use a quiet flag (`--quiet`/`-q`), or grep just '
      + 'the failing slice. If the full output is genuinely needed, redirect to a file and Read a slice.';

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { additionalContext: note },
    }));
  } catch { /* never block Claude on a guard error */ }
});
