---
"@flow-state-dev/tools": minor
---

The `local` bash provider no longer passes the server's full environment to commands: they get `PATH`, `HOME`, `USER`, `LANG`, `LC_ALL`, `TERM`, `TMPDIR` and `TZ`, plus anything named in the new `env` option. Commands now stop after 60 seconds (configurable with `execTimeoutMs`) and report `exitCode: 124`, and `exitCode` is always a number — a command killed by a signal reports `128 + signal` instead of `0` (FIX-1709).
