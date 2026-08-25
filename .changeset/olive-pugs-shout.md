---
"@flow-state-dev/claude-code": minor
---

Give a Claude Code SDK run its own working directory.

`claudeCodeAgent({ cwd })` takes a resolver called once per run, so one flow
build can point each run at a different directory. The run's file tools address
relative paths inside it, and `recordWork`'s index of what the run touched is
keyed there too — a file written as `src/a.ts` by a run in one checkout and by a
run in another produces two entries rather than one.

It is a working directory, not a boundary: a run can still address an absolute
path outside it, and that operation is recorded at the path it reached.

Unset, the run and its record both use the server process's directory, exactly
as before.
