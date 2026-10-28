---
"@flow-state-dev/orchestration": patch
---

A request parked on a person or on another wait no longer holds the ending of a task whose `getTask({ id, wait: true })` reached its deadline. The filing session's pass, woken at the park, lets the ending go: `onTaskSettled` hears it within seconds of the park, as it already hears a task the parked request filed. A wait on the task after the resume usually answers `arrivesAsNotice`; one that reads it in the couple of seconds before the pass takes the notice gets the ending inline instead. Either way the session hears it once. While the request runs, its next `getTask` on the task still gets the ending, as before. A request whose state the host can't read is treated as parked here too, as it already is for a held notice (FIX-2170).
