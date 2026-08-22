---
"@flow-state-dev/fsdev": minor
---

Remove `--seed-user` and `--seed-org` from `fsdev run`. Those flags were accepted and written into `--capture` metadata but never applied to stores. Use `--seed-session` to seed session state (FIX-1210).
