---
"@flow-state-dev/claude-code": patch
---

`runClaudeHeadless` now refuses a `maxBudgetUsd` or `maxTurns` that is not a
ceiling, instead of forwarding it to a vendor that reads it as no ceiling at
all (LAB-120, LAB-104).

A computed `maxBudgetUsd` of `Infinity` was passed straight through. The pinned
Agent SDK (0.1.77) sends `--max-budget-usd` whenever the value is not
`undefined`, and its bundled parser rejects only `isNaN(x) || x <= 0` —
`Infinity` clears both tests. So a caller who believed they had capped their
spend got an unbounded paid run, with nothing anywhere saying otherwise.
`maxTurns` failed open in two more ways: the transport gates it on truthiness,
so `0` and `NaN` were dropped and the run was unbounded, and `--max-turns` is
parsed with a bare `Number` and no validation, so `Infinity` and a negative were
taken as written.

Both must now be a positive, finite number. Anything else settles immediately as
a failure that names the option and the value and says plainly that no run was
started — so there is no spend to account for and no agent to hunt down.
Fractional budgets are still ordinary: the unit is dollars, and `0.25` is a
ceiling like any other. Neither number has an upper bound, since nothing
downstream caps them.

This is the same class as the `timeoutMs` guard, failing in the opposite
direction, which is why it is worth its own fix rather than a note. An unusable
`timeoutMs` ends a run far too early and someone notices within seconds; an
unusable spend ceiling ends nothing, and the first evidence is the bill. `0` is
invalid rather than a second spelling of "no ceiling" for the reason it is there
too — omitting the option already means unbounded, and reading an exhausted
computed budget as permission to spend freely fails open on exactly the input
that should refuse fastest.

It settles rather than throwing, like every other failure on this surface, so
the diagnosis reaches the caller's ledger instead of skipping it.
