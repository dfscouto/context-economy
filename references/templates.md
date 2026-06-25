# Templates — Context Economy

Lean molds only. Write artifacts in the **project's language**.

## CLAUDE.md boot loader (< 60 lines)

```markdown
# <Project> — guide (CLAUDE.md)

<One sentence: what it is + URL/env.>

## ▶ Session start — read THIS, not the whole project
1. **Real state** → `<handoff doc>` + `<state doc if separate>`. Chat is disposable; docs + code are truth.
2. **Don't re-read big files.** Use region map below or Grep anchors — or subagent ("read X, summary only").
3. **1 session = 1 task.** Done → update handoff → commit/save → `/clear`.

## Architecture / region map (anchors > line numbers)
- `<file>` — <role>. Grep: `<SYMBOL>`, `<CONST>`. Slice if needed: lines X–Y.
- `<file>` — <role>.

## Gotchas
- <deploy/build trap>
- <data boundary>

## State (updated: YYYY-MM-DD · branch/tag)
<One honest paragraph: done, left, next.>

## Docs
Index: `<docs/INDEX.md>`. Handoff log: `<handoff>`.
```

## Handoff (docs/ANDAMENTO.md or STATUS.md)

```markdown
# <Project> — Progress

> Living log. Newest on top. Update every delivery.

## <Front> · IN PROGRESS (YYYY-MM-DD)
<1–2 lines goal.>

| Item | Status |
|---|---|
| <task> | ✅ / ⏳ / 🔄 |

### Log
- **YYYY-MM-DD** — <what landed + how verified>.
```

## docs/BOOT.md (multi-IDE bridge, optional)

```markdown
# <Project> — canonical boot (IDE-agnostic)

Same content as CLAUDE.md pointers. Cursor/Grok/Codex sessions read this file.
CLAUDE.md = thin pointer: "Read docs/BOOT.md first."
```

## Split workflow (bloated CLAUDE.md > 100 lines)

1. List the biggest files/sections (`wc -l`, Glob) — don't read them whole
2. Classify each section: **BOOT** (stays) | **DOC** (move to `docs/<topic>.md`)
3. Write `docs/*.md` **before** cutting CLAUDE.md
4. Preserve checklist: legal/business rules · deploy gotchas · SYNC_KEYS/data boundaries
5. Final CLAUDE.md < 60 lines — pointers only
6. Re-check the region map: Grep each anchor to confirm it still resolves

## Discipline snippet

```markdown
## Context discipline
- **Measure:** spend/day + marathon-vs-short CPM + skills overhead — **not** the cache % (~97% is normal)
- 1 task → handoff → commit → `/clear` (switching topic = the biggest lever)
- Heavy reads / large files → subagent (summary + anchors, dump out of the chat)
- Grep/Glob → Read with offset/limit — never re-read the whole repo per session
- Skills/MCP 0× → disable (`list-bloat` / dashboard)
- Diagnose your **profile** (`context-profile`): your biggest leak may be images/PDF/logs — not what generic advice assumes
- Don't re-read an already-loaded image/PDF; verify by text (DOM/log/curl). **Never** rewrite/reorder the CLAUDE.md mid-session — it busts the prompt cache and re-pays the full context
```