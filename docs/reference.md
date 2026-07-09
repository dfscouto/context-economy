# context-economy — full reference

> This document is the extended detail behind `SKILL.md`. Read it when you need the full
> explanation of a rule, the complete playbook, or the /clear gate essay.

## Why it works — the core idea

Every turn resends the whole history, but the **prompt cache discounts ~90%** of it — duplication isn't
the villain. The villains are: (a) **context bloat** (huge tool outputs, re-reads, marathon sessions)
that grows without bound, and (b) the **static overhead of installed skills + MCP**, which pads *every*
session before you type anything. The win comes from **resetting the accumulation** (short sessions +
`/clear`) with the project's mastery in **docs, not chat**, and from **turning off skills/MCP you don't use**.

> Principle: durable truth lives in versioned files; the chat is a scratchpad. Anything that matters
> must survive a `/clear`.

---

## Playbook — cut absolute tokens (not the ~97% cache %)

The dashboard's **~97% "cache cost"** is normal in long sessions — **do not chase lowering it**. Chase
**tokens/day**, **CPM** (cost per message), and **static overhead**. Those are what hit the plan limit.

### What to measure (2-minute ritual, zero AI)
| Metric | Where | Healthy direction |
|---|---|---|
| **Opus share** | dashboard model panel | ↓ Opus % (move routine to Sonnet) |
| **Spend/day** | dashboard graph | ↓ over weeks |
| **Marathon vs short CPM** | hero card (`ratio` ~3×) | fewer 1000+ msg sessions |
| **Skills/MCP overhead** | bloat panel (`tok/session`) | ↓ after archiving 0× skills |
| ~~Cache %~~ | ~97% card | **ignore** — not a success metric |

Weekly (or when limits bite): `node <skill-dir>/scripts/dashboard.cjs` → refresh browser ·
`list-bloat.cjs` · offer `--off` for 0× skills once.

### P0 — user levers (biggest $/token wins)
1. **Model choice — Sonnet by default, Opus on demand.** The weekly cap is almost always Opus. Set
   `"model": "claude-sonnet-4-6"` in `settings.json`; `/model opus` only for high-judgment work
   (architecture, hard debugging, planning). The dashboard's per-model daily chart shows where Opus goes;
   the real plan % is at **claude.ai → Settings → Usage**. Optional nudge:
   `install.cjs --model-advisor` suggests escalating on hard prompts (never switches the model; `CE_MODEL_ADVISOR=off` to silence).
2. **`/clear` on topic switch** — after commit + fresh handoff. Stops unbounded history growth.
3. **Archive unused skills** — `list-bloat.cjs` / dashboard toggle. Static cost hits every session start.
4. **Trim MCP** — disable connectors you don't use (`/mcp` or settings); same static padding as skills.

### P1 — agent levers (every session)
1. **Boot, don't binge-read** — CLAUDE.md + handoff only at start; never re-ingest the whole repo unless asked.
2. **Grep/Glob → slice** — find the symbol first; `Read` with `offset`/`limit` or delegate to
   subagent for files > 500 lines or unknown scope.
3. **Subagent = dump isolation** — "read module X, return 10-line summary + file:line anchors" keeps
   megabytes out of the main thread.
4. **One task per arc** — don't stack unrelated modules; nudge `/clear` when the handoff closes a deliverable.
5. **Proportional replies** — no token-burning walls; cite `start:end:path` instead of pasting whole files back.
6. **No proof-by-benchmark** — don't run heavy audits "to show savings"; that spends what we're saving.
7. **Parallel only when independent** — batch tool calls, but never fetch "just in case" files nobody asked for.

### P2 — project hygiene (setup once, pays forever)
1. **CLAUDE.md < 60 lines** — boot loader + region map; detail lives in `docs/*.md`.
2. **Region map with Grep anchors** — not stale line numbers; symbols/constants that survive edits.
3. **Handoff = volatile truth** — memory/CLAUDE.md point to it; never duplicate "next step" in three places.
4. **Big generated dirs out of scope** — `.gitignore` / tool ignore so agents don't traverse `node_modules`, builds, dumps.
5. **Paste discipline** — user pastes logs/errors, not whole files; agent asks for the failing slice.

---

## CLAUDE.md in depth

Goal: a new session reads **little** and is productive. Target < 60 lines. Use `references/templates.md`. Include:
current state in one paragraph (keep it REAL + dated), pointers to the docs, a **region map** of big files
(prefer Grep anchors over line numbers), the gotchas, and the discipline. **Do no harm:** if it's already
lean and accurate, only fix what's stale. **If it's > 100 lines:** split — move detail to `docs/<topic>.md`
first, then cut the CLAUDE.md to pointers.

---

## Handoff doc in depth

Create/maintain `docs/ANDAMENTO.md` (or `STATUS.md`) if missing. Holds **what's done + the next step** —
the fast-changing truth. Update at the end of EVERY delivery (date + what landed + next step), commit (or
just save if no git).

