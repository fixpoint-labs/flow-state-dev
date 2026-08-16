---
---

Internal: `@flow-state-dev/conductor` (private, unpublished) — a review-thread comment is no longer discarded because an already-answered conversation comment happened to share its id.

GitHub reports comments on two endpoints that number independently, so one pull request can carry a conversation comment and a review-thread comment with the same numeric id. `github/poll` knows that and namespaces its cursor keys `issue:` / `review:` for exactly this reason. The signal it produced carried the bare id, so the guard that stops a restart re-buying a pass over feedback already handled read the two comments as one: the second was dropped from the queue *and* written into the persisted cursor as seen. Nobody was left holding it, the gate it should have answered still applied, and no stall report fires under a gate that still applies — so the ledger showed a comment answered and the reviewer's actual comment was never dispatched at all. It needed no crash to happen: the guard reads the ledger on every tick.

The stream a comment id was minted in now travels on the signal beside the id, from both the poll path and the webhook path that mirrors it, and identity is the pair — the same namespace the cursor key has always carried. The local observer states its own for the same reason, though it has only one stream to state.

The guarantee this rides on is unchanged: a comment whose reduction and the settled pass it bought are both on disk still buys nothing a second time. A ledger row written before signals carried their stream is read the only way such a row supports — as matching every stream — so an upgrade in place suppresses what it recorded as answered rather than paying for it again.
