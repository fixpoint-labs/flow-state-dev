---
"@flow-state-dev/claude-code": patch
---

`claudeCodeHarness()` accepts `extraAllowedTools`, tools added to its default `Read`, `Write`, `Edit` and `Bash` list, so a host can offer `Skill`, `Grep` or `Glob` without writing its own harness. Pre-approving `Grep` or `Glob` skips path prompts, including outside the working directory. The harness still loads project settings only, with hooks off, and now also turns off inline shell commands in skills (FIX-2877).

Docs: packages/claude-code/README.md and apps/docs/docs/catalog/harnesses/claude-code.md (the `claudeCodeHarness()` options)
