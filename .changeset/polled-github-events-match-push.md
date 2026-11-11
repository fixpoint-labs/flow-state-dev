---
"@flow-state-dev/workforce": patch
---

A polled GitHub event now reaches the same subscriptions a webhook delivery of it does (FIX-2647, FIX-2648).

- **workforce:** `maxOwnerRuns` limits polled events too. Before, a poll sent one event to every subscription whose screens passed it, past the cap a webhook delivery respects. The cap counts ordinary and unmatched subscriptions together, as on push.
- **workforce:** a repository-wide subscription (`github:owner/repo`) with no webhook now hears new pull request reviews and review comments. Before, the repository poll read only issues and issue comments.

Docs: none; both match what the webhook path already does and the docs already describe.
