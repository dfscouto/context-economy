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

# Context Economy — cheap sessions on large projects (v3, lean)

> Write every artifact you create (CLAUDE.md, handoff) in the **project's own language**. Instructions are English.

## The core idea (why this works)
Every turn resends the whole history, but the **prompt cache discounts ~90%** of it — duplication isn't the
villain. The villains are: (a) **context bloat** (huge tool outputs, re-reads, marathon sessions) that grows
without bound, and (b) the **static overhead of installed skills + MCP**, which pads *every* session before you
type anything. The win comes from **resetting the accumulation** (short sessions + `/clear`) with the project's
mastery in **docs, not chat**, and from **turning off skills/MCP you don't use**.

> Principle: durable truth lives in versioned files; the chat is a scratchpad. Anything that matters must
> survive a `/clear`.

`<skill-dir>` below = the folder containing this SKILL.md.

## 0. Pre-flight — safety & scope (FIRST, before writing anything)
Run `node <skill-dir>/scripts/precheck.cjs <project-dir>`. It returns **two separate scores**: **SAFETY** (a
"don't-write-now" % → 🟢 seguro · 🟡 confirmar · 🔴 inseguro, from wrong scope / uncommitted changes / recent
edits) and **ROI** (a potential-gain % → from a missing or bloated CLAUDE.md, no handoff). **Show the user both.**
SAFETY 🔴 → don't write; recommend a session scoped to the project and/or waiting until the repo is quiet. Never
edit a tree another agent might be editing.

