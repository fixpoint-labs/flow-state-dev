---
"@flow-state-dev/devtool": patch
---

`@flow-state-dev/devtool/react` exports `readDevtoolUrl()`, which reads the DevTool address `fsdev dev --app` writes into each page (the `fsdev-devtool-url` meta), and `traceHref(devtoolUrl, sessionId?)`, which builds the link that opens one session in the DevTool (FIX-2405).
