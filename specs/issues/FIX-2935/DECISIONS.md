# FIX-2935 · Decisions

[Spec](SPEC.md) · **Decisions**

## D1 · The shared rule keeps today's bash folder paths

**The call.** The folder rule produces the same path the bash tools produce today for the same
scope and identity. harness-manager's checkout paths may change shape if keeping them would mean
two encoders; a run in flight keeps the path recorded on its row, so only new checkouts move.

**Why.** Bash folders hold a person's files between turns. Moving them silently would look like
lost work. Checkout paths are recorded on the run row, so a new shape only affects new runs.

**If wrong:** an existing checkout directory sits beside the new one until the worktree sweeper
reaches it.

## D2 · The helpers' names are the implementer's

`scopeFolder` and the projection session helper's name are working names. Read
`docs/contributing/glossary.mjs` before naming, and record the chosen names in the PR.
