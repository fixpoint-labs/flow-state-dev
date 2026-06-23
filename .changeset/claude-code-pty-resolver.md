---
"@flow-state-dev/claude-code": minor
---

Add a PTY-backed resolver so `claude --remote` cloud dispatch actually works.

`claude --remote` refuses to run unless stdout is a TTY — a bare subprocess (piped stdout) auto-engages local `--print` mode and exits 1 with "--remote requires an interactive terminal". The existing `defaultClaudeCliExec` is a bare `spawn`, so `claudeRemoteDispatch` could never dispatch with it; every host had to supply its own PTY workaround.

New exports from `@flow-state-dev/claude-code/cli`:

- `resolvePtyClaudeCli` — a `ResolveClaudeCli` that runs PATH `claude` under `script(1)` (a pseudo-terminal). Pass it as `resolveClaudeCli` to `claudeRemoteDispatch` / `createClaudeCliCapability`.
- `scriptPtyClaudeCliExec` — the underlying `ClaudeCliExec`, if you want to build your own resolver around it.
- `stripAnsi` — the helper used to clean PTY output before banner parsing.

The exec also scrubs inherited `CLAUDE_*` / `CLAUDECODE` session state and `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` from the dispatched child (so a cloud dispatch authenticates as the logged-in user instead of tripping a "Detected a custom API key" prompt), and resolves the moment the session URL streams in rather than waiting for the local process to exit (so a cold start doesn't stall the dispatch). Requires `script(1)`, present on macOS and Linux. The default exec is unchanged; this is additive and opt-in.