## 1. Audit (fast — don't re-read the whole project)
- Is there a `CLAUDE.md`? Is it a **lean boot loader** (state + pointers, <60 lines) or a long dump?
- Is there a living **handoff/state doc** (`docs/ANDAMENTO.md`, `STATUS.md`)?
- Which **big files** cost most to re-read? (use `wc -l`/Glob; don't read them whole) → region map.
- **Measure, don't guess:**
  - `node <skill-dir>/scripts/usage.cjs` — how much of the spend was **history re-read each turn** vs real work (often ~90%+ history).
  - `node <skill-dir>/scripts/list-bloat.cjs` — the **static per-session overhead of installed skills + MCP**, with which ones to turn off (unused/duplicate). This is the source v1 was blind to.
  - `node <skill-dir>/scripts/context-profile.cjs` — **where the user's conversation tokens actually go** (images / PDFs / command logs / file reads / web / subagents) + their **profile** and the one targeted fix. Everyone's leak differs — one bleeds on screenshots, another on PDF reads, another on build logs; this names *theirs* instead of generic "compress your logs" advice.

Report the diagnosis in 3–4 lines before changing anything.

## 2. Build/tighten the CLAUDE.md as a boot loader
Goal: a new session reads **little** and is productive. Target <60 lines. Use `references/templates.md`. Include:
current state in one paragraph (keep it REAL + dated), pointers to the docs, a **region map** of big files (prefer
Grep anchors over line numbers), the gotchas, and the discipline. **Do no harm:** if it's already lean and
accurate, only fix what's stale. **If it's >100 lines:** split — move detail to `docs/<topic>.md` first, then cut
the CLAUDE.md to pointers.

## 3. Handoff doc — the single source of *volatile* state
Create/maintain `docs/ANDAMENTO.md` (or `STATUS.md`) if missing. It holds **what's done + the next step** — the
fast-changing truth. **Update it at the end of EVERY delivery** (date + what landed + next step), commit (or
just save if no git).

**Memory hygiene — the part that bites if you skip it.** Keep the CLAUDE.md state line and any **persistent
memory** as *stable pointers, not volatile state*. Never write "next = Module 5" / "current step = X" into the
memory or CLAUDE.md — that drifts, and a fresh session then starts on a **wrong assumption**. Put the volatile
state ONLY in the handoff; let the memory/CLAUDE.md say *"current state → read `docs/ANDAMENTO.md`"*. So nothing
goes stale. And when a new session starts: **trust git + the handoff over the memory** — if the memory carries
stale volatile state, fix it from the real state before relying on it (stale state is worse than none).

## 4. Discipline (explain the why)
- **1 session = 1 task** → **commit + update handoff → `/clear`**. Both are mandatory before `/clear` (see the gate below). Next one starts clean.
- **`/clear` when switching topics** (biggest lever) · **`/compact`** if long but continuous.
- **Heavy reads → subagent** ("read X, return just the summary") — the dump stays in the agent's context.
- **Don't re-read big files**; read the slice via the region map. Prefer `Grep`/`Glob` over `cat`.
- **Turn off skills/MCP you don't use** — `list-bloat` shows what each costs per session.

## 5. Playbook — cut **absolute** tokens (not the ~97% cache %)

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
1. **Model choice — Sonnet by default, Opus on demand** — the heaviest lever when Opus dominates billed (the
   weekly cap is usually Opus). Set `"model": "claude-sonnet-4-6"` in `settings.json`; `/model opus` only for
   high-judgment work (architecture, hard debugging, planning). The dashboard's **per-model weekly view** shows
   where Opus goes; the real plan % is at **claude.ai → Settings → Usage**. Optional nudge:
   `install.cjs --model-advisor` suggests escalating on hard prompts (never switches the model; `CE_MODEL_ADVISOR=off` to silence).
2. **`/clear` on topic switch** — after commit + fresh handoff (gate below). Stops unbounded history growth.
3. **Archive unused skills** — `list-bloat.cjs` / dashboard toggle. Static cost hits **every** session start.
4. **Trim MCP** — disable connectors you don't use (`/mcp` or settings); same static padding as skills.

### P1 — agent levers (you must do these every session)
1. **Boot, don't binge-read** — CLAUDE.md + handoff only at start; never re-ingest the whole repo unless asked.
2. **Grep/Glob → slice** — find the symbol first; `Read` with `offset`/`limit` or delegate to **Task/subagent**
   for files >500 lines or unknown scope.
3. **Subagent = dump isolation** — "read module X, return 10-line summary + file:line anchors" keeps megabytes
   out of the main thread.
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

### Anti-patterns (burn tokens fast)
- One chat for MOD 03 + MOD 06 + infra + unrelated question → **split sessions**
- 15+ skills enabled, half at 0× in logs → **archive**
- CLAUDE.md encyclopedia re-read every turn → **split to docs**
- Marathon 3000+ msgs without a closed deliverable → **`/compact` or close + `/clear`**
- Pasting 500-line diffs or stack traces inline → **path + line range**
- Two agents editing the same tree → **scope + precheck SAFETY**
- Re-reading screenshots/PDFs already loaded → **verify by text (DOM/log/curl); `context-profile.cjs` flags if media is your leak**
- Rewriting/reordering CLAUDE.md **mid-session** → **busts the prompt cache → re-pays full context; edit docs between sessions, not mid-flight**

### Agent checklist before claiming "tokens saved"
- [ ] Pointed user at a **measurable** delta (graph, CPM ratio, bloat tok/session) — not a invented %
- [ ] Didn't suggest chasing cache % down
- [ ] Offered concrete next action (archive skill X, `/clear` phrase, handoff update)

## The `/clear` gate (relay — never skip the two conditions)
`/clear` is safe for files — it clears the **chat**, not the disk; no code is ever lost to it. But the *thread*
of work (what you were doing, why, what's next) only survives if it was **written down**. So the verdict is
🟢 **only when BOTH are true** — verify, don't assume:

1. **Committed** — run `git status`; the tree is clean (or the work is otherwise saved). **If there are
   uncommitted changes, the verdict is NOT 🟢** — say so and commit first (or have the user commit). Never
   suggest `/clear` over a dirty tree without flagging it. (A dirty tree is often *another tool's* in-progress
   work — the files persist, but the chat thread that explains them doesn't.)
2. **Handoff fresh** — `docs/ANDAMENTO.md` (or STATUS) updated with *what landed + the next step*, dated. Also
   fix/trim any stale volatile state in memory/CLAUDE.md as part of closing.

Claude Code may not surface hook output (Stop-hook text is invisible in some setups), so **YOU, the agent, relay
the verdict in plain language.** Only when both conditions hold, end your reply with the verdict (as prose) **and a
ready-to-type resume line** — the exact words the user pastes *after* `/clear` to pick the thread back up.

**The resume line carries THREE things, not two:** (1) the **project**, (2) the **next step**, and (3) the
**active decisions/permissions the user granted** — *how to drive*: autonomy level ("decide what's best, don't
ask"), deploy/external-action authorization, who-runs-the-executor, any standing "from now on…" instruction.
These are the things a `/clear` silently drops — the user re-grants them by pasting them back. **Without slot (3),
the next session reverts to cautious defaults (asks before acting, won't deploy) and the user has to re-teach it.**

**Put the resume line in its OWN fenced code block (```).** A fenced block renders with a one-click **copy button
in the top-right corner**, so the user copies the whole line with one click instead of hand-selecting it. The block
must hold **only** the paste-able text — no prose, no leading `$`, no inline backticks around it — so the copy is
clean. Verdict + intro go as prose *above* the block. **The block is the LAST thing in your message — put nothing
below it.** Only the block survives the `/clear` (it's all the user pastes), so anything meant for *after* the
clear — the next step, the options, a question to resume on — must live **inside** the block; placed below, it is
lost (and it reads as a contradiction: "I'll tell you after" vanishes in the clear):

> 🟢 **Time to `/clear`.** Delivery closed (commit + handoff up to date). After `/clear`, paste this to continue:
>
> ````
> resume <project> · <next step> · ⚙️ mode: <active decisions/permissions — e.g. drive and decide without asking · deploy authorized · I dispatch the executor>
> ````

(The example uses a 4-backtick fence only so this doc can show a nested block; in your reply use a normal ``` fence.)

**Fill the resume line with the REAL project + the next step from the handoff + the active decisions** —
concrete and copy-pasteable, **never a placeholder like "<assunto>"**. Examples:
`resume project X · MOD 05, the foods screen (data import blocked) · ⚙️ mode: drive without asking, deploy authorized`
· `continue app Y · the dam biome · ⚙️ mode: default (ask before deploy)`. The phrase points the next
session at the right project + topic + **how to drive**; it then reads CLAUDE.md + the handoff and continues.
Unsure of the next step? Pull it from the top of `docs/ANDAMENTO.md`. **Drop the ⚙️ modo slot only when there are
no standing decisions** (plain defaults apply).

**Durability — where decisions actually live (don't rely on the resume line alone).** The resume line is a
*convenience echo*; the user might forget to paste it. So a **durable** decision/permission (one that holds across
sessions until revoked — "always decide what's best, don't ask me", "you run the executor", a standing workflow)
must ALSO be written to **auto-memory as a `feedback` note the moment it's granted** — memory reloads in every new
session via system-reminder, so it survives `/clear` *natively*, with or without the paste. Record **what** was
granted, **why**, and **how to apply it** (incl. its limits). Distinguish two scopes: **durable** → memory + resume
line; **session-only / risky** (e.g. "deploy authorized *this session*") → resume line only, and re-confirm rather
than assume next time. When in doubt about scope, ask once — then it's durable.

**The operating model and the product-truth doc are durable too — re-load them after `/clear`.** Some projects
fix *how the work runs* (who codes vs. who orchestrates, "don't stop to ask, run the executors") and *what the
product already is* (a feature inventory the user maintains so nothing silently regresses). Both MUST survive
`/clear`: the **operating model** → auto-memory `feedback` + echoed in the `⚙️ modo` slot; the **product-truth
doc** → name its path in the resume line so the fresh session opens it *before* validating. Re-reading that
inventory is the anti-regression guard — **green tests do NOT catch UI/feature disappearance**, only a human or a
visual pass against the documented list does. Example: `⚙️ mode: Claude = orchestrator, does NOT write the
product code (a separate executor codes), doesn't stop to ask` + `read docs/FEATURES.md and validate the UI in
the browser before proceeding`. If after `/clear` you find yourself coding the product by hand, or asking the user a
question that stalls the work, or skipping the inventory check — you have **drifted from the saved model; re-read
memory and correct course** rather than improvising a "lighter" mode.

If a condition is missing, say so explicitly instead — "almost: **commit missing**" / "almost: **handoff not
updated**" — and do NOT show the 🟢 line. Mid-task with nothing closed → stay quiet, don't nudge.

You **do not run `/clear`** — it's the user's. And **before claiming `/clear` is safe, actually check** (`git
status` + the handoff date); never assert it from assumption.

### The 🟢 verdict is a snapshot — re-check if the session keeps going
You showed the 🟢 line, but the user **keeps interacting instead of clearing** (very common — they read, ask a
follow-up, or squeeze in one more thing). The verdict was true *at that moment*; it can go stale the instant
anything new lands. The gate is **per-close, not once-per-session** — so:
- **More talk only** (questions, analysis — no file/git/decision change): the 🟢 still holds. Don't re-spam it; if
  the user asks, a one-liner is enough — "still 🟢, same resume line".
- **New work landed after the 🟢** (a commit, an edit, or a decision that belongs in the handoff): the earlier
  verdict is **void**. Re-run the gate (`git status` + handoff) and, when closing again, show a **fresh** 🟢 with
  an **updated resume line** — because the old one now points at the wrong next step, and a stale resume line is
  worse than none (it sends the new session to the wrong place).
- **Never coast on a 🟢 you gave earlier** — re-verify the tree is still clean before re-asserting it; don't assume
  it from the previous turn.

## Relay: surface unused-skill overhead (a second nudge, like `/clear`)
The SessionStart hook prints the static overhead line (`📦 …tok/session`), but the user may not read the terminal.
So, exactly like the `/clear` nudge, **YOU relay it in chat** — but **once per work-arc, not on a loop** (the
overhead is *static*; it does not change turn to turn, so repeating it every session is noise).

**When:** at the start of a real working session, or whenever the user raises tokens / cost / plan limits.
**Then:** run `node <skill-dir>/scripts/list-bloat.cjs`. If there are skills never used in the logs (0×), or the
overhead is high (~2k+/session), surface **one line** naming the top unused ones and the saving, and offer to act.
`list-bloat.cjs --off` prints **ready-to-paste disable + restore commands** (OS-aware) for the 0× skills:

> 📦 You have N never-used skills costing ~X tok/session (e.g. A, B, C). Want me to disable them? (`--off` generates the commands; it's a reversible `mv` to `skills.disabled/`, and the restore comes with it)

Caveats: archiving is reversible (a move, not a delete) — fine to offer and do with the user's ok. **Shortening a
description is a tradeoff** (it cuts tokens but can hurt the skill's auto-triggering) — don't suggest it for skills
the user actually relies on. The action (archive / `/mcp` toggle) is the **user's call**; you recommend, they
decide. Said it once and they declined or acted? Drop it — don't nag.

## Measurement & hooks (zero AI tokens, all local)
- `usage.cjs` — history-vs-work breakdown (runs on the `/clear` hook). Also prints a **1-line context profile** of the last 3 sessions (your biggest leak — images/PDF/logs/reads) + a pointer to `context-profile.cjs` for the full breakdown.
- `context-profile.cjs` — full per-profile breakdown of where conversation tokens go + the targeted fix (core in `lib/profile-scan.cjs`, shared with the `/clear` hook).
- `dashboard.cjs` + `dashboard/index.html` — daily dashboard (chart + skill ranking). **Reading:** open the
  HTML in a browser, F5. **Skill toggle:** run `dashboard-serve.cjs` and open `http://127.0.0.1:3847/` — Enable/
  Disable buttons move folders; restart Claude Code afterward. Also prints `📦 …tok/session` on SessionStart.
- `list-bloat.cjs` — skills/MCP overhead.
- `model-advisor.cjs` — optional `UserPromptSubmit` nudge: on high-judgment prompts it suggests `/model opus`
  (never switches the model, never blocks; `CE_MODEL_ADVISOR=off` to silence).
- **Hooks** (global `settings.json`): `SessionStart(clear)→usage` and `SessionStart→dashboard`. Install once with
  `node <skill-dir>/scripts/install.cjs` (it also cleans up old heavier hooks). Add `--model-advisor` to also
  wire the opt-in escalation nudge.

## Scripts (lean set)
| script | what it does |
|---|---|
| `scripts/precheck.cjs` | two scores before writing: SAFETY (don't-write %) + ROI (potential gain) |
| `scripts/usage.cjs` | history-vs-work breakdown (hook on `/clear`) |
| `scripts/dashboard.cjs` + `dashboard/index.html` | daily dashboard + bloat line (file-mode) |
| `scripts/dashboard-serve.cjs` | same dashboard + API toggle skills (`http://127.0.0.1:3847/`) |
| `scripts/toggle-skill.cjs` | CLI on/off skill (`skills` ↔ `skills.disabled`) |
| `scripts/list-bloat.cjs` | static overhead of installed skills + MCP |
| `scripts/context-profile.cjs` | per-profile breakdown of where conversation tokens go (images/PDF/logs/reads/web) + targeted fix |
| `scripts/model-advisor.cjs` | optional UserPromptSubmit nudge → suggests `/model opus` on hard prompts (opt-in) |
| `scripts/install.cjs` | installs the 2 light SessionStart hooks (`--model-advisor` adds the opt-in nudge) |

## What NOT to do
- Don't run heavy benchmarks to "prove" savings — that burns the tokens the skill exists to save.
- Don't invent a savings "%" you can't measure — speak in orders of magnitude, or cite the CPM ratio from
  `dashboard.cjs --report`.
- Don't cut a bloated CLAUDE.md before moving the critical blocks to `docs/`.
- Don't dump into the chat what should be a doc.

Details & templates: `references/templates.md` · Changes: `CHANGELOG.md`.
