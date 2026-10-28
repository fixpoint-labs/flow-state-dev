---
"@flow-state-dev/harness-manager": minor
---

`harnessManager({ reviewChanges: true })` has a user review a run's commits before its task completes. A run that would complete with commits on its branch holds the task on a review (`ask.kind: "review"`) that lists the commits and the judge's verdict. The user accepts, or asks for changes in words, which one more run on the same attempt takes as a steer in the same coding session. The answer is checked against the exported `harnessReviewAnswerSchema` (type `HarnessReviewAnswer`). The manager's output gains `review: "accepted" | "deadline" | null`; `"deadline"` means the host's `userDeadlineMs` passed with no answer, not an approval. Needs a host with durable execution: without it, a manager with `reviewChanges` on cancels the task before any harness step. Off by default (FIX-2163).
