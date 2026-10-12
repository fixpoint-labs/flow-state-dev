# Orchestration Primitives — rules every epic obeys

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md)

Each rule has one owner: the epic that implements and proves it. The others inherit it.

| | Rule | Owner | Checked where |
|---|---|---|---|
| **PR-1** | When one worker gives another work, then that work is a Task row on a board, never a payload on a side channel | FIX-1870 · *proposed* | FIX-1875's goal check, once its spec lands |
| **PR-2** | When a board task's ending is delivered, then the claim ticket refuses a second delivery | FIX-1870 · *proposed* | FIX-1872's goal check, once its spec lands |

Both are *proposed* until FIX-1870 passes its objective gate, because the checks that prove them
belong to children not yet specced. Both hold in spirit already: the board and its claim ticket
shipped under the Plan/Task series and FIX-939. FIX-1870 owns them because it removes the
exception, the coordinator's `handOff`.

PR-2 is written to what holds either way. FIX-1870 as filed also removes the coordinator delivery
ledger, which FIX-1816's D3 kept as the fence for a coordinator's post; which one stands is open
([Decisions](DECISIONS.md) → *Open*), and PR-2 widens to "no other fence" only if the ledger goes.

**No epic may** add a model-facing tool that dispatches work to another worker beside the one
FIX-1870 ships; add a task store or status vocabulary outside TaskCollection
([PD-1](DECISIONS.md)); or let a skill pick how its work executes ([PD-2](DECISIONS.md)).
