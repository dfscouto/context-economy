#!/usr/bin/env node
/**
 * context-economy · screenshot-guard — PreToolUse hook.
 *
 * Fires on any tool whose name contains "screenshot", and on the computer-family
 * tools (mcp__*__computer) when tool_input.action is screenshot/zoom. Injects a
 * one-line reminder: prefer preview_snapshot (text DOM, ~1k tok) over
 * preview_screenshot (base64 image, ~500–2000k tok) when the goal is
 * structural/text verification rather than pixel-level inspection.
 *
 * Never blocks. Claude decides whether to proceed — this is a nudge, not a gate.
 * Disable for one session: CE_GUARD=off
 */
'use strict';

let raw = '';
process.stdin.on('data', d => (raw += d));
process.stdin.on('end', () => {
  try {
    if (process.env.CE_GUARD === 'off') return;
    let payload = {};
    try { payload = JSON.parse(raw); } catch {}
    const tool = String(payload.tool_name || '');
    const action = String((payload.tool_input || {}).action || '');
    // Fire on: (a) tools whose NAME contains "screenshot" (mcp__computer-use__screenshot,
    // browser_take_screenshot, preview_screenshot…), or (b) the computer-family tools
    // (mcp__Claude_Browser__computer, mcp__claude-in-chrome__computer) when the screenshot
    // is the ACTION inside tool_input — the name alone never says "screenshot" there.
    const isScreenshot = /screenshot/i.test(tool)
      || (/__computer/i.test(tool) && /^(screenshot|zoom)$/i.test(action));
    if (!isScreenshot) return; // e.g. computer-tool clicks/typing pass through silently

    const note =
      '[context-economy · screenshot-guard] '
      + 'A screenshot enters context as a heavy image (~500–2000k tok, re-read every turn). '
      + 'Prefer preview_snapshot (DOM as text, ~1k tok) to verify text, structure, or errors. '
      + 'Use screenshot ONLY when you need to see visual layout or pixel-level detail. '
      + 'If you take one, do not repeat it — re-use the result of this call. '
      + '⚠️ The same applies to images pasted by the user in chat: each pasted image enters the conversation history and is re-read every turn, same cost as a screenshot. '
      + 'Guide the user to prefer text (paste errors as text, describe what they see, use preview_snapshot) instead of pasting screenshots.';

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { additionalContext: note },
    }));
  } catch { /* never block Claude on a guard error */ }
});
