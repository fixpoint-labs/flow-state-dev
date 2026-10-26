---
"@flow-state-dev/orchestration": patch
---

If a person's answer lands just as a `goalSeekLoop` drain stops, the loop drains again for the turn the task owes before judging, and those drains spend no iteration. If the task still owes a turn when they run out, the pass ends with `reason: "waiting-on-a-user"` without judging (FIX-2210).
