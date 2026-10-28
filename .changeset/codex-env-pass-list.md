---
"@flow-state-dev/codex": patch
---

`CODEX_PASS` names the only variables of the server's environment a Codex run needs. Build the run's environment with `client: { env: harnessEnv({ pass: CODEX_PASS }) }` so the Codex CLI doesn't inherit the server's whole `process.env`.
