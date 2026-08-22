---
"@flow-state-dev/fsdev": minor
---

Remove `--format` from `fsdev run`. The command always writes NDJSON to stdout; `fsdev block` and `fsdev benchmark` still honor `--format`.
