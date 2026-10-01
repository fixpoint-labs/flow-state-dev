---
"@flow-state-dev/orchestration": minor
"@flow-state-dev/harness-manager": minor
---

A person can send a running coding run a message (FIX-1690). `manager.messageDoor(board)` builds a public action that takes `{ message }` on the run's own session: it stops a running attempt, and the next attempt resumes the same coding session with the message in its prompt. A run waiting on a question or between attempts keeps the message for its next attempt. A refusal (never started, finished, a harness that can't resume) fails the request with `TurnRefused`. The manager registers a new `turns` collection, so a capability that claims the `turns` accessor is now refused.

In orchestration, `awaitReview(id, feedback, { forTurn: true })` parks a running row for a person's turn. It runs only from `in_progress`, and the claim that follows its `unpark` is counted in the new `turnReentries` field and not charged against `maxAttempts`.
