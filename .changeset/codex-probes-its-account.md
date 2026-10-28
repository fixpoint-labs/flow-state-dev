---
"@flow-state-dev/codex": patch
---

`probeCodexAccount({ env, timeoutMs?, signal? })` asks whether Codex has a credential to run on, with no run (FIX-2014). A `CODEX_API_KEY` in `env` reads `account` with `source: "api-key"` on its own; otherwise it runs the SDK's own `codex login status` and reads `account` with `source: "login"`, `none` with Codex's reason (plus `unanswered: true` when Codex timed out, was stopped, or couldn't start), or `sdk-missing`. It never throws, and its shape follows `probeClaudeAccount` in `@flow-state-dev/claude-code`.
