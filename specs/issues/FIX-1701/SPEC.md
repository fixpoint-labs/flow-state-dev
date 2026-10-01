# FIX-1701 · One shared reader for a harness item's task scope, used by the Claude Code, Codex and Cursor emitters

**Spec** · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md)

## Who feels this, before and after

| Someone who… | Today | After |
|---|---|---|
| **opens a task and reads its session** while a Claude Code, Codex or Cursor run works it | Sees every step, because all three harnesses stamp the task on each item | The same steps, unchanged, item for item |
| **adds a fourth coding harness** to this repo | Copies one of three slightly different scope readers, and can forget the task, as Claude Code did before #2531 | Calls the one reader every harness calls. Forgetting the task means not calling it, which review sees |
| **changes how a harness reads its task scope** | Edits three files that already disagree, with no test saying where they differ on purpose | Edits one reader. A characterization test in each package names every difference that is meant to stay |
| **runs a Claude Code run inside a container** | Its top-level steps show outside the container; Codex and Cursor steps show inside | Exactly as today. This is a separate bug, recorded and pinned, not fixed here ([D1](DECISIONS.md#d1)) |
| **uses any harness from outside this repo** | Nothing to notice | Nothing to notice. No new public promise ([D2](DECISIONS.md#d2)) |

The three harness packages each read the run's task scope off the same runtime field and stamp
it on every item. They do it in three places, three ways. That is how Claude Code shipped
without the task id and a task's own screen showed nothing (FIX-1692, fixed in #2531). This
issue removes the copies; it does not change a single stamped field.

## The goal, and how we'll know it's met

**Every harness item carries exactly the task scope it carries today, and it gets there through
one reader that the next harness reuses instead of copying.**

| Is it the right goal? | |
|---|---|
| **The real need** | "All three emitters read their scope through one helper, and a test fails if any of them emits an item inside a task scope without `taskId`" ([FIX-1701](https://linear.app/fixpoint-labs/issue/FIX-1701), *Done when*) |
| **Smaller, and rejected** | "A shared helper exists." Hittable with the three copies still in place and nothing pinning what they stamp |
| **Bigger, and not this issue's** | "Every harness nests under its enclosing container the way the docs promise." That changes what Claude Code stamps, so it is a bug fix with its own issue ([D1](DECISIONS.md#d1)) |
| **Not done if** | Any emitter still reads `taskId` or `ownedBy` off the runtime field itself · the characterization was written after the extraction, so it describes the new code rather than the old · a characterization assertion changed in the same PR as the extraction |

**No goal check applies: this is a pure refactor with no new outcome to observe.** What proves
it instead is the characterization V0: it pins every emitter's stamped `taskId` and `ownedBy`,
lands green against today's code **before any source change**, and passes unchanged after.
Its control must fail: a helper that drops `taskId` turns V0 red in all three packages, and one
that hands Claude Code the identity's `ownedBy` turns Claude Code's V0 red
([PLAN → Checks](PLAN.md#checks)).

## What changes

![Before: three emitters each read the runtime identity themselves, two ways. After: one core reader returns the task id and owner; Codex and Cursor stamp both, Claude Code stamps the task id and keeps its own sub-agent owner](figures/what-changes.svg)

Three private copies collapse into one core reader. What each emitter stamps stays where it is
decided, at its own call site.

**What a harness emitter writes:**

```diff
- const identity = (ctx as { _blockIdentity?: { taskId?: string; ownedBy?: string } })._blockIdentity;
- ...(identity?.taskId !== undefined ? { taskId: identity.taskId } : {}),
- ...(identity?.ownedBy !== undefined ? { ownedBy: identity.ownedBy } : {}),
+ import { itemScope } from "@flow-state-dev/core/types";
+ ...itemScope(ctx),                       // Codex, Cursor: task and owner, as today
```

```diff
- const taskId = (ctx as { _blockIdentity?: { taskId?: string } })._blockIdentity?.taskId;
+ const { taskId } = itemScope(ctx);       // Claude Code: task only; ownedBy stays its sub-agent's
  ...(taskId === undefined ? {} : { taskId }),
```

## What stays as it is

- Every stamped field, on every item kind, in all three harnesses. Including the difference:
  Claude Code's top-level items carry no `ownedBy` from the runtime; Codex and Cursor's do.
- Core's own emit sites (generators, tool outputs), which already read both fields. They are
  not harness emitters and are not touched.
- The task-run link (FIX-1668: which run is working a task). A different axis; this issue reads
  the item's task id only.
- Provenance, item ids and item indexes, which each emitter still derives itself.

## Sign off

**[The goal](#the-goal-and-how-well-know-its-met), at that size:** one reader, zero change in
what is stamped, proved by a characterization written first. If wrong: we either ship a
refactor that quietly moves a field, or hold a cleanup open for a bug fix it was never scoped
to carry.

1. **[D1](DECISIONS.md#d1) · The reader returns task and owner; each emitter keeps deciding
   which it stamps. Claude Code's missing container nesting goes to its own bug.** If wrong:
   Claude Code runs inside a container keep showing their steps outside it until that bug
   ships, and the issue's "decide `ownedBy` first" is answered later than it asked.
2. **[D2](DECISIONS.md#d2) · The reader is internal to the repo's harnesses, not a published
   harness-author API.** If wrong: an outside harness author keeps reading the runtime field by
   hand, and we publish the reader later as a small additive change.

**Open: none.** D1 is the one to weigh: it narrows the issue's *Direction* paragraph to stay a
refactor. Reasoning and what lost: [DECISIONS.md](DECISIONS.md). The cases:
[BUSINESS-RULES.md](BUSINESS-RULES.md).

Refactor · `core` + `claude-code` + `codex` + `cursor` · small (5 surfaces, 6 checks, no doc
pages) · 1 PR · no epic
