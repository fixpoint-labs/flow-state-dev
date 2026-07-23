---
---

Internal (skills): the spec- and epic-approval gates now trigger on an **approving comment or GitHub Review from a human** on the PR (a `labeled` webhook never wakes the session; a comment or a review submission does), replacing the human-applied `spec approved` / `epic approved` label as the trigger. The orchestrator (`issue-fleet` / `issue-lifecycle`) detects either — offloaded to `scout` — excludes bot accounts and bot-authored comments/reviews, and for a review, requires the reviewer isn't the PR's own author, then applies the label itself as a durable, filterable mirror. Canonical rule lives in `docs/contributing/orchestration.md` → Gates.
