---
---

Internal (skills): the spec- and epic-approval gates now trigger on an **approving comment from a human** on the PR (a `labeled` webhook never wakes the session; a comment does), replacing the human-applied `spec approved` / `epic approved` label as the trigger. The orchestrator (`issue-fleet` / `issue-lifecycle`) detects the comment — offloaded to `scout` — excludes bot and bot-authored comments, then applies the label itself as a durable, filterable mirror. The Case-approval gate (draft→ready-for-review promotion) is unchanged. Canonical rule lives in `docs/contributing/orchestration.md` → Gates.
