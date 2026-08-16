---
"@flow-state-dev/claude-code": minor
---

Add `runClaudeHeadless` — point the Claude Code agent at a directory, wait for it to finish, and read what it did and what it cost (LAB-66).

The package's `/cli` entry hands work to a cloud session and returns immediately, and `/sdk`'s `claudeCodeAgent` runs the agent as a flow block. That left nothing for the third thing a caller can want: run the agent locally in a specific directory, block until it is done, and find out what happened. Callers were reimplementing the invocation themselves.

New from `@flow-state-dev/claude-code/sdk`:

- `runClaudeHeadless(options)` — runs the agent in `options.cwd` and resolves to `{ ok, error, finalMessage, sessionId, costUsd, subtype, usage }`. A plain async function, not a block, so it needs no `BlockContext` and no session.
- `defaultResolveClaudeAgentQuery` / `createResolveClaudeAgentQuery` — the same resolver seam the agent block uses, without a block context. Inject one to run the SDK yourself, or to run nothing in a test.

It goes through the Agent SDK's `query()`, so a run gets the harness Anthropic maintains — the tool loop, context management, permission modes, sub-agents — and reports a structured outcome. `subtype` tells a ceiling you set (`error_max_turns`, `error_max_budget_usd`) apart from a failure you cannot raise your way out of; `usage` reports tokens, which is the only spend signal when the credentials in play bill no dollar cost.

It **settles rather than throws**: an uninstalled SDK, an option it refuses, a timeout, a crash mid-run, and an error-subtype result all come back as `ok: false` with a reason, so a caller keeping a ledger off the return value never loses the record to an exception. Cost and usage are reported on a failed run too, for any run that reached a terminal result — a timeout or a mid-stream throw reports `null` for both, though the tokens were still spent.

What it guarantees:

**`timeoutMs` bounds the whole call.** The clock starts before the Agent SDK is resolved, and the message loop is then stepped against the deadline rather than aborted-and-waited-on, so neither a stalled dynamic `import()` nor an iterator that stopped reading its abort signal can outlive the budget, and a result arriving after the timer fired is not reported as a success. Leaving means abandoning a live agent, so the run is aborted and the stream `close()`d when the SDK offers that, and the reason says which happened — a run that was stopped, or one abandoned before it acknowledged the stop and possibly still running. A budget spent loading the SDK says so, instead of blaming a run that never started.

**A ceiling that is not a ceiling is refused, and no run starts** (LAB-120, LAB-104). `timeoutMs` must be positive and no greater than `2147483647` ms: `setTimeout` silently resets `NaN`, a negative, and anything larger to 1 ms, so the more generous the budget you asked for, the faster the run died. `maxTurns` and `maxBudgetUsd` must be positive and finite: the pinned Agent SDK forwards `Infinity` and its parser reads it as no ceiling at all, so a caller who believed they had capped their spend got an unbounded paid run. Anything else settles immediately as a failure naming the option and the value — there is no spend to account for and no agent to hunt down. Nothing is clamped, because a shorter ceiling granted silently is the same class of bug. `0` is invalid rather than a second spelling of "no ceiling"; omitting the option already means that.

**A run the SDK flagged, or was refused a tool it needed, is a failed run** (LAB-74). The SDK ends an unauthenticated run — a missing or expired credential, a fresh container, a misconfigured CI runner — with `subtype: "success"`, its `is_error` flag set, and the reason in the result text (`Invalid API key · Please run /login`). It ends a refused run the same way: the model is told the tool was denied, works around it, and stops normally. Read the subtype alone and both record as completed runs with zero turns, zero cost, and a commit that was never made. `ok` is the verdict and `subtype` is the report, and one shared reader answers "did this succeed" for `runClaudeHeadless` and `claudeCodeAgent` alike, so the two surfaces cannot disagree about the same result. A refusal leads with *refused* and names every refused call, so a missing permission reads differently from an agent that tried and failed.

Two defaults differ deliberately from the SDK's own, so a run behaves like Claude Code does in the same directory: `settingSources` defaults to `["user", "project", "local"]` (the SDK loads none, which means no `CLAUDE.md`), and `systemPrompt` defaults to Claude Code's preset (the SDK's default is an empty prompt). Pass `settingSources: []` for an isolated run.

`@anthropic-ai/claude-agent-sdk` stays an optional peer dependency, loaded lazily on first use — importing the package without it installed still works, and a run without it settles as a failure naming what is missing.
