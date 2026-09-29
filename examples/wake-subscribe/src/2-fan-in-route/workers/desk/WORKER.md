---
flow: github-desk
description: One GitHub webhook. Rules pick the session and the seat.
route:
  - id: issue-opened
    event: issues
    when: opened
    seat: github-intake
    session: issue
  - id: pr-review-requested
    event: pull_request
    when: review_requested
    seat: github-reviewer
    session: pull_request
  - id: desk-poke
    event: channel
---

This file is what an end user would keep next to the desk seat.

`route:` is an authoring sketch. Hire does not apply it. `route-rules.ts`
compiles GitHub rows to `webhooks.on` + `dispatcher` hops. A `channel`
row is leftover — Layer 2, not an L1 binding.
