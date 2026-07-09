---
name: context-economy
description: >-
  Cuts Claude Code token/context spend on large or long-running projects by keeping the project's durable
  truth in lean DOCS (a boot-loader CLAUDE.md + a handoff doc) instead of the chat, AND by trimming the
  static overhead of installed skills/MCP that pads every session. Local tooling only — zero AI tokens.
  Use WHENEVER the user worries about token cost, hitting plan/usage limits (Pro/Max), context getting too
  big, slow/expensive sessions, "how do I save tokens", "you re-read everything", or setting up a project's
  CLAUDE.md/handoff. Triggers in any language (e.g. "save tokens", "context is blowing up", "I hit my
  limit", "set up a CLAUDE.md"). Also "/context-economy", "context economy".
---

# context-economy (boot-loader)

> Write artifacts (CLAUDE.md, handoff) in the **project's language**. Instructions are English.
> Full playbook, anti-patterns, /clear gate details → `docs/reference.md`.

`<skill-dir>` = the folder containing this SKILL.md.
**Hooks** (session-meter, screenshot-guard, re-read-guard) must be installed once: `node <skill-dir>/scripts/install.cjs`. If the user hasn't done this, mention it.

## 0. Pre-flight — run FIRST
```
node <skill-dir>/scripts/precheck.cjs <project-dir>
```
Returns **SAFETY** (don't-write-now %) and **ROI** (potential gain %). Show both. SAFETY 🔴 → stop, don't write.

## 1. Audit — measure, don't guess
```
node <skill-dir>/scripts/usage.cjs          # history vs real work, context profile
node <skill-dir>/scripts/list-bloat.cjs     # static skill/MCP overhead per session
node <skill-dir>/scripts/context-profile.cjs  # where conversation tokens go (images/PDFs/reads)
```
Then synthesize for the user — lead with their **profile** and the **one fix** for it:
1. Name the profile from `context-profile.cjs` output (exact label — see table below).
2. State the real number: "X% of your context is Y — re-read every turn."
3. Give the single most impactful fix for that profile. Don't list everything — one clear action.
4. Follow with: static overhead from `list-bloat.cjs` (tok/session + top unused skills/MCPs to cut).
5. Recommend setting Sonnet as default (`"model": "claude-sonnet-4-6"` in `settings.json`) and escalating with `/model opus` only for hard tasks — the largest single cost lever. To see actual model split: open the dashboard (`dashboard.sh` / `dashboard.cmd`).

| Profile (exact label) | Fix |
|---|---|
| **Screenshot-heavy** | Use `preview_snapshot` (DOM text, ~1k tok) instead of `preview_screenshot` (~500k–2M tok) for structure/text checks. Screenshot only when pixel layout matters. |
| **File-read-heavy** | Read with `offset`/`limit` or delegate to a subagent. Never re-read a file already in context. |
| **Log-heavy** | Pipe only the failing slice (last N lines, grep for ERROR). Never paste full build output. |
| **PDF-heavy** | Summarize via subagent. Keep the summary in context, not the full doc. |
| **Subagent-heavy** | Subagents are fine, but cap their output. Ask for "10-line summary + anchors", not full dumps. |
| **Search-heavy** | Tighten Grep patterns; use `files_with_matches` / `head_limit` instead of dumping full matching content. |
| **Web-heavy** | Fetch once, summarize, reference the summary. Avoid re-fetching the same URL. |
| **MCP-heavy** | Disable MCP servers you don't use (`/mcp` or `list-bloat.cjs`); request compact responses where possible. |
| **Verbose-replies** | Favour tighter answers; cite `file:line` anchors instead of pasting whole blocks back. |

## 2. CLAUDE.md — lean boot-loader
Target < 60 lines: current state (dated) + pointers to docs + region map (Grep anchors) + gotchas.
If already lean and accurate, only fix what's stale. If > 100 lines, split to `docs/` first.
Template: `references/templates.md`.

## 3. Handoff doc
Create/maintain `docs/ANDAMENTO.md` (or `STATUS.md`). Holds: what's done + next step (dated).
Update at the end of EVERY delivery. Commit (or save if no git).
Never put volatile state in CLAUDE.md or memory — point to the handoff instead.

## 4. Discipline
- **1 session = 1 task** → commit + update handoff → `/clear`
- `/compact` if long but continuous; `/clear` on topic switch
- Heavy reads → subagent ("read X, return summary + anchors")
- Grep/Glob → slice; never re-read big files whole
- Turn off skills/MCP you don't use (`list-bloat.cjs` shows what each costs)

## Anti-patterns (one-liners)
- Marathon 1000+ msg sessions without a closed deliverable → `/compact` or close + `/clear`
- 15+ skills, half at 0× in logs → archive via `list-bloat.cjs --off`
- CLAUDE.md > 100 lines re-read every turn → split to `docs/`
- Screenshots when text would do → prefer `preview_snapshot` (~1k tok vs ~1M)
- User pasting images in chat → each re-read every turn; ask them to paste text/log instead
- Re-reading unchanged files → `re-read-guard` hook warns; use context already in window
- Inventing savings % → cite the CPM ratio from `dashboard.cjs --report`, not a made-up number
- Rewriting/reordering CLAUDE.md mid-session → busts the prompt cache → re-pays full context; edit docs between sessions, never mid-flight
- Chasing the ~97% cache % → normal in long sessions; ignore it. Chase tokens/day and CPM instead

## Relay — surface skill overhead once per arc
After running `list-bloat.cjs`: if overhead is high (~2k+ tok/session) or skills at 0×, tell the user **once** (not every turn):
> 📦 N never-used skills costing ~X tok/session (A, B, C). Want me to disable them?
`list-bloat.cjs --off` prints the ready-to-paste disable + restore commands. Said it once and they acted or declined → drop it.

## /clear gate — show 🟢 only when BOTH are true
1. **Committed** — `git status` is clean (or work saved)
2. **Handoff fresh** — `docs/ANDAMENTO.md` updated (what landed + next step, dated)

If either is missing, say so: "almost: **commit missing**". Never suggest `/clear` on a dirty tree.

**Show the 🟢 verdict and resume line only when closing a deliverable** — not mid-task.
End your reply with the resume block as the very last thing (copy button):

```
resume <project> · <next step from handoff> · ⚙️ mode: <active decisions/permissions>
```

The `⚙️ mode` slot carries autonomy level, deploy auth, executor assignments — anything a `/clear` silently drops.
Durable decisions (standing permissions) → also write to auto-memory as a `feedback` note.

**Re-check before re-asserting 🟢**: if new work landed after you showed it, the verdict is void — re-run the gate.
