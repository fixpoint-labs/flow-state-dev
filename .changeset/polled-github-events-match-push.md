---
"@flow-state-dev/workforce": patch
---

A polled GitHub event now comes closer to a webhook delivery of it (FIX-2647, FIX-2648).

- **workforce:** `maxOwnerRuns` limits polled events too. Before, a poll sent one event to every subscription whose screens passed it, with no cap. The cap counts ordinary and unmatched subscriptions together, as on push. A poll runs once per user for each PR or repository followed, so on a poll the cap applies to one user's subscriptions to that PR or repository; on push it applies to every subscription the event reaches.
- **workforce:** a repository-wide subscription (`github:owner/repo`) with no webhook now hears new pull request reviews and review comments. Before, the repository poll read only issues and issue comments.

Docs: none; both match what the webhook path already does and the docs already describe.
