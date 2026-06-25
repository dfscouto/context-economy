# context-economy

> A Claude Code skill that cuts token and context spend on large or long-running projects. It keeps the
> project's durable truth in lean docs instead of the chat, and trims the static overhead of installed skills
> and MCP servers that pads every session. All tooling runs locally, so it costs zero AI tokens.

## Use it in chat
Say `/context-economy` (or "run context economy on this project", "how do I cut token spend here"). The agent audits
the project, builds or tightens a boot-loader `CLAUDE.md` plus a handoff doc, shows you where your tokens go
(history vs work) and what your installed skills and MCP cost per session, and tells you when to `/clear`.

## Install (once per machine)
1. Copy the `context-economy` folder into `~/.claude/skills/`.
2. Install the two light hooks:
   ```bash
   node ~/.claude/skills/context-economy/scripts/install.cjs
   ```
   (On Windows use the absolute path: `node "C:\Users\<you>\.claude\skills\context-economy\scripts\install.cjs"`.)
3. Restart Claude Code.

This wires two `SessionStart` hooks that print to the terminal: a usage breakdown on `/clear`, and a
`📦 …tok/session` overhead line on each start.

## What it does to your machine (transparency)
- It edits your global `~/.claude/settings.json` to add the two SessionStart hooks (and removes its own older,
  heavier hooks). Run `install.cjs --dry-run` to see the change without writing.
- It reads, locally: your Claude Code session logs (`~/.claude/projects/**/*.jsonl`), `~/.claude.json` (your
  skill and MCP inventory), and the project you point it at.
- It writes, locally: `dashboard/data.js` (your usage, gitignored) and, when you ask, a `CLAUDE.md` or handoff
  in the project.
- It sends nothing anywhere. It makes no network calls and collects no telemetry. Everything stays on your machine.

## The discipline (what actually saves tokens)
One session, one task: update the handoff, commit, then `/clear`. Switching topics? `/clear` first. For heavy
reads, delegate to a subagent. Turn off skills and MCP you don't use (`list-bloat` shows the cost). The skill
sets up the terrain; the saving comes from the habit.

## Dashboard (open it, this is where the decisions are)
After installing, open **`dashboard/index.html`** in a browser (local file, F5 to refresh). Built from your own
logs, it shows: where your tokens go (history vs work), whether long sessions cost more, and **which installed
skills cost the most per session** (estimated, ranked).

**To turn skills on/off with buttons** (not just read the chart), run the local server and open the URL it prints:
```bash
node ~/.claude/skills/context-economy/scripts/dashboard-serve.cjs
# → http://127.0.0.1:3847/
```
Each skill has an Enable/Disable button (moves the folder to `~/.claude/skills.disabled/`). Restart Claude Code
after toggling. CLI equivalent: `node scripts/toggle-skill.cjs off <skill>`.

Terminal-only report: `node scripts/dashboard.cjs --report`. Paste-ready disable commands: `list-bloat.cjs --off`.
Per-skill costs are estimates (chars÷4), good for ranking, not exact numbers.

## Scripts
- `scripts/precheck.cjs`: safety and scope check before writing (is it the right moment?).
- `scripts/usage.cjs`: history-vs-work breakdown (the `/clear` hook).
- `scripts/dashboard.cjs` + `dashboard/index.html`: daily dashboard (file-mode, F5).
- `scripts/dashboard-serve.cjs`: same dashboard + skill toggle API (`http://127.0.0.1:3847/`).
- `scripts/toggle-skill.cjs`: CLI on/off for skills.
- `scripts/list-bloat.cjs`: static per-session overhead of installed skills and MCP.
- `scripts/context-profile.cjs`: where your conversation tokens actually go (images / PDFs / logs / file reads / web) and your biggest controllable leak. Also auto-summarized in one line on `/clear`.
- `scripts/install.cjs`: installs the two SessionStart hooks.

## Notes
- Tested on Windows. The scripts are plain Node (`.cjs`) with relative paths, so they should work on macOS and
  Linux too, but that's untested.
- The "when to `/clear`" reminder is relayed by the agent in chat, because Claude Code doesn't always surface
  Stop-hook output. The agent tells you "🟢 time to `/clear`" when you close a delivery.
- Tests: `npm test` (Node's built-in runner, no dependencies).

## License
MIT. Yours to use, fork, and share.
