---
"@flow-state-dev/core": patch
"@flow-state-dev/harness-manager": patch
"@flow-state-dev/claude-code": patch
"@flow-state-dev/codex": patch
"@flow-state-dev/cursor": patch
---

A message on a coding task whose pull request merged or closed is answered by a read-only run, held by the harness itself, not by the prompt (FIX-2900).

- **Harness access.** `@flow-state-dev/core/harness` adds `HarnessAccess` (`"full" | "read-only"`), an optional `access` feed on `HarnessFeeds`, and `HarnessBlock.enforcesReadOnly`: a harness's word that it holds a `read-only` run with its vendor's own limit. With no feed, or `"full"`, every harness builds the options it built before.
- **The harness manager** feeds `read-only` to the run that answers a person's message on a task whose pull requests merged or closed, and to a retry of that turn. An open pull request, a first turn, and a wake whose pull request couldn't be read from GitHub keep full access. A harness that doesn't declare `enforcesReadOnly` gets no run there: the task settles with a note that a change needs a new task. The scripted stub harness declares it, and does nothing in its checkout on a read-only run.
- **Claude Code** (`claudeCodeAgent({ access })`): a read-only run is offered `Read`, `Grep` and `Glob` only, in `dontAsk`, with no approval seam, no relayed or checkout MCP server and no checkout settings (`settingSources: []`), so it doesn't load the checkout's `CLAUDE.md` either.
- **Codex** (`codexAgent({ access })`): a read-only run runs in Codex's `read-only` sandbox, never asks, and has no network. Its shell can still read (`git log`).
- **Cursor** (`cursorAgent({ access })`): a read-only run is offered reading tools only (`read`, `grep`, `glob`, `ls`, `semSearch`, `readLints`, `readTodos`), with no MCP server, custom tool, subagent or checkout settings.
- On a read-only run, each harness's limit wins over anything its own options set. The three shipped harnesses declare `enforcesReadOnly` and take the feed from the harness kit.

Docs: apps/docs/docs/reference/harness-runs.md (*Talking to a run*: a message once the work is done is answered read-only, and what each harness can still do; *Per-agent options*: `access` on each agent, `enforcesReadOnly`), and the core, harness-manager, claude-code, codex and cursor READMEs.
