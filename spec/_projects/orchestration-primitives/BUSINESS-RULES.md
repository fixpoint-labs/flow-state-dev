# Orchestration Primitives — rules every epic obeys

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md)

Each rule has one owner: the epic that implements and proves it. The others inherit it.

| | Rule | Owner | Checked where |
|---|---|---|---|
| **PR-1** | When one worker gives another work, then that work is a Task row on a board, never a payload on a side channel | FIX-2056, by FIX-2083 | FIX-2083's acceptance check; FIX-2087's closure run |
| **PR-2** | When a post between workers is tracked work (attempts, a retry, an ending owed to its filer), then it is a task filed with `createTask` and waited on through `getTask({ id, wait })`, claimed once and ended to its filer once, with the claim ticket the only once-only check; otherwise it is a message on the one message tool, `sendMessage`: a call is talk that waits on the engine's wait gate and is owed no tracked ending, and a tell waits on nothing | FIX-2056, by FIX-2081; the message, FIX-2070 | FIX-2081's acceptance check; FIX-2087's tool sweep |
| **PR-3** | When work stops for a person, then it is one Inbox item, answered once: a `waitForUser` suspension (an approval, a review, input) when code reads the answer on its next line, otherwise a hold on its task row (a question or a confirm), with no deadline unless the host or the call sets one | FIX-2058, by FIX-2129 and FIX-2133 | FIX-2134's closure walk and its `PERSON_STOPS_REMOVED` sweep ([#3951](https://github.com/fixpoint-labs/flow-state-dev/pull/3951)) |

Both rules moved from FIX-1870, canceled Oct 21, to FIX-2056 at its approval
([#3588](https://github.com/fixpoint-labs/flow-state-dev/pull/3588)). FIX-1870's children already
removed the coordinator's `handOff` and its delivery ledger; FIX-2083 removes the last exception,
the post row kind, and FIX-2081 ships the four task tools PR-2 names plus the worker's fifth,
`reportProgress`.

PR-2 is [PD-3](DECISIONS.md), which amends FIX-1816's D3.

PR-3 came with FIX-2058, wrapped Oct 27. It removed `answerTask`, the question and review parks
and the harness manager's own question inbox; the Inbox answers a suspension through the engine's
answer route and a row hold through the board's `updateTask` action, and the server sets who
answered ([FIX-2058 ER-7](https://github.com/fixpoint-labs/flow-state-dev/blob/main/specs/epics/FIX-2058/DECISIONS.md#who-owns-what)).

**No epic may** add a model-facing tool that gives work to another worker beside FIX-2056's five
task tools, or a second model-facing message tool beside `sendMessage` ([PD-3](DECISIONS.md)); add a park, or a third route
that answers a person's stop beside the two PR-3 names; add a second once-only check beside the claim ticket (a delivery's take of a notice or a message
is idempotency, not a claim, [FIX-2070 D2](https://github.com/fixpoint-labs/flow-state-dev/blob/main/specs/epics/FIX-2070/DECISIONS.md#d2)); add a task store or
status vocabulary outside TaskCollection ([PD-1](DECISIONS.md)); or let a skill pick how its work
executes ([PD-2](DECISIONS.md)).
