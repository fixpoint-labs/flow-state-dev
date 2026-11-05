---
"@flow-state-dev/engine": patch
---

The default in-memory change bus now reports `crossesProcesses: true`. It is the bus for an app that runs as one process, where every change is made where its subscribers are. On it, an open session stream no longer reads the store once a second, and a client subscription with `pollIntervalMs` stops its fallback timer while its socket is open. Updates arrive on change notices instead. An app that writes its stores from several processes needs a bus that crosses, such as the Postgres bus that Postgres stores fill by default. On the in-memory bus, a change written by another process (a second server on the same SQLite file, or `fsdev run` / `fsdev chat` writing the file a running `fsdev dev` serves) reaches an open page only at its next read (FIX-2545).
