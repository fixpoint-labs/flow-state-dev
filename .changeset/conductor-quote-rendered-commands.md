---
---

Internal: `@flow-state-dev/conductor` (private, unpublished) — show the goal command conductor actually runs (LAB-121).

Conductor spawns the declared goal command itself with `shell: false`, so each element of the argv is one argument whatever it contains. Both places that render that argv for a person joined it on spaces instead, which is a different command as soon as any element holds a space, a quote, or a metacharacter. `["bash", "-lc", "pnpm tsx goals/run-for-issue.mts"]` rendered as `bash -lc pnpm tsx goals/run-for-issue.mts FIX-1`, a line a shell reads as `bash -lc pnpm` with the rest positional — so it runs `pnpm`.

That misfired in two directions. The phase brief tells the agent to run the check before it stops, so the agent's pre-flight check graded a different program than conductor grades — cheapest outcome, a wasted revision round. And a `not-run` failure reason named a command nobody could have run, sending whoever read it to reproduce something other than the failure.

Both now render through one helper that quotes each element the way a shell needs it. This is display only — nothing on the path to `spawn` changed, and a command needing no quoting still renders exactly as it was written.
