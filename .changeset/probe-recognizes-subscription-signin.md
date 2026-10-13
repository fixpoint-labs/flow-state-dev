---
"@flow-state-dev/claude-code": patch
---

`probeClaudeAccount` now reports `account` for a Claude subscription sign-in. It names neither an API key nor a token source, so it was read as `none`; the result carries `email` and `subscriptionType` for it.
