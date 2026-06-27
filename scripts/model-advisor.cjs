#!/usr/bin/env node
// context-economy · model advisor — a UserPromptSubmit hook.
//
// The default model is Sonnet (set in settings.json). This hook NEVER switches the
// model (Claude Code hooks can't) and NEVER blocks the prompt. It only watches for a
// few STRONG "this likely needs Opus" signals and, when it sees one, injects a short
// note asking the assistant to suggest `/model opus` — but only if it isn't already on
// Opus. Conservative by design: silent on everything else (which stays on Sonnet).
//
// Disable anytime with env CE_MODEL_ADVISOR=off.

let raw = '';
process.stdin.on('data', d => (raw += d));
process.stdin.on('end', () => {
  try {
    if (process.env.CE_MODEL_ADVISOR === 'off') return;

    let prompt = '';
    try { prompt = (JSON.parse(raw) || {}).prompt || ''; } catch { prompt = raw || ''; }
    prompt = String(prompt);
    if (prompt.length < 12) return; // trivial/short — stay quiet

    const text = prompt.toLowerCase();

    // Strong escalation signals: high-judgment reasoning, design/architecture, hard debugging.
    const SIGNALS = [
      /\barquitetura?l?\b/, /\bprojet(e|ar|o)\b/, /\bdesign de sistema\b/, /\bmodelagem\b/,
      /\bestrat[ée]gia\b/, /\bplanej(e|ar|amento)\b/, /\broadmap\b/,
      /\btrade-?offs?\b/, /\bpr[óo]s e contras\b/, /\bdecis(ão|ões)\b/, /\bdecida entre\b/,
      /\bdepur(e|ar)\b/, /\bdebug(ar|ging)?\b/, /\brace condition\b/, /\bdeadlock\b/,
      /\bcausa[- ]raiz\b/, /\broot cause\b/, /\bwhy does\b/,
      /\bpor ?que .*(falh|quebr|n[ãa]o funciona)/,
      /\balgoritmo\b/, /\bcomplexidade\b/,
      /\bthreat model\b/, /\bauditori?a\b/, /\bredesenh(e|ar)\b/,
      /\brefator(e|ar) a arquitetura\b/, /\bdeep research\b/, /\bpesquisa profunda\b/,
    ];
    const hasSignal = SIGNALS.some(re => re.test(text));
    const longAnalytical = prompt.length > 1800 && /(an[áa]lis|avali|compar|trade|arquitet|estrat)/.test(text);
    if (!hasSignal && !longAnalytical) return;

    const why = hasSignal ? 'sinais de tarefa de alto julgamento' : 'prompt longo e analítico';
    const note = '[context-economy · model-advisor] Este prompt bateu em ' + why
      + '. Se você NÃO estiver já no Opus e a qualidade importar aqui, comece a resposta com UMA linha: '
      + '"💡 tarefa de alto julgamento — considere `/model opus` (você está no Sonnet por padrão)". '
      + 'Se já estiver no Opus, ou se a tarefa for na verdade simples, ignore isto em silêncio.';

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: note },
    }));
  } catch {
    // never block the prompt on an advisor error
  }
});
