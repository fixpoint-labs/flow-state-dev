---
"@flow-state-dev/engine": minor
"@flow-state-dev/fsdev": minor
---

`fsdev run` and `fsdev chat` now run as whoever the app's `resolvePrincipal` says, asked the same way the app's HTTP routes ask, instead of always running as `cli-user` in the development organization. Apps with no resolver are unchanged. A resolver that needs a credential refuses the terminal: the run stops before writing anything and exits 2. `--org <id>` (on `run` and `chat`) names the organization yourself, and `--user <id>` is now on `run`. `--capture` records `command.principal { userId, orgId, from }`, and a `--session` / `--seed-session` owned by another user or organization is refused before any write (FIX-1551).

The engine adds `FlowState.resolveInProcessPrincipal` and `resolveInProcessPrincipal({ registry, resolvePrincipal? }, question)`. `source: "cli"` is now reserved: every inbound host refuses it on a context that entry point did not build, so a custom transport adapter that stamps `cli` is refused before any resolver runs.
