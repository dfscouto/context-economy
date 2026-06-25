# Changelog

## v1.0.0 (2026-06-24)

First public release.

- **Docs as truth:** lean boot-loader `CLAUDE.md` + a handoff doc so durable state lives in files, not the chat — a `/clear` between tasks no longer re-reads the whole history.
- **Local measurement (zero AI tokens):** history-vs-work usage breakdown, per-session skill/MCP overhead, and a daily dashboard built from your own logs.
- **`context-profile.cjs`:** shows where your conversation tokens actually go (images / PDFs / command logs / file reads / web / subagents) and names your biggest controllable leak — everyone's is different.
- **Two light `SessionStart` hooks** (usage on `/clear`, overhead line each start), installed via `install.cjs`; safe atomic write with backup.
- **Skill on/off toggle** (CLI + dashboard) to drop overhead from skills/MCP you don't use.
