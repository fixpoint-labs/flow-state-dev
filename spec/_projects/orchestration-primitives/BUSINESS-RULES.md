# Orchestration Primitives — rules every epic obeys

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md)

Each rule has one owner: the epic that implements and proves it. The others inherit it.

| | Rule | Owner | Checked where |
|---|---|---|---|
| **PR-1** | When one worker gives another work, then that work is a Task row on a board, never a payload on a side channel | FIX-1870 · *proposed* | FIX-1875's goal check, once its spec lands |
| **PR-2** | When a post between workers expects an answer, then it is a task through `dispatchTask`, claimed once and ended done or failed to the caller, with the claim ticket the only once-only check; when it expects none, it is a plain message with no row, deadline or check | FIX-1870 · *proposed* | FIX-1872's goal check, once its spec lands |

Both are *proposed* until FIX-1870 passes its objective gate, because the checks that prove them
belong to children not yet specced. The board and its claim ticket shipped under the Plan/Task
series and FIX-939; FIX-1870 owns both rules because it removes the exceptions, the coordinator's
`handOff` and its delivery ledger.

PR-2 is [PD-3](DECISIONS.md), which amends FIX-1816's D3: the coordinator delivery ledger goes
with FIX-1872, whose spec first checks whether any coordinator post today is a tell.

**No epic may** add a model-facing tool that dispatches work to another worker beside the one
FIX-1870 ships, or a model-facing tool for tells ([PD-3](DECISIONS.md)); add a second once-only
check beside the claim ticket; add a task store or status vocabulary outside TaskCollection
([PD-1](DECISIONS.md)); or let a skill pick how its work executes ([PD-2](DECISIONS.md)).
