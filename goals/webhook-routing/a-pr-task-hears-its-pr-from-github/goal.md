# webhook-routing › it a PR task hears its PR from GitHub

**Issue:** FIX-2535 (epic FIX-2471)
**Outcome:** A coding task that opens a GitHub pull request hears each review, comment and CI result on it once, through a signed webhook, from `service:github`, with no `sessionId` on the path. It follows the pull request from the moment its record of opening it is written, so CI that completes during the opening turn is heard. A merge ends it. Each event is named so a poll names it the same way.
**Input:** `fixtures/deliveries.json`, written by `fixtures/make.mts` from real GitHub payloads (`@octokit/webhooks-examples` 7.6.1), rewritten to one repository (`acme/api`) and one pull request (#412): a completed check run by `github-actions` (posted during the opening turn), a member's review, a collaborator's line comment, a listed bot's comment (`codex[bot]`), an outsider's comment, the subscriber's own comment, two review requests in one second, the merge, and a comment after it; and the API forms a poll rebuilds the two review requests from (the timeline's `review_requested` events, read when the pull request's own `updated_at` has moved on). Two sessions: alice's coding task, which opens #412 in its turn, and bob's watcher on the whole repository. Held-out: the expected sets come from an oracle in `run.mts` that restates the spec's object, version and sender rules over the fixture and imports no normalize or screen code, so a different valid fixture must still pass a correct implementation.
**Signal:** All of them, on one run:
- **(a)** the task's stored messages from `service:github` equal the oracle's set (the check, the review, the line comment, the bot's comment), each `delivered`;
- **(b)** the check that completed during the opening turn is in the task's messages before any redelivery;
- **(c)** 0 sessions made from an event (every session is a worker's, the service's routing session, or a subscription's owner-run session);
- **(d)** redelivering every delivery, and routing the poll's form, adds no message; a forged signature answers 401;
- **(e)** a fan-out the host stopped partway (bob's owner run failed to record) answers 503, and after its redelivery each of the two sessions holds that review once;
- **(f)** nothing on #412 after the merge: the task's subscription ended `thread_closed`, the late comment never reaches it, and the watcher on the repository still hears it;
- **(g)** a review request's webhook form and its API form name one object at one version; the two requests made in one second both land, and the watcher's messages equal the oracle's;
- **(h)** 0 model calls.

**Anti-game:** a hollow pass would count `routeServiceEvent` calls, owner runs fired, or subscribe calls. The check reads stored message-log entries and subscriptions only, and every delivery goes through the real HTTP route with GitHub's real signature check (`githubWebhookVerifier`), so a delivery that never landed, or landed twice, shows. The coding turn is the seam a coding task's harness step uses (`followRecordedPullRequests` registered before the harness runs, the recorder reading a `gh pr create` tool call as it settles); harness-manager's own wiring of it is covered by `packages/harness-manager/test/branch-pull-requests.spec.ts`. Each graded list is floored with `tell.over`. GitHub's API (`canRead`, `self`) is a stub: it is the one true third party.
**Model:** n/a (model-free: no generator or evaluator is on this path, and (h) asserts it)
**Run:** `pnpm tsx goals/webhook-routing/a-pr-task-hears-its-pr-from-github/run.mts`
**Controls:**
- `GOAL_CONTROL=session-id` routes GitHub through today's binding with `sessionId: pr-<n>`. Must FAIL **(a)**: the task hears nothing. (c) fails with it (`pr-412` is a session made from an event), and every leg that reads a delivery.
- `GOAL_CONTROL=version-from-delivery` versions each object by the delivery's arrival. Must FAIL **(d)** and **(g)**; (a) with them (every redelivery is a new message).
- `GOAL_CONTROL=subscribe-at-turn-end` subscribes when the turn ends, not when the record is written. Must FAIL **(b)**, and (a) with it (the check is missing).

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-09 | 00743e5d3 + goal | n/a | PASS | The task heard 4 of 10 deliveries, the check during its turn among them; the watcher 8; 10 redeliveries and the poll's 2 forms added nothing; the crashed fan-out answered 503, then one message each; 0 sessions from events; 0 model calls. |
| 2026-11-09 | 00743e5d3 + goal | n/a | FAIL (expected) | `GOAL_CONTROL=session-id`: (a) 0 of 4; (b); (c) `pr-412`; (e), (f), (g) read nothing. |
| 2026-11-09 | 00743e5d3 + goal | n/a | FAIL (expected) | `GOAL_CONTROL=version-from-delivery`: (a) 5 messages, every version an arrival time; (b); (d) 10 messages added for bob by redelivery; (g) both API forms name versions no webhook event names, the watcher holds 6 review requests for 2. |
| 2026-11-09 | 00743e5d3 + goal | n/a | FAIL (expected) | `GOAL_CONTROL=subscribe-at-turn-end`: (a) 3 of 4, the check missing; (b) the check during the opening turn was never heard. Nothing else. |
| 2026-11-13 | `claude/fix-2627-impl-e-b4`, before merging `-e` at `4e8aeba6e` | n/a | PASS | `PASS — the task heard 4 of 10 deliveries (the check during its turn among them), the watcher 8; 10 redeliveries and the poll's form added nothing; 0 sessions from events; 0 model calls` |
| 2026-11-13 | `claude/fix-2627-impl-e-b4`, before merging `-e` at `4e8aeba6e` | n/a | FAIL (expected) | `GOAL_CONTROL=session-id`: (a) `the task has 0 message(s) for 4 expected`; (b); (c) `a session was made from an event: pr-412`; (e), (f), (g). |
| 2026-11-13 | `claude/fix-2627-impl-e-b4`, before merging `-e` at `4e8aeba6e` | n/a | FAIL (expected) | `GOAL_CONTROL=version-from-delivery`: (a) 5 messages for 4; (b); (d) `redelivering every delivery (and the poll's form) added 10 message(s) for bob`; (g) the watcher holds 6 review requests of 2. (e) red too, the same on `-e`'s unconverted copy. |
| 2026-11-13 | `claude/fix-2627-impl-e-b4`, `4e8aeba6e` unconverted copy | n/a | FAIL (expected) | `GOAL_CONTROL=version-from-delivery`: (a), (b), (d), (e) `alice's session has 0 message(s) of the review whose fan-out crashed`, (g): the same set as the converted run. |
| 2026-11-13 | `claude/fix-2627-impl-e-b4`, before merging `-e` at `4e8aeba6e` | n/a | FAIL (expected) | `GOAL_CONTROL=subscribe-at-turn-end`: (a) `the task has 3 message(s) for 4 expected (missing check_run:9101@1793872805000; extra none)`; (b) `the check that completed during the opening turn (check_run:9101@1793872805000) was never heard`. Nothing else. |
| 2026-11-13 | `claude/fix-2627-impl-e-b4`, on the merge of `-e` at `4e8aeba6e` | n/a | PASS | `PASS — the task heard 4 of 10 deliveries (the check during its turn among them), the watcher 8; 10 redeliveries and the poll's form added nothing; 0 sessions from events; 0 model calls` |
