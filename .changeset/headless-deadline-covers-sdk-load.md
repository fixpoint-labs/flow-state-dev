---
"@flow-state-dev/claude-code": patch
---

`runClaudeHeadless`'s `timeoutMs` is now the wall-clock ceiling it is documented
to be (LAB-66): the clock starts before the Agent SDK is resolved, not after. Previously
the timer was armed only once `resolveAgent` had settled, so a stalled dynamic
`import()` or a caller-supplied resolver that never settles hung the call
forever — no result, and so nothing for a caller whose bookkeeping runs off the
returned value to record.

The two phases report themselves apart. A budget exhausted while loading settles
as "The Claude Agent SDK did not finish loading within the N ms budget, so the
Claude Code run never started."; a budget exhausted while running keeps naming
the run itself. Resolution cannot be cancelled — the resolver seam takes no
signal — so a wedged one is abandoned rather than aborted, and its eventual
value is discarded. The deadline timer is cleared on every path out, including
the new early return.
