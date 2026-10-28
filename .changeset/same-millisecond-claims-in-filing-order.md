---
"@flow-state-dev/orchestration": patch
---

Tasks filed in the same millisecond are claimed in the order they were filed. The id counter is fixed-width, so those ids compare in mint order. (FIX-2219)
