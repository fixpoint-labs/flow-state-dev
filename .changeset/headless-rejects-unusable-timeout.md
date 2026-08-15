---
"@flow-state-dev/claude-code": patch
---

`runClaudeHeadless` now refuses a `timeoutMs` no timer can hold, instead of
letting it become a run that dies in about a millisecond (LAB-66).

A timer's delay is a 32-bit signed integer, and `setTimeout` does not reject one
it cannot represent — it quietly resets `NaN`, a negative, and anything above
`2147483647` ms to **1 ms**. So the more generous the budget you asked for, the
faster the run died: a 30-day ceiling is `2592000000`, past the limit, and it
settled in about 3 ms reporting that the run had "exceeded its 2592000000 ms
budget" and might still be running. That is the wrong diagnosis in the way that
costs the most time — it points whoever reads the ledger at the agent, when the
thing at fault was the number. `NaN` and a negative do it with no warning at all.

`timeoutMs` must now be a positive number of milliseconds no greater than
`2147483647` (about 24.8 days). Anything else settles immediately as a failure
that names the option and the value and says plainly that no run was started —
so there is no spend to account for and no stray agent to hunt down. Nothing is
clamped: a ceiling shorter than the one you asked for, granted silently, is the
same class of bug as the one being fixed, so a budget you cannot have is
reported rather than swapped. `0` is invalid rather than a second spelling of
"no ceiling" — omitting the option already means that, and reading `0` as
unbounded would fail open on an exhausted computed budget, which is the input
that should refuse fastest.

It settles rather than throwing, like every other failure on this surface. The
value of the settle-not-throw contract is the reason the failure carries into a
caller's ledger, and "you passed a bad number" is exactly the diagnosis a thrown
error would delete instead of deliver.
