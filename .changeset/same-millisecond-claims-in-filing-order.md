---
"@flow-state-dev/orchestration": patch
---

Tasks filed in the same millisecond are claimed in the order they were filed. Before, once a process had minted 9, 99, 999 and so on task ids, the next task could be claimed ahead of the two filed just before it. Task ids now carry a fixed-width counter, so they compare in the order they were minted. (FIX-2219)
