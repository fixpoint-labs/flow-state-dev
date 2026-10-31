# FIX-2408 · Decisions

[Spec](SPEC.md) · **Decisions**

The issue settles the what: read from `pagination.total`, page backward on demand, show *Load
earlier*, take new items from the feed "or an offset delta". The epic places it in `client` (wave
1, no app file) and leaves the feed to FIX-2374 (ER-4). Two calls are left.

<a name="d1"></a>
## D1 · Every read runs from the window's start to the session's end

| | From the window's start (chosen) | Offset delta past the old end | Delta with a fixed overlap |
|---|---|---|---|
| A reply that finished after a later item was stored | in the next read | **missed until a full reload** | missed when it lands further back than the overlap |
| Items per refresh | the window (200 at first) | only the new ones | new ones plus the overlap |
| Window stays one unbroken run | yes | yes | yes |

- **Because:** the state route orders items by `ts`, then `itemIndex` (`compareItemOrder`). A
  reply is stamped when it starts and stored when it finishes, so a user's next line, sent while
  the reply streams, is stored first and sorts after it. The reply lands *behind* the old end. The
  unit test reproduces it and shows the delta missing it.
- **The cost is bounded and temporary.** A refresh reads what the person has on screen, against
  the Shift Manager's 1,000 every 5 seconds today. FIX-2409 replaces the refresh with change
  notices, and a view on FIX-2374's feed takes new items from the stream and never refreshes.
- **Locks in:** a window is a start position plus "to the end". It never has a hole to fill.

<a name="d2"></a>
## D2 · Three functions over `sessions.state` in `client`

| | Functions over `sessions.state` (chosen) | A route option (`from_end`) | A method on `client.sessions` |
|---|---|---|---|
| Calls for a long session's first read | 2 (one to learn the size) | 1 | 2 |
| Engine change | none | a new query option, documented and tested on every host | none |
| Fits the client's shape | as `readEveryCollectionPage` | — | grows the transport surface with logic |

- **Because:** the issue asks for a client helper, the route already returns the total, and wave 1
  keeps this slice to one package. The second call's server cost is FIX-877's (every request is read
  to answer any page), which a route option would not remove.
- **Paging follows `useSession`.** Each later page starts one item early; when that item is not
  the last one held, or the page is another session's, the read starts over, three times at most,
  then throws. Most reads are one call and never page.
- **Locks in:** no new transport surface. A route option can come later behind the same functions.

## Decided, not asked

- **E1 · `SESSION_WINDOW_PAGE` is 200**, the Shift Manager's page today.
- **E2 · The window keeps its `itemTypes`.** Positions count only those types, so a later read
  with other types would be off by the difference.
- **E3 · A session created again under the id starts the window over** at its end, as
  `useSession` refuses a page from another session.
- **E4 · `readSessionEarlier` at the start returns the same window with no call**, so a stray
  click costs nothing.
- **E5 · `patch` changeset**, as recent additive client exports.
- **E6 · The real-host check lives in `packages/node/test`**, beside `client-own-sessions`: `node`
  already depends on both the engine and the client, and `client` must not depend on the engine.

## How it got here

- Drafted 2026-10-31 with the build prototyped beside it, so each check's control was seen to fail
  before the check is proposed.
