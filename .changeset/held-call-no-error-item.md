---
"@flow-state-dev/claude-code": patch
---

`claudeCodeAgent` leaves no error item when its run is stopped after an `onToolApproval` feed held a call. The stop is the wait for the user's answer, so only the "Waiting on approval" status shows; the run still throws its signal's reason for the host to read. A stop after any other decision still shows its error item (FIX-2472).
