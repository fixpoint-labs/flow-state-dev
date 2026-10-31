# FIX-2398 · Decisions

[Spec](SPEC.md) · **Decisions**

FIX-2288 put a task's spend on its row and every harness reports into it. These three say what
"usage for every harness" means when two vendors send no reading mid-run, where a Kitchen Sink
turn's spend comes from, and what a cost is.

## The tree

```mermaid
flowchart TD
  I["FIX-2398"] --> D1["D1 · no onUsage for Codex and Cursor"]
  D1 -.->|"rejected"| X1["an onUsage option on both · nothing on the wire to carry"]
  I --> D2["D2 · a turn's spend is its request's ledger at turn end"]
  D2 -.->|"rejected"| X2["a per-turn feed the harness calls · a second report path"]
  D2 -.->|"rejected"| X3["sum the turn's items · not what the vendor billed"]
  I --> D3["D3 · a cost is the vendor's charge or nothing"]
  D3 -.->|"rejected"| X4["a price-table estimate · forbidden by FIX-2145 D2"]
```

Solid edges are what you're signing. Dashed edges lost, and the label says why.

<a name="d1"></a>
## D1 · Codex and Cursor get no `onUsage`; Teammates' gap is a reader and a dropped `onActivity`

| | |
|---|---|
| **Instead of** | An `onUsage` option on `codexAgent` and `cursorAgent`, as the issue asks |
| **Because** | `onUsage` carries a subscription window a vendor announces mid-run. Claude Code sends `rate_limit_event`; Codex's wire has `thread.*`, `turn.*`, `item.*` and `error` only, and Cursor's has `usage` (tokens) only (`packages/codex/src/types.ts`, `packages/cursor/src/types.ts`). Their tokens and cost already reach every task row through `reportHarnessSpend`, in all three apps. Codex's windows come from `readCodexUsage` as a `harnessUsageAction` reader. What Teammates actually drops is Cursor's `onActivity` (its host passes `cwd, resume, onSession, onSteerable` only) and any reader |
| **Locks in** | An app that wants Codex's windows registers a reader; nothing arrives by itself. If Codex or Cursor later stream a window event, `onUsage` is added in that harness package then, one hook per real event |

**What would change my mind:** a Codex or Cursor wire event carrying a limit reading. Then the
option is cheap and belongs in that package.

<a name="d2"></a>
## D2 · A turn's spend is its request's ledger at turn end, folded by `taskSpendView` and kept on the turn record

| | |
|---|---|
| **Instead of** | A feed callback on `HarnessSessionFeeds` the harness calls with its usage; or a sum over the turn's items |
| **Because** | Every harness already reports its run into the request's ledger, from its `finally`, however the run ends. So `readRequestSpend(ctx)` read right after the harness step, inside the turn, is the whole turn: in a step after it for a turn that returned, and in the failure record's own write for one that threw or was stopped. Inside the turn, because the request publishes its terminal status *before* `onFinished` runs, and a page refreshes on that status: a write at `onFinished` would land after the page read. Folding it with `taskSpendView` gives a turn the same view a task has, so one component draws both (tenet 5: one fold). A feed callback would be a second report path beside `reportHarnessSpend`, kept in step by every harness |
| **Locks in** | A turn's count is final, not live: it appears when the turn ends, never later than the request's end.  Turn-card spend never reads the `harnessUsage` query, which holds subscription windows only. The record's `spend` has the view's shape, so a change to the view changes both readers at once |

**What would change my mind:** a page that must show a turn's tokens rising while it runs. Then
the turn writes its live part on a timer, as a task's request does (FIX-2288 D2).

<a name="d3"></a>
## D3 · A cost is the vendor's billed charge, summed, or `null`

| | |
|---|---|
| **Instead of** | `$0.00` for a subscription run, or a price-table estimate for a run with tokens and no charge |
| **Because** | FIX-2145 D2 and the epic forbid estimates. A subscription run is not billed per run, so a dollar figure for it would be invented. `costUsd` is the sum of the sources that reported one; `null` when none did, and the line then shows tokens only |
| **Locks in** | A mixed task (an API-key retry after a subscription run) shows the API-key part's charge, with tokens covering both. Apps never compute a cost |

## Decided, not asked

- **The turn's duration is `endedAt − at`.** `at` is already the turn's start; `endedAt` is
  written in the same turn-end write as `spend`. A task's elapsed time is FIX-2394's, on FIX-2168's
  row fields; the component takes `durationMs` so both feed it.
- **The registry component takes a structural summary**, the view's fields plus optional
  `attempts` and `durationMs`, and no row type: a turn and a task call it the same way. A
  harness label is the app's (`harnessLabel`), so the registry names no harness.
- **The session flow carries the usage query** (`harnessUsage`, readers from `usageReaders`,
  default none). The collection is not client-readable, so a write with no query on the flow
  is invisible.
- **Kitchen Sink installs the byte copy in PR 1**: its drift check requires every registry file.
- **A turn-end write that fails is a note, never a failed turn**, like the pull-request check.
- **`costUsd` sums only sources whose `costUsd` is non-null**, the same rule as a worker's usage rows (FIX-2145), so the two never disagree.
- **Two deliverables in PR 1, one code path each:** (A) a task's and a turn's spend, through `taskSpendView`; (B) subscription windows, through `onUsage` and `harnessUsage`. They share no code.

## Considered and dropped

| Alternative | Why it lost |
|---|---|
| Keep each lab's own spend line | Four copies of one line, which ER-3 says go to the package |
| Put `costUsd` on FIX-2379's row view only | The row view carries the spend view (ER-4); the cost belongs in the fold it carries |
| Write the turn spend from a request-end hook, or at `onFinished` | Both run after the request publishes its terminal status, so a page that refreshes on it reads the turn before its spend lands (Codex, round 1). A request-end hook would also hold back every turn's status |
| Lift `Spend` and delete Claude Code-style's copy in PR 1 | Claude Code-style's copy takes its own row type and harness labels across six components; swapping it is app work, and the epic's D3 puts app changes after the package slice |
| Cursor's `onActivity` as its own issue | One line in `labs/teammates/host.mts`, which PR 4 already edits in its merge order; a separate issue adds a PR on the same file |
| Readers only on a host flow, as Shift Manager does | The collection has to be registered on the session flow anyway, for `onUsage` to write it. The flow's `harnessUsage` is `harnessUsageAction` itself, so the refresh and claim rules are one; a host with another flow may still read there |

## Analysis

2026-10-31, read from `main` 675f614. **Right approach.** Value: the four apps' "what did it cost"
line. Reuse: every Adds row composes an existing fold or writer ([Builds on / Adds](SPEC.md#whats-already-here-and-the-debt)).
Scope: D1 narrows the issue's Codex/Cursor ask to what their wires carry (recorded). Debt: net
down after PR 5.

## How it got here

- **Drafted (Oct 31)** from the issue and epic FIX-2369's seams, with the Codex and Cursor wire
  types read to settle D1.
- **Round 1 (Oct 31):** Codex showed `onFinished` runs after the terminal status is published
  (`runAction.ts`), so D2's write moved inside the turn; the goal's control became `main`, since
  no outside switch reaches a write inside the turn. Cursor's scope notes are answered under
  *Considered and dropped* and *Decided, not asked*.
