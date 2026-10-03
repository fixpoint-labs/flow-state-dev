---
"@flow-state-dev/tools": minor
---

The `local` bash provider no longer passes the server's full environment to commands: they get `PATH`, `HOME`, `USER`, `LANG`, `LC_ALL`, `TERM`, `TMPDIR` and `TZ`, plus anything named in the new `env` option. That stops commands inheriting the server's secrets by accident; it is not an isolation boundary, since commands still run as the server's user. Use the `moat` provider or a container for untrusted commands. Commands now stop after 60 seconds (configurable with `execTimeoutMs`): the command's process group is killed (a process that detaches into its own session, such as a daemon, can survive) and the result reports `exitCode: 124`. `exitCode` is now always a number — a command killed by a signal reports `128 + signal` instead of `0` (FIX-1709).
