---
"@flow-state-dev/claude-code": patch
---

`claudeCodeHarness()` accepts `allowedTools` and optional `settingSources` so hosts can widen tools without reimplementing the harness. Pre-approving `Grep` or `Glob` skips path prompts, including outside the working directory. The harness keeps project-only settings by default, disables hooks, and disables inline shell execution in skills (FIX-2877).