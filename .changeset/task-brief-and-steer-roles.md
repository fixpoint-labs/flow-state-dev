---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/contracts": patch
"@flow-state-dev/orchestration": minor
"@flow-state-dev/workforce": minor
---

A task's session tells what a person said from what the task was handed (FIX-2574, FIX-2575).

- **core / engine:** an action's `userMessage` can return `{ text, metadata }`. The echo is still the request's `user` line, and it carries `metadata` for a client to read. A plain string works as before.
- **orchestration:** a steer from a person (sent from a screen, or a coding review's request for changes) now shows in the task's session as a `user` line with their words alone, not as an assistant line reading "Message from the user: …". A filer's or the board's steer reads as before. **Breaking:** `showTakenSteers` is now async; await it.
- **workforce:** a task request's opening `user` line (the task as filed, or re-queued with its steers) is marked as the task's brief. Read it with `taskBriefOf(item)` from `@flow-state-dev/workforce/browser` to draw it as a brief, not as the person's line.
