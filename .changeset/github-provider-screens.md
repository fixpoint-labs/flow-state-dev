---
"@flow-state-dev/workforce": patch
---

`githubSubscriptionProvider` takes `screens`, as the internal-events service flow does: an `interestModel` for the `interest` screen, and the app's `custom` screens. Without an `interestModel`, a GitHub subscription that lists `interest` is still refused with `no_interest_model` (FIX-2779).

`followPullRequest` takes `allow`, the GitHub logins whose reviews, comments and checks reach the following session. Anyone else's never reach it. Use it when the session acts on what it hears.

Docs: packages/workforce/README.md (the `screens` option on `githubSubscriptionProvider`), apps/docs pages that show `githubSubscriptionProvider` options (add `screens`), the `followPullRequest` reference (`allow`).
