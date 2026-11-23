---
"@flow-state-dev/workforce": patch
---

`githubSubscriptionProvider` takes `screens`, as the internal-events service flow does: an `interestModel` for the `interest` screen, and the app's `custom` screens. Without an `interestModel`, a GitHub subscription that lists `interest` is still refused with `no_interest_model` (FIX-2779).

`followPullRequest` takes `screens`, the screens a follow lists, such as a custom screen the GitHub provider declares. Use it when the session acts on what it hears: `githubTrustedReviewersScreen` lets through only an account on a list the app keeps: a listed bot, or a listed user who can write to the repository.

Docs: packages/workforce/README.md (the `screens` option on `githubSubscriptionProvider`), apps/docs pages that show `githubSubscriptionProvider` options (add `screens`), the `followPullRequest` reference (`screens`).
