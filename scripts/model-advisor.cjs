#!/usr/bin/env node
// context-economy · model-advisor — UserPromptSubmit hook.
//
// Default model: Sonnet. This hook NEVER switches the model (hooks can't) and
// NEVER blocks the prompt. Two directions:
//   UP:   strong "needs Opus" signals + not on Opus → suggest `/model opus`.
//   DOWN: on Opus + routine prompt (no signals)     → suggest `/model sonnet`,
//         at most ONCE per session (the weekly cap is Opus-weighted — the down
//         direction is what actually saves the plan limit).
//
// Current model: the payload doesn't carry it, so we read the `.model` field of
// the last assistant message in the session transcript (tail read, ~64KB max).
//
// Opt-in: node install.cjs --model-advisor
// Disable for one session: CE_MODEL_ADVISOR=off
const fs   = require('fs');
const path = require('path');
const os   = require('os');

// Best-effort proxy for the ACTIVE model: last `"model":"claude-…"` in the
// transcript tail. Returns '' when unknown (missing/young transcript).
function currentModel(transcriptPath) {
  try {
    if (!transcriptPath || !fs.existsSync(transcriptPath)) return '';
    const size = fs.statSync(transcriptPath).size;
    const CHUNK = 64 * 1024;
    const start = Math.max(0, size - CHUNK);
    const buf = Buffer.alloc(size - start);
    const fd = fs.openSync(transcriptPath, 'r');
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    const tail = buf.toString('utf8');
    let m, last = '';
    const re = /"model"\s*:\s*"(claude-[^"]+)"/g;
    while ((m = re.exec(tail))) last = m[1];
    return last.toLowerCase();
  } catch { return ''; }
}

let raw = '';
process.stdin.on('data', d => (raw += d));
process.stdin.on('end', () => {
  try {
    if (process.env.CE_MODEL_ADVISOR === 'off') return;

    let payload = {};
    try { payload = JSON.parse(raw) || {}; } catch {}
    let prompt = String(payload.prompt || (typeof payload === 'string' ? payload : '') || '');
    if (!prompt && typeof raw === 'string' && raw && raw[0] !== '{') prompt = raw;
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

    const model = currentModel(payload.transcript_path);
    const onOpus = model.includes('opus');

    let note = '';

    if (hasSignal || longAnalytical) {
      // UP: hard task. Skip when we KNOW it's already on Opus.
      if (onOpus) return;
      const why = hasSignal ? 'high-judgment task signals' : 'long analytical prompt';
      note =
        '[context-economy · model-advisor] Detected: ' + why + '. '
        + 'If you are NOT already on Opus, start your response with ONE short line: '
        + '"💡 `model opus` recommended for this task (you are on Sonnet by default)". '
        + 'If already on Opus, or the task is actually simple, ignore this silently.';
    } else if (onOpus && prompt.length < 300) {
      // DOWN: routine prompt on Opus — the direction that saves the weekly cap.
      // At most once per session, so it never becomes a nag.
      const sid = String(payload.session_id || path.basename(String(payload.transcript_path || 'x'), '.jsonl'))
        .replace(/[^a-zA-Z0-9_-]/g, '_');
      const stateFile = path.join(os.tmpdir(), 'ce-advisor-' + sid + '.json');
      try { if (JSON.parse(fs.readFileSync(stateFile, 'utf8')).down) return; } catch {}
      try { fs.writeFileSync(stateFile, JSON.stringify({ down: true })); } catch {}
      note =
        '[context-economy · model-advisor] You are on Opus and this prompt looks routine. '
        + 'The weekly plan cap is Opus-weighted — routine work on Opus is what exhausts it. '
        + 'Start your response with ONE short line: '
        + '"💡 Routine task on Opus — `/model sonnet` frees your weekly cap; switch back with `/model opus` for hard tasks". '
        + 'If the CURRENT task genuinely needs Opus-level judgment (architecture, deep debugging), ignore this silently.';
    } else {
      return;
    }

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { additionalContext: note },
    }));
  } catch {
    // never block the prompt on an advisor error
  }
});
