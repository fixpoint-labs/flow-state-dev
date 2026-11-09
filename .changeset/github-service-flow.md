---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/workforce": minor
"@flow-state-dev/harness-manager": minor
"@flow-state-dev/workspace": patch
---

A coding task that opens a GitHub pull request hears each review, comment and CI result on it once, through a signed webhook, from `service:github` (FIX-2535).

- **workforce:** `githubServiceFlow({ provider, installation, trustedBots, agentHandles })` is GitHub's service flow, with the webhook route declared. `githubSubscriptionProvider({ token })` answers who can read a repository and who the user is on GitHub, on the user's own token. `followPullRequest({ providers })` subscribes a coding session to each pull request it records, hearing its reviews, comments and CI until it merges or closes. `normalizeGitHubEvent` maps a webhook payload, or a poll's object of the same shape, to normalized events; `defineSubscriptionServiceFlow` takes `normalize` (declares the webhook route) and `maxOwnerRuns` (the most subscriptions one event reaches, 100 by default).
- **core:** a webhook provider entry can be a service route, `webhooks: { <provider>: { service: { entry, normalize } } }`, instead of `on`. `WebhookSubscriptionConfig` is now a union of the two, so code that reads `.on` off it must check for `undefined`. The normalized subscription event gains an optional `addressed: true` when it asks the app's agent. `writePullRequests` takes `onRecorded`, called once per newly recorded pull request; `followRecordedPullRequests(ctx, follower)` hands a request's new pull requests to a `PullRequestFollower`.
- **engine:** the webhook transport routes a service route's events through `routeServiceEvent`, as `service:<provider>`, answering 202 once each owner run is recorded, 503 when one wasn't.
- **harness-manager:** `harnessManager({ onPullRequestRecorded })` hands each pull request a run records to the follower, mid-turn.
- **workspace:** the branch check hands the pull requests it records to the request's follower.

Docs: packages/workforce/README.md (GitHub's service flow, the provider, `followPullRequest`, the webhook mount), packages/core/README.md (the `service` webhook form, `addressed`, `onRecorded`), packages/engine/README.md (the service route in the webhook transport), packages/harness-manager/README.md (`onPullRequestRecorded`), apps/docs/docs/server/webhooks.md (the service route beside bindings), apps/docs/guides/webhooks-github.md (mount the flow; a task follows its pull request; `sessionId` routing for GitHub is gone)
