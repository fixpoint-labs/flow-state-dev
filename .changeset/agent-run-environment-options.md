---
"@flow-state-dev/claude-code": minor
---

`claudeCodeAgent` takes four more options, all forwarded to the Agent SDK and all unset by default, so a run that does not set them behaves exactly as it does today (FIX-150).

- `settingSources` — which filesystem settings the run loads (`"user"`, `"project"`, `"local"`). Omitted, it loads all of them. `"project"` is what makes a run read `CLAUDE.md` and `.claude/settings.json` out of its working directory, so when that directory is assembled from your application's own resources, this is the option that stops user-writable files from configuring your agent.
- `env` — the run's environment variables. Replaces the process environment rather than adding to it.
- `sandbox` — the SDK's sandbox settings, forwarded verbatim. A value or a resolver: the settings that confine a run name the directory it works in (`filesystem.allowWrite` is a list of paths), and that directory is per run while one flow build serves many, so a constant can say "sandboxed" but not "sandboxed to this run's workspace".
- `uses` — capabilities installed on the block, the same slot every other block takes.
