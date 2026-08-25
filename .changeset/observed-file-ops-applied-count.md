---
"@flow-state-dev/claude-code": patch
---

The observed file-operations record now carries `appliedCount` — how many
operations on that path the harness confirmed applied (LAB-134).

Each row already said what last happened to a path and how it settled, so a file
touched nine times read the same as one touched once. `appliedCount` is the
missing number, and it counts confirmed operations only: attempts that failed or
have not settled are not included, so the count answers "how many changes landed
here" rather than "how many were tried". A row written before this field existed
reads `null`, which is not the same as `0` — zero means the run touched the path
and nothing applied.
