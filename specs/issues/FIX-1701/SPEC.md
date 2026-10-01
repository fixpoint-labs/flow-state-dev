# FIX-1701 · One shared reader for a harness item's task scope, used by the Claude Code, Codex and Cursor emitters

**Spec** · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md)

## Who feels this, before and after

| Someone who… | Today | After |
|---|---|---|
| **opens a task and reads its session** while a Claude Code, Codex or Cursor run works it | Sees every step, because all three harnesses stamp the task on each item | The same steps, with the same task on each |
| **runs a Claude Code run inside a container** | Its top-level steps show outside the container; Codex and Cursor steps show inside | **Its top-level steps show inside the container**, as Codex and Cursor's already do and as the docs promise ([D1](DECISIONS.md#d1)) |
| **adds a fourth coding harness** to this repo | Copies one of three slightly different scope readers, and can forget the task, as Claude Code did before #2531 | Calls the one reader every harness calls, and stamps what it returns. Forgetting means not calling it, which review sees |
| **changes how a harness reads its task scope** | Edits three files that already disagree, with no test saying where they differ | Edits one reader. A characterization in each package pins what is stamped |
| **uses any harness from outside this repo** | Nothing to notice | Nothing to notice. No new public promise ([D2](DECISIONS.md#d2)) |

The three harness packages each read the run's task scope off the same runtime field and stamp
it on every item. They do it in three places, three ways. That is how Claude Code shipped
without the task id and a task's own screen showed nothing (FIX-1692, fixed in #2531), and it is
how Claude Code still ships without the owner, so its steps escape the container they run in.

This issue is a **shared-reader extract plus one deliberate behaviour change**: Claude Code
stamps the runtime owner on its top-level items, keeping the documented Container Ownership
contract (`docs/architecture/streaming.md` → "Container Ownership": every item emitted inside a
container carries that container's `ownedBy`). Codex and Cursor stamp exactly what they stamp
today.

## The goal, and how we'll know it's met

**Every harness item carries its task scope through one reader that the next harness reuses
instead of copying, and every harness item emitted inside an owned container carries that
container's owner, Claude Code's included.**

| Is it the right goal? | |
|---|---|
| **The real need** | "All three emitters read their scope through one helper, and a test fails if any of them emits an item inside a task scope without `taskId`" ([FIX-1701](https://linear.app/fixpoint-labs/issue/FIX-1701), *Done when*), plus the owner's call that the Claude Code nesting fix rides with it ([D1](DECISIONS.md#d1)) |
| **Smaller, and rejected** | "A shared helper exists." Hittable with the three copies in place, and with Claude Code still escaping its container |
| **Bigger, and not this issue's** | "One reader for the whole runtime identity", provenance included. A separate deepening, flagged in the plan |
| **Not done if** | Any emitter still reads `taskId` or `ownedBy` off the runtime field itself · the characterization was written after the change, so it describes the new code · a V0 assertion other than Claude Code's top-level owner changed · no test runs Claude Code inside a real owned container |

**The goal check is the owned-container test (V5):** Claude Code runs inside a sequencer that
declares a container, and every top-level item it emits carries that container's owner. It fails
on today's `main` and passes after. Everything else is proved by the characterization V0: it
pins every emitter's stamped `taskId` and `ownedBy`, lands green on today's code **before any
source change**, and after that changes only in the dedicated nesting step, where Claude Code's
top-level owner assertions flip. From then on the flipped assertions and V5 are the truth, not
today's missing owner. Controls: a reader that drops `taskId` turns V0 red in all three
packages; removing Claude Code's owner stamp turns V5 red ([PLAN → Checks](PLAN.md#checks)).

## What changes

![Before: three emitters each read the runtime identity themselves; Claude Code takes the task only, so its top-level steps escape their container. After: one core reader returns the task id and owner; all three stamp both; Claude Code's sub-agent items keep their sub-agent owner](figures/what-changes.svg)

Three private copies collapse into one core reader, and Claude Code starts stamping the owner it
was dropping.

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
+ const scope = itemScope(ctx);            // Claude Code: task and owner
  ...(taskId === undefined ? {} : { taskId }),
+ ownedBy: subAgentOwner ?? scope.ownedBy  // a sub-agent's own owner wins inside it
```

**What changes for users:** a Claude Code run inside a container now shows its top-level steps
(messages, reasoning, tool calls, errors, and the boxes for its sub-agents) inside that
container. Steps inside a sub-agent still show inside that sub-agent. Outside any container,
nothing changes.

## What stays as it is

- Every field Codex and Cursor stamp, on every item kind.
- Claude Code's task id on every item, and its sub-agent owner on items inside a sub-agent.
- Core's own emit sites (generators, tool outputs), which already read both fields. They are
  not harness emitters and are not touched.

**Not here:**

- The task-run link (FIX-1668: which run is working a task). A different axis; this issue reads
  the item's task id only.
- Provenance derivation, also copied three times. A flagged follow-up, not widened into this.
- Item ids and item indexes, which each emitter still derives itself.

## Sign off

**[The goal](#the-goal-and-how-well-know-its-met), at that size:** one reader, one deliberate
behaviour change in Claude Code, proved by a characterization written first and an
owned-container test that fails on `main`. If wrong: a refactor moves a field it should not, or
Claude Code's nesting change hides a step a renderer relied on.

1. **[D1](DECISIONS.md#d1) · A, as the owner chose: the reader returns task and owner, and all
   three emitters stamp both, so Claude Code's top-level items nest under their container.**
   If wrong: a Claude Code view that read its steps from the top level of a container's parent
   now finds them inside the container, which is where the docs already said they would be.
2. **[D2](DECISIONS.md#d2) · The reader is internal to the repo's harnesses, not a published
   harness-author API.** If wrong: an outside harness author keeps reading the runtime field by
   hand, and we publish the reader later as a small additive change.

**Open: none.** Reasoning and what lost: [DECISIONS.md](DECISIONS.md). The cases:
[BUSINESS-RULES.md](BUSINESS-RULES.md).

Refactor + bug fix · `core` + `claude-code` + `codex` + `cursor` · small (6 surfaces, 7 checks,
no doc pages, 1 patch changeset) · 1 PR · no epic
