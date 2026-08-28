---
"@flow-state-dev/claude-code": minor
---

`claudeCodeAgent` takes four more options, all forwarded to the Agent SDK and all unset by default, so a run that does not set them behaves exactly as it does today (FIX-150).

- `settingSources` — which filesystem settings the run loads (`"user"`, `"project"`, `"local"`). Omitted, it loads all of them. `"project"` is what makes a run read `CLAUDE.md` and `.claude/settings.json` out of its working directory, so when that directory is assembled from your application's own resources, this is the option that stops user-writable files from configuring your agent.
- `env` — the run's environment variables. Replaces the process environment rather than adding to it.
- `sandbox` — the SDK's sandbox settings, forwarded verbatim. A value or a resolver: the settings that confine a run name the directory it works in (`filesystem.allowWrite` is a list of paths), and that directory is per run while one flow build serves many, so a constant can say "sandboxed" but not "sandboxed to this run's workspace". Typed as `SandboxSettings` (an open object, also exported) rather than `unknown` — `unknown | fn` collapses to `unknown`, and the resolver form would then compile with both parameters implicitly `any` under `strict`.
- `uses` — capabilities installed on the block, the same slot every other block takes. A capability handed to `createClaudeCodeAgentCapability` this way has its resource declarations promoted onto that capability: installed on the agent block alone they would sit inside a `tools` preset, where a flow's collector never reaches them, and the route would answer 404 at read time on a build that succeeded.
- `onErrored` — the standard block lifecycle hook, forwarded. It runs after the block threw and does not swallow the error. A capability cannot contribute lifecycle hooks, so anything that must run when a run *fails* — releasing what it was holding, saving what it got done — had nowhere else to go.
