#!/usr/bin/env node
// context-economy · model-advisor — UserPromptSubmit hook.
//
// Default model: Sonnet. This hook NEVER switches the model (hooks can't) and
// NEVER blocks the prompt. It watches for strong "likely needs Opus" signals and
// injects a one-line nudge asking Claude to suggest `/model opus` — only if it
// isn't already on Opus. Conservative: silent on everything else.
//
// Opt-in: node install.cjs --model-advisor
// Disable for one session: CE_MODEL_ADVISOR=off

let raw = '';
process.stdin.on('data', d => (raw += d));
process.stdin.on('end', () => {
  try {
    if (process.env.CE_MODEL_ADVISOR === 'off') return;

    let prompt = '';
    try { prompt = (JSON.parse(raw) || {}).prompt || ''; } catch { prompt = raw || ''; }
    prompt = String(prompt);
    if (prompt.length < 12) return;

    const text = prompt.toLowerCase();

    // Strong escalation signals (PT + EN). Each regex targets a distinct reasoning mode.
    const SIGNALS = [
      // ── architecture / system design ─────────────────────────────────────────
      /\barquitetura?l?\b/, /\bdesign de sistema\b/, /\bsystem design\b/,
      /\bmodelagem\b/, /\bprojet(e|ar|o)\b/,
      /\barchitect(ure|ural)?\b/,

      // ── strategy / planning ───────────────────────────────────────────────────
      /\bestrat[ée]gia\b/, /\bstrateg(y|ic|ize)\b/,
      /\bplanej(e|ar|amento)\b/, /\broad[- ]?map\b/,
      /\bhow should (i|we) approach\b/, /\bcomo (eu |a gente |n[oó]s )?devo (abordar|atacar|tratar)\b/,
      /\bbest approach\b/, /\bmelhor abordagem\b/,

      // ── trade-off / decision ──────────────────────────────────────────────────
      /\btrade-?offs?\b/, /\bpr[óo]s e contras\b/, /\bpros and cons\b/,
      /\bdecis(ão|ões)\b/, /\bdecida entre\b/, /\bdecide between\b/,
      /\bcompare (options|approaches|alternatives)\b/,
      /\bcompar(e|ar|ando) (opç|abordagem|alternativa)/,

      // ── deep debugging / root cause ───────────────────────────────────────────
      /\bdepur(e|ar)\b/, /\bdebug(ar|ging|ger)?\b/,
      /\brace[- ]condition\b/, /\bdeadlock\b/,
      /\bcausa[- ]raiz\b/, /\broot[- ]cause\b/,
      /\bwhy (does|is|are|did|doesn't|isn't)\b/,
      /\bpor ?que .*(falh|quebr|n[ãa]o funciona|erro)/,
      /\bwhat('s| is) wrong\b/, /\bo que est[aá] errado\b/,
      /\binvestigate\b/, /\binvestigar?\b/,

      // ── algorithmic / complexity ──────────────────────────────────────────────
      /\balgoritmo\b/, /\balgorithm\b/, /\bcomplexidade\b/, /\bcomplexity\b/,
      /\boptimiz(e|ation|ar)\b/, /\botimiz(ar|ação)\b/,

      // ── security / audit ──────────────────────────────────────────────────────
      /\bthreat[- ]model\b/, /\bauditor[íi]a\b/, /\baudit\b/,
      /\bsecurity review\b/, /\breview de segurança\b/,

      // ── redesign / refactor ───────────────────────────────────────────────────
      /\bredesenh(e|ar)\b/, /\brefator(e|ar) a arquitetura\b/,
      /\boverhaul\b/, /\brewrite\b/,

      // ── research / deep analysis ──────────────────────────────────────────────
      /\bdeep[- ]research\b/, /\bpesquisa profunda\b/,
      /\bexhaustive(ly)?\b/, /\bcomprehensive (analysis|review|audit)\b/,
      /\banálise (profunda|completa|detalhada)\b/,
      /\bultra[- ]?review\b/, /\bcode[- ]review ultra\b/,
    ];

    const hasSignal = SIGNALS.some(re => re.test(text));
    const longAnalytical = prompt.length > 1800
      && /(an[áa]lis|avali|compar|trade|arquitet|estrat|analysis|evaluat|architect|strateg)/.test(text);

    if (!hasSignal && !longAnalytical) return;

    const why = hasSignal ? 'high-judgment task signals' : 'long analytical prompt';
    const note =
      '[context-economy · model-advisor] Detected: ' + why + '. '
      + 'If you are NOT already on Opus, start your response with ONE short line: '
      + '"💡 `model opus` recommended for this task (you are on Sonnet by default)". '
      + 'If already on Opus, or the task is actually simple, ignore this silently.';

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { additionalContext: note },
    }));
  } catch {
    // never block the prompt on an advisor error
  }
});
