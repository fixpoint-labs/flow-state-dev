---
"@flow-state-dev/claude-code": patch
---

`@flow-state-dev/claude-code/sdk` exports `CLAUDE_CODE_PASS`, the environment variables a Claude Code run needs, for `harnessEnv({ pass: CLAUDE_CODE_PASS })` from `@flow-state-dev/core` (FIX-2014): `PATH`, `HOME`, `USER`, `SHELL`, `TMPDIR`, `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, and the proxy and CA settings a proxied network needs, in both cases.
