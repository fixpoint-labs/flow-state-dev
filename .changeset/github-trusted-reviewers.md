---
"@flow-state-dev/workforce": patch
---

`githubTrustedReviewersScreen` is a custom screen for the GitHub provider that passes an event only when its sender is on a list the app keeps and can write to the event's repository (FIX-2789).

- **workforce:** the list is read for each event through `reviewers(ctx)`, so an edit applies to the next comment with no restart. `githubLoginsListed(document)` reads the logins a Markdown list names, one per item (`- octocat`, `* @octocat`).
- **workforce:** write access is asked of GitHub when the event arrives (`admin`, `maintain` and `write` pass). A sender GitHub doesn't know as a collaborator is refused. The token is asked for with the subscription being screened (`token(ctx, entry)`, its owner in `entry.userId`), so an app lends its token only to the subscriptions it chooses; routing runs as the service, not the subscriber. When GitHub can't be asked (no token, a failed call), the screen throws, which refuses the event as `custom:<name>: failed`.
- **workforce:** a custom screen's `resources` are declared on the routing steps and on delivery, so a screen that reads a document reads it at both.
- **workforce:** `isUserTurn(ctx)` is exported: whether the running request is a turn a user's own message started, the mark standing rules already check. An app tool that must act only on the user's own word checks it.

Docs: packages/workforce/README.md (Subscriptions: `githubTrustedReviewersScreen` and `followPullRequest`'s `screens`; `isUserTurn`), apps/docs pages that show `followPullRequest`.
