# poc/page-facts — is the page true on `main`?

Throwaway, retained as evidence. Nothing under `specs/` is built, tested or walked by
`fsdev gen`, and `knip` ignores `specs/issues/*/poc/**`. Two scripts, no new dependencies,
nothing patched. They import the packages' own source by relative path.

**The question.** A docs page is only as good as the names and the refusal it states. The
epic's goal check plants one false option on the page and expects the run to fail on it
([epic SPEC](../../../../epics/FIX-1637/SPEC.md#the-goal-and-how-well-know-its-met)). These two
scripts are that check, run before the page is written rather than after.

## `names.mts` · every name on the page resolves

Reads the quoted prose and code in [`DOCS.md`](../../DOCS.md). Every named import in a code
fence must be exported by the package it names. Every inline code span must be classified, and
each classification is checked: an export, a property path on a real type (`FlowDefinition`,
`CreateFlowStateOptions`, `dispatcher`'s options), a union member in source, or a route already
published on a reference page. **A span nobody classified fails the run** (totality).

```bash
pnpm exec tsx specs/issues/FIX-1639/poc/page-facts/names.mts                          # must PASS
CONTROL=planted       pnpm exec tsx specs/issues/FIX-1639/poc/page-facts/names.mts    # must FAIL: notifyTopic not exported
CONTROL=unclassified  pnpm exec tsx specs/issues/FIX-1639/poc/page-facts/names.mts    # must FAIL: totality
CONTROL=false-option  pnpm exec tsx specs/issues/FIX-1639/poc/page-facts/names.mts    # must FAIL: dispatcher has no delay
```

## `fence.mts` · the queue-host paragraph matches the runtime

Boots `createFlowState` with a dispatcher that has no `dispatchLocal`, which is how the host
decides "external" and what BullMQ's `createWorkerDispatcher` lacks. It consumes a queued job
with `runAction`, as `createFlowJobProcessor` does.

| Check | Claim on the page |
|---|---|
| F1 | A `{ key }` dispatch is enqueued |
| F2 | An `{ id }` delivery is refused `external-dispatcher`, and nothing is enqueued |
| F3 | A `{ from: true }` reply from a queued run is refused the same way |
| F4 | A webhook whose `sessionId` names an existing session is enqueued, not refused |

```bash
pnpm exec tsx specs/issues/FIX-1639/poc/page-facts/fence.mts                          # must PASS
CONTROL=in-process pnpm exec tsx specs/issues/FIX-1639/poc/page-facts/fence.mts       # must FAIL all four
```

Under the control the same flow runs with no queue: the `{ id }` delivery, the `{ from: true }`
reply and the webhook all run in process, so every check goes red. That shows each check reads
the dispatcher rather than a constant.

## What it showed

- **The page's names all resolve** (54 spans, 72 checks, 4 fences), and each control fails on
  the one thing planted. [`names.evidence.txt`](names.evidence.txt).
- **The fence holds as the epic states it, and is one row wider.** F1, F2 and F4 confirm the
  epic's ER-4. F3 is new: a `{ from: true }` reply is also refused. The epic's draft table had
  two rows and would have let a reader plan to report back with a reply, which fails on
  exactly the host the section is about. The page gains a third row, and the reference refusal
  table, which names only `id`, gets a one-row drift fix. [`fence.evidence.txt`](fence.evidence.txt).
- **Not run:** a real Redis. The stub is the host's own discriminator, and the closure
  (FIX-1642) runs the page on a real BullMQ host.

The implementer re-runs both before publishing and after every edit to the page's prose
([PLAN V1, V2](../../PLAN.md#checks)).
