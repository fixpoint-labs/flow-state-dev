# Orchestration Primitives — rules every epic obeys

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md)

Each rule has one owner: the epic that implements and proves it. The others inherit it.

| | Rule | Owner | Checked where |
|---|---|---|---|
| **PR-1** | When one worker gives another work, then that work is a Task row on a board, never a payload on a side channel | FIX-2056, by FIX-2083 | FIX-2083's acceptance check; FIX-2087's closure run |
| **PR-2** | When a post between workers expects an answer, then it is a task filed with `createTask` and waited on through `getTask({ id, wait })`, claimed once and ended to its filer once, with the claim ticket the only once-only check; when it expects none, it is a plain message with no row, deadline or check | FIX-2056, by FIX-2081 | FIX-2081's acceptance check; FIX-2087's tool sweep |

Both rules moved from FIX-1870, canceled Oct 21, to FIX-2056 at its approval
([#3588](https://github.com/fixpoint-labs/flow-state-dev/pull/3588)). FIX-1870's children already
removed the coordinator's `handOff` and its delivery ledger; FIX-2083 removes the last exception,
the post row kind, and FIX-2081 ships the four task tools PR-2 names plus the worker's fifth,
`reportProgress`.

PR-2 is [PD-3](DECISIONS.md), which amends FIX-1816's D3.

**No epic may** add a model-facing tool that gives work to another worker beside FIX-2056's five
task tools (`answerTask` stays until FIX-2058 retires it), or a model-facing tool for tells
([PD-3](DECISIONS.md)); add a second once-only check beside the claim ticket; add a task store or
status vocabulary outside TaskCollection ([PD-1](DECISIONS.md)); or let a skill pick how its work
executes ([PD-2](DECISIONS.md)).
