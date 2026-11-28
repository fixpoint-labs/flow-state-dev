---
"@flow-state-dev/claude-code": patch
---

`claudeCodeHarness()` accepts `extraAllowedTools` and optional `settingSources` so hosts can widen the default tool list without reimplementing the harness. Pre-approving `Grep` or `Glob` skips path prompts, including outside the working directory. The harness keeps project-only settings by default, disables hooks, and disables inline shell execution in skills (FIX-2877).