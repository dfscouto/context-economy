#!/usr/bin/env node
/**
 * context-economy · screenshot-guard — PreToolUse hook.
 *
 * Fires on any tool whose name contains "screenshot" and injects a
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
    if (!/screenshot/i.test(tool)) return; // safety: only fire on screenshot tools

    const note =
      '[context-economy · screenshot-guard] '
      + 'Screenshot entra no contexto como imagem pesada (~500–2000k tok, re-lida a cada turno). '
      + 'Prefira preview_snapshot (DOM em texto, ~1k tok) para verificar texto, estrutura ou erros. '
      + 'Use screenshot APENAS quando precisar ver layout visual ou pixel. '
      + 'Se tirar, não repita — re-use o resultado desta chamada.';

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { additionalContext: note },
    }));
  } catch { /* never block Claude on a guard error */ }
});
