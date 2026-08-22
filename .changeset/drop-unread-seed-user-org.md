---
"@flow-state-dev/fsdev": minor
---

Remove `--seed-user` and `--seed-org` from `fsdev run`. Those flags were accepted and written into `--capture` metadata but never applied to stores. Use `--seed-session` to seed session state (FIX-1210).

The `--capture` JSON drops the matching `options.seedUser` and `options.seedOrg` keys — anything parsing a captured run should stop reading them.
