---
"@flow-state-dev/claude-code": minor
---

Add `runClaudeHeadless` — point the Claude Code agent at a directory, wait for it to finish, and read what it did and what it cost (LAB-66).

The package's `/cli` entry hands work to a cloud session and returns immediately, and `/sdk`'s `claudeCodeAgent` runs the agent as a flow block. That left nothing for the third thing a caller can want: run the agent locally in a specific directory, block until it is done, and find out what happened. Callers were reimplementing the invocation themselves.

New from `@flow-state-dev/claude-code/sdk`:

- `runClaudeHeadless(options)` — runs the agent in `options.cwd` and resolves to `{ ok, error, finalMessage, sessionId, costUsd, subtype, usage }`. A plain async function, not a block, so it needs no `BlockContext` and no session.
- `defaultResolveClaudeAgentQuery` / `createResolveClaudeAgentQuery` — the same resolver seam the agent block uses, without a block context. Inject one to run the SDK yourself, or to run nothing in a test.

It goes through the Agent SDK's `query()`, so a run gets the harness Anthropic maintains — the tool loop, context management, permission modes, sub-agents — and reports a structured outcome. `subtype` tells a ceiling you set (`error_max_turns`, `error_max_budget_usd`) apart from a failure you cannot raise your way out of; `usage` reports tokens, which is the only spend signal when the credentials in play bill no dollar cost.

It **settles rather than throws**: an uninstalled SDK, a timeout, a crash mid-run, and an error-subtype result all come back as `ok: false` with a reason, so a caller keeping a ledger off the return value never loses the record to an exception. Cost and usage are reported on failed runs too — the tokens were still spent.

Two defaults differ deliberately from the SDK's own, so a run behaves like Claude Code does in the same directory: `settingSources` defaults to `["user", "project", "local"]` (the SDK loads none, which means no `CLAUDE.md`), and `systemPrompt` defaults to Claude Code's preset (the SDK's default is an empty prompt). Pass `settingSources: []` for an isolated run.

`@anthropic-ai/claude-agent-sdk` stays an optional peer dependency, loaded lazily on first use — importing the package without it installed still works, and a run without it settles as a failure naming what is missing.
