---
flow: pr-reviewer
description: Review one pull request. Subscribe this session to that PR.
subscribe:
  provider: github
  events:
    - pull_request
    - issue_comment
  resource: session
autoSubscribe: on-review-started
---

This seat watches the pull request the session opened.

`subscribe` / `autoSubscribe` are authoring sketches. Hire does not apply
them. They do not become `flow.webhooks`. A delivery matches only if this
session already subscribed — that table is fictional (see `subscribe.ts`).
