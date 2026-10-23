---
"@flow-state-dev/orchestration": patch
"@flow-state-dev/workforce": patch
---

A filing's dependency check reads each dependency as stored now, so a dependency another request failed or cancelled while the filing ran is refused `dependency_ended` at filing, and nothing is stored, as the docs say. Before, the filing was accepted and a cascade cancelled it moments later (FIX-2114).
