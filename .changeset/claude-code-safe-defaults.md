---
"@flow-state-dev/claude-code": minor
---

`claudeCodeAgent()` now starts a run with a filtered environment and every hook off when the host doesn't say otherwise (FIX-2820). These were the harness kit's settings already; a direct `claudeCodeAgent()` now gets the same.

- **`env` defaults to Claude Code's pass list**, `harnessEnv({ pass: CLAUDE_CODE_PASS })`, read when each run starts. It used to be the server's whole `process.env`. A host that needs more variables passes its own list; passing `process.env` restores the old behaviour.
- **Hooks are off by default.** The run's settings start from `{ disableAllHooks: true }` and the host's `settings` are laid over it, so a repository's hooks don't run unless the host passes `settings: { disableAllHooks: false }`.

Docs: packages/claude-code/README.md and apps/docs/docs/catalog/harnesses/claude-code.md (the `env` and `settings` defaults; any example that leaves `env` unset to inherit the server's environment)
