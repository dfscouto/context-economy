# Changelog

## v1.1.0 (2026-06-27)

Decision-focused dashboard + model-choice lever.

- **Consolidated chart:** one combo panel — cost/day **stacked by model** (Opus / Sonnet / Haiku / Fable) with an **overlay line** showing **avg/turn** (cost per turn — a dimension the bars don't already echo; the redundant volume line was dropped) — plus a one-line **model-decision** synthesis below (Opus % + what to shift to Sonnet). Answers the weekly "all models" cap at a glance: how much you spent, how much is Opus, and the efficiency per turn. (Replaces the earlier separate bars / cost×volume tabs.)
- **Plan auto-detection:** reads only `subscriptionType` + `rateLimitTier` from `~/.claude/.credentials.json` (never tokens) → Pro / Max 5× / Max 20×, shown as a badge.
- **Model-advisor nudge (opt-in):** a `UserPromptSubmit` hook that suggests `/model opus` on high-judgment prompts. It never switches the model and never blocks. Enable with `install.cjs --model-advisor`; silence with `CE_MODEL_ADVISOR=off`. Pairs with a Sonnet default (a user choice the installer never makes for you).
- **Honest framing kept:** the dashboard shows per-model intensity, not the official plan %; the real % lives in claude.ai → Settings → Usage.

## v1.0.0 (2026-06-24)

First public release.

- **Docs as truth:** lean boot-loader `CLAUDE.md` + a handoff doc so durable state lives in files, not the chat — a `/clear` between tasks no longer re-reads the whole history.
- **Local measurement (zero AI tokens):** history-vs-work usage breakdown, per-session skill/MCP overhead, and a daily dashboard built from your own logs.
- **`context-profile.cjs`:** shows where your conversation tokens actually go (images / PDFs / command logs / file reads / web / subagents) and names your biggest controllable leak — everyone's is different.
- **Two light `SessionStart` hooks** (usage on `/clear`, overhead line each start), installed via `install.cjs`; safe atomic write with backup.
- **Skill on/off toggle** (CLI + dashboard) to drop overhead from skills/MCP you don't use.
