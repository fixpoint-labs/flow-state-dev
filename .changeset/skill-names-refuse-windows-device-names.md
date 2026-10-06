---
"@flow-state-dev/orchestration": patch
---

Skill names that are Windows device names (`con`, `prn`, `aux`, `nul`, `com1`–`com9`, `lpt1`–`lpt9`) are now refused, so a skill with one of those names stops loading until it is renamed (FIX-1456).