**Memory hygiene.** Keep the CLAUDE.md state line and any persistent memory as *stable pointers, not
volatile state*. Never write "next = Module 5" / "current step = X" into the memory or CLAUDE.md — that
drifts, and a fresh session starts on a wrong assumption. Put volatile state ONLY in the handoff; let
memory/CLAUDE.md say "current state → read `docs/ANDAMENTO.md`". When a new session starts: **trust git +
the handoff over the memory** — if the memory carries stale volatile state, fix it from the real state
before relying on it.

---

## /clear gate — full rules

`/clear` is safe for files — it clears the **chat**, not the disk; no code is ever lost to it. But the
*thread* of work only survives if it was **written down**. So the verdict is 🟢 **only when BOTH are true**
— verify, don't assume:

1. **Committed** — run `git status`; the tree is clean (or the work is otherwise saved). If there are
   uncommitted changes, the verdict is NOT 🟢 — say so and commit first (or have the user commit). Never
   suggest `/clear` over a dirty tree without flagging it.
2. **Handoff fresh** — `docs/ANDAMENTO.md` (or STATUS) updated with *what landed + the next step*, dated.
   Also fix/trim any stale volatile state in memory/CLAUDE.md as part of closing.

Claude Code may not surface hook output (Stop-hook text is invisible in some setups), so **YOU, the agent,
relay the verdict in plain language.** Only when both conditions hold, end your reply with the 🟢 verdict
and a ready-to-type resume line.

**The resume line carries THREE things:** (1) the **project**, (2) the **next step**, and (3) the **active
decisions/permissions** — autonomy level, deploy auth, executor assignments. These are what a `/clear`
silently drops; the user re-grants them by pasting the line back. Without slot (3), the next session
reverts to cautious defaults.

**Put the resume line in its OWN fenced code block (```).** The block renders with a one-click copy button.
Only pasteable text goes inside — no prose, no `$`, no inline backticks. Verdict + intro go as prose *above*
the block. **The block is the LAST thing in your message** — nothing below it.

> 🟢 **Time to `/clear`.** Delivery closed (commit + handoff up to date). After `/clear`, paste this to continue:
>
> ````
> resume <project> · <next step> · ⚙️ mode: <active decisions/permissions>
> ````

Fill with the REAL project + next step from the handoff + active decisions — never a placeholder like
`<assunto>`. Examples:
- `resume project X · MOD 05, foods screen · ⚙️ mode: drive without asking, deploy authorized`
- `continue app Y · the dam biome · ⚙️ mode: default (ask before deploy)`

**Durability.** The resume line is a convenience echo; the user might forget to paste it. So a durable
decision/permission must ALSO be written to **auto-memory as a `feedback` note** — memory reloads in every
new session, surviving `/clear` natively. Record what was granted, why, and how to apply it. Distinguish:
**durable** → memory + resume line; **session-only / risky** (e.g. "deploy authorized *this session*") →
resume line only, re-confirm next time.

**The operating model and product-truth doc are durable too.** Some projects fix *how the work runs* (who
codes vs. orchestrates) and *what the product already is* (a feature inventory so nothing silently
regresses). Both must survive `/clear`: operating model → auto-memory `feedback` + `⚙️ mode` slot;
product-truth doc → name its path in the resume line so the fresh session opens it before validating.
Green tests do NOT catch UI/feature disappearance — only a human or a visual pass against the documented
list does.

**The 🟢 verdict is a snapshot.** If the user keeps interacting after you showed it:
- **More talk only** (questions, analysis — no file/git/decision change): 🟢 still holds. One-liner if asked.
- **New work landed**: verdict is void. Re-run the gate; show a fresh 🟢 with an updated resume line.
- **Never coast on a 🟢 you gave earlier** — re-verify before re-asserting.

If a condition is missing, say so explicitly — "almost: **commit missing**" — and do NOT show the 🟢 line.
Mid-task with nothing closed → stay quiet, don't nudge.

You **do not run `/clear`** — it's the user's. Before claiming it's safe, actually check (`git status` +
handoff date); never assert it from assumption.

---

## Relay: surface unused-skill overhead

The SessionStart hook prints `📦 …tok/session`, but the user may not read the terminal. YOU relay it in
chat — **once per work-arc, not on a loop** (the overhead is static; repeating it is noise).

**When:** at the start of a real working session, or when the user raises tokens/cost/limits.
**Then:** run `node <skill-dir>/scripts/list-bloat.cjs`. If there are skills at 0× in logs, or overhead
is high (~2k+/session), surface one line naming the top unused ones and the saving, and offer to act.
`list-bloat.cjs --off` prints ready-to-paste disable + restore commands (OS-aware).

> 📦 You have N never-used skills costing ~X tok/session (e.g. A, B, C). Want me to disable them?

Caveats: archiving is reversible (a move, not a delete). **Shortening a description** cuts tokens but can
hurt auto-triggering — don't suggest it for skills the user actually relies on. Said it once and they
declined or acted? Drop it — don't nag.

---

## Agent checklist before claiming "tokens saved"
- [ ] Pointed user at a **measurable** delta (graph, CPM ratio, bloat tok/session) — not an invented %
- [ ] Didn't suggest chasing cache % down
- [ ] Offered concrete next action (archive skill X, `/clear` phrase, handoff update)
