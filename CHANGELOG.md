# Changelog

## v1.2.0 (2026-07-12)

Guards that actually fire. A multi-agent audit against real usage data (171 screenshots in 14 days
WITH the guard "on") found the root cause: hooks that never triggered. All confirmed findings fixed;
the ones accepted as won't-fix are recorded at the bottom of this entry — the list is closed.

**Fixed (was silently broken):**
- **screenshot-guard never fired** — the PreToolUse matcher `'screenshot'` is EXACT-match in Claude
  Code, and no real tool is named that. Now an unanchored regex (`screenshot|__computer`), and the
  guard also checks `tool_input.action` so computer-family tools (`mcp__*__computer`) are covered.
  Screenshot COUNTING (aggregate + meter) got the same fix — the old counts were undercounts.
- **session-meter was invisible** — Stop-hook plain stdout is dropped by most UIs. Now emits
  `{systemMessage}` (guaranteed visible), and a NEW screenshot forces an early report instead of
  waiting for the next multiple-of-10 turn.
- **model-advisor only pushed UP (to Opus)** — the direction that exhausts the Opus-weighted weekly
  cap. Now it also nudges DOWN: on Opus + routine prompt → suggests `/model sonnet`, at most once per
  session. Current model comes from the transcript tail (`.model` of the last assistant message).
- **re-read-guard hardening** — keys state on `session_id` (transcript path as fallback) and
  case-folds paths on Windows.

**New:**
- **📅 daily digest** (SessionStart): yesterday's real numbers in one line — billed tokens, Opus %,
  screenshots, messages. The data was already computed; now it's in your face every morning.
- **big-file Read nudge** — first Read of a >100 KB file without `offset`/`limit` suggests
  Grep + slice or a subagent.
- **bash-guard** — big-output commands (`npm install`, builds, `git log` with no `-n`…) running
  without a cap (`| tail`, `--quiet`, redirect) get a one-line nudge.
- **toggle-mcp.cjs** — on/off for LOCAL MCP servers in `~/.claude.json` (atomic write + backup).
  Managed connectors still need `/mcp` — that's a platform limit, stated honestly.
- **redundant-MCP detector** (list-bloat) — flags ≥2 active servers in the same category
  (e.g. 5 browser/desktop-automation MCPs ≈ 18k tok/session combined) and says which lever to pull.

**Won't-fix (closed by decision, not inertia):**
- Weekly-cap countdown: Anthropic doesn't publish numeric caps; inventing a % would violate the
  skill's own honesty rule. The official % lives in claude.ai → Settings → Usage.
- Image-paste detector hook: pasted images aren't reliably visible in hook payloads; the guidance
  lives in the screenshot-guard note + global CLAUDE.md rule instead.
- Subagent output-cap hook: already covered as instruction in SKILL.md; a hook would be noise.
- PreToolUse timing (the nudge lands after the call is decided): structural; mitigated by the
  standing rule injected at session level. Blocking via `permissionDecision: "ask"` was rejected —
  it would turn every legitimate screenshot into a permission prompt.

## v1.1.0 (2026-06-27)

Decision-focused dashboard + model-choice lever.

- **Consolidated chart:** one combo panel — cost/day **stacked by model** (Opus / Sonnet / Haiku / Fable) with an **overlay line** showing **avg/turn** (cost per turn — a dimension the bars don't already echo; the redundant volume line was dropped) — plus a one-line **model-decision** synthesis below (Opus % + what to shift to Sonnet). Answers the weekly "all models" cap at a glance: how much you spent, how much is Opus, and the efficiency per turn. (Replaces the earlier separate bars / cost×volume tabs.)
- **Plan auto-detection:** reads only `subscriptionType` + `rateLimitTier` from `~/.claude/.credentials.json` (never tokens) → Pro / Max 5× / Max 20×, shown as a badge.
- **Model-advisor nudge (opt-in):** a `UserPromptSubmit` hook that suggests `/model opus` on high-judgment prompts. It never switches the model and never blocks. Enable with `install.cjs --model-advisor`; silence with `CE_MODEL_ADVISOR=off`. Pairs with a Sonnet default (a user choice the installer never makes for you).
- **Honest framing kept:** the dashboard shows per-model intensity, not the official plan %; the real % lives in claude.ai → Settings → Usage.
- **Skill on/off buttons fixed:** they need the local server, but opening `index.html` as a `file://` page left them dead ("Servidor offline"). Now the server **opens your browser** on start (`--no-open` to suppress), there's a Windows **`dashboard.cmd`** double-click launcher, and a banner tells you what to do if you opened the file directly.

## v1.0.0 (2026-06-24)

First public release.

- **Docs as truth:** lean boot-loader `CLAUDE.md` + a handoff doc so durable state lives in files, not the chat — a `/clear` between tasks no longer re-reads the whole history.
- **Local measurement (zero AI tokens):** history-vs-work usage breakdown, per-session skill/MCP overhead, and a daily dashboard built from your own logs.
- **`context-profile.cjs`:** shows where your conversation tokens actually go (images / PDFs / command logs / file reads / web / subagents) and names your biggest controllable leak — everyone's is different.
- **Two light `SessionStart` hooks** (usage on `/clear`, overhead line each start), installed via `install.cjs`; safe atomic write with backup.
- **Skill on/off toggle** (CLI + dashboard) to drop overhead from skills/MCP you don't use.
