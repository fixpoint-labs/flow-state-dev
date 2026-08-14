---
"@flow-state-dev/claude-code": minor
---

Add `runClaudeHeadless` — a blocking, directory-scoped `claude -p` run that returns a result you can read a cost off (LAB-66).

The package's existing CLI surface hands work to a cloud session and returns immediately, wrapped as a flow block. That leaves nothing for a caller that needs the other thing: run the agent locally in a specific directory, wait for it to finish, and find out what happened and what it cost. Callers were reimplementing the spawn, the flags and the JSON envelope themselves.

New exports from `@flow-state-dev/claude-code/cli`:

- `runClaudeHeadless(options)` — runs `claude -p "<prompt>" --output-format json` in `options.cwd` and resolves to `{ ok, error, finalMessage, sessionId, costUsd }`. `--model` and `--permission-mode` are only passed when you set them, so the CLI's own defaults stand otherwise.
- `parseClaudeJson(stdout)` — the envelope parser, if you drive the CLI yourself. Tolerates leading chatter on stdout and returns `null` rather than throwing when nothing parses.

It **settles rather than throws**: a missing binary, a timeout, a crash, and a non-zero exit all come back as `ok: false` with a reason, so a caller keeping a ledger off the return value never loses the record to an exception. Cost is reported on failed runs too — the tokens were still spent. It is a plain async function, not a block, so it needs no `BlockContext`; it runs through the same `ClaudeCliExec` seam as the rest of the CLI surface, so `exec` is injectable and tests spawn nothing.
