---
"@flow-state-dev/orchestration": minor
"@flow-state-dev/harness-manager": minor
"@flow-state-dev/workspace": patch
"@flow-state-dev/core": patch
"@flow-state-dev/workforce": patch
---

A coding task can wait for its pull request to merge before it completes (FIX-2578).

- **harness-manager:** new option `awaitPullRequests` (off by default). When it is on, a task whose run opened a pull request does not complete at its settle. It waits on its pull requests, and each wake reads them through `gh`: all merged completes the task with no new run; none open with some merged completes it and the output notes the closed ones; all closed without merging cancels it with the reason "its pull request was closed without merging"; any still open runs the wake's words as a steer on the same attempt and session, then waits again. A pull request that can't be read never settles the task: it runs the steer, waits again, and adds a status note. A completed run's output gains `pullRequests` (`{ url, number, title, state }[]`, `null` when no wait ran).
- **harness-manager:** `pullRequestWait(row, records?)` and `PULL_REQUEST_EVENT`, from the package root and from `./browser`, read a task's open pull-request wait for a screen: the hold, when it opened, and each pull request's number, link and title. `CLOSED_WITHOUT_MERGING` is the cancel reason.
- **orchestration:** a new row hold kind, `external`, for a running task that waits on something outside the board. It is the system's (`actor: "system"`), never a question: the filer is not told of it, the Inbox does not list it, and `waitsOnUser` is false. It holds the row as a question does (no lease, unclaimable, the waiting turn cannot settle). Open one from the turn holding the claim with `waitExternally(ctx, ledger, { prompt, events })` (`./task-board`) or `ref.awaitExternal(id, wait, { claim })`. A person's line in the task's session answers it, and so does an answer from `"service"`. New readers `waitingOn(row)` (`"user"`, `"system"` or `undefined`), `externalHoldOf(row)` and `isExternalHold(hold)` from `./tasks`. A board whose only open rows wait on an event ends with the reason `waiting-on-an-event`.
- **orchestration:** steers and answers gain the source `"service"`, for words from outside the app, with the sender's handle as `by`. A run reads them quoted as the sender's, never as the user's. The filer's `answerQuestion` on an `external` hold is refused (`wait_is_not_a_question`).
- **workspace:** `readPullRequest({ cwd, number, repository?, host? })` reads a pull request's `state` and `merged`, a fork's included. `pullRequestHead` also returns `state` and `merged`.
- **core:** `writePullRequests` keeps a pull request's `state` current: a sighting's state replaces the stored one. Other fields still fill only when null.
- **workforce:** a message delivered to a task's session whose task waits on an `external` hold answers that wait, as `"service"` from its sender, instead of queueing behind it.

Docs: packages/harness-manager/README.md (settling: a section "Waiting on a pull request" for `awaitPullRequests`, the four outcomes, the unreadable case, `pullRequestWait` in the `./browser` list, the `pullRequests` output field), packages/orchestration/README.md (the `external` hold kind beside questions and confirms, `waitExternally` / `awaitExternal`, `waitingOn`, the `"service"` steer source, the `waiting-on-an-event` reason), packages/workspace/README.md (`readPullRequest`), packages/workforce/README.md (a message to a task waiting on an outside event answers its wait).
