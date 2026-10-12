# Orchestration Primitives — rules every epic obeys

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md)

Each rule has one owner: the epic that implements and proves it. The others inherit it.

| | Rule | Owner | Checked where |
|---|---|---|---|
| **PR-1** | When one worker gives another work, then that work is a Task row on a board, never a payload on a side channel | FIX-1870 | FIX-1875's goal check (spec not yet written) |
| **PR-2** | When a task's ending is delivered, then the board claim ticket is what refuses a second delivery; no other ledger fences it | FIX-1870 | FIX-1872's goal check (spec not yet written) |

Both rules hold in spirit already, since the board and its claim ticket shipped under the Plan/Task
series and FIX-939. They have an owner now because FIX-1870 is the epic that removes the
exceptions: the coordinator's `handOff`, `post-to-mailbox`, and the coordinator delivery ledger.

**No epic may** add a model-facing tool that hands work to another worker beside the one FIX-1870
ships; add a task store or task status vocabulary outside TaskCollection (PD-1); or let a skill
pick how its work executes (PD-2).
