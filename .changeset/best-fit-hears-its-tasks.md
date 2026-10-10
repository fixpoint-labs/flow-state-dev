---
"@flow-state-dev/workforce": patch
---

A coordinator that routes by best fit now hears a task it filed end in its own turn, as one that routes by judgment does, so it can file a failed task again and tell the person. Round robin and everyone still show the ending as a line only (FIX-1863).
