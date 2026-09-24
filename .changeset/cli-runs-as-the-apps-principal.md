---
"@flow-state-dev/engine": minor
"@flow-state-dev/fsdev": minor
---

`fsdev run` and `fsdev chat` now run as whoever the app's resolver names (new `FlowState.resolveInProcessPrincipal`, with `source: "cli"` reserved for it), stop with exit 2 before writing anything when that resolver or a seat's pin refuses the terminal (a `--session` owned by another user or organization now also exits 2 instead of 1), and take `--org`/`--user` to name the identity locally (FIX-1551).
