---
"@flow-state-dev/claude-code": minor
---

`FSD_CLAUDE_CODE_AUTH` chooses whether a server's `ANTHROPIC_API_KEY` reaches Claude Code (FIX-2954). Claude Code always signs in with a key it finds over a `claude` sign-in, so a server that keeps the key for direct model calls billed every harness run to it.

- `api-key` (default, unchanged): the key is passed when set.
- `prefer-login`: the key is held back when Claude Code finds a sign-in without it, and passed when it finds none. Asked once per process; restart after signing in.
- `login-only`: the key is never passed to Claude Code.

Any other value is refused. It applies to every Claude Code process the package starts: runs, `probeClaudeCodeAccount` / `checkClaudeCodeReadiness`, and `listClaudeCodeModels`. `applyClaudeCodeAuthPreference`, `readClaudeCodeAuthPreference` and `CLAUDE_CODE_AUTH_VAR` are exported for hosts that start Claude Code themselves.

Docs: packages/claude-code/README.md (environment / sign-in section) and the Claude Code harness page under apps/docs.
