# FIX-2408 · Decisions

[Spec](SPEC.md) · **Decisions**

The issue settles the what: read from `pagination.total`, page backward on demand, show *Load
earlier*, take new items from the feed "or an offset delta". The epic places it in `client` (wave
1, no app file) and leaves the feed to FIX-2374 (ER-4). Two calls are left.

<a name="d1"></a>
## D1 · Every read runs from the window's start to the session's end

| | From the window's start (chosen) | Offset delta past the old end | Delta with a fixed overlap |
|---|---|---|---|
| A reply first read while still being written | its finished text in the next read | **stuck on the half it read** | stuck once it is further back than the overlap |
| An item stored behind items already read | in the next read | **missed until a full reload** | missed when further back than the overlap |
| Items per refresh | the window (200 at first) | only the new ones | new ones plus the overlap |

- **Because:** a running request's items are stored while it runs and rewritten in place by id
  (`RequestStore.persistItems`, FIX-811, FIX-1735), and the state route orders items by their
  stamp, then `itemIndex` (`compareItemOrder`). Checked on a real host: a slow request's first
  message sits ahead of a later request's messages. So a reply the window read half-written
  finishes at a position the window already holds, and an item stamped before the newest one but
  stored after it lands behind the old end. The unit tests reproduce both and show the delta
  missing them.
- **The cost is bounded and temporary.** A refresh reads what the person has on screen, against
  the Shift Manager's 1,000 every 5 seconds today. FIX-2409 replaces the refresh with change
  notices, and a view on FIX-2374's feed takes new items from the stream and never refreshes.
- **Locks in:** a window is a start position plus "to the end". It never has a hole to fill.

<a name="d2"></a>
## D2 · Three functions in `client` over FIX-2374's paged read

| | Over `readSessionHistory` with an `offset` (chosen) | A second loop in this module | A route option (`from_end`) |
|---|---|---|---|
| Paging loops in `client` | one | two, kept in step by hand | one, plus server work |
| Calls for a long session's first read | 2 (one to learn the size) | 2 | 1 |
| Engine change | none | none | a new query option on every host |

- **Because:** FIX-2374 moves `useSession`'s loop into `client` as `readSessionHistory`
  (internal). It already handles what a start position needs: a page that shifted, a session
  created again under the id, a bounded number of restarts. A start offset is one option on it.
  The second call's server cost is FIX-877's (every request is read to answer any page), which a
  route option would not remove. *(Folded from the FSD Architect's coherence read, round 1.)*
- **Merge order.** Both are wave-1 slices from `main`. The one that merges second takes the
  other's `session-history.ts`; the epic's EM call is that these functions are the client's one
  public history read and `readSessionHistory` stays internal.
- **Locks in:** no new transport surface. A route option can come later behind the same functions.

## Decided, not asked

- **E1 · `SESSION_WINDOW_PAGE` is 200**, the Shift Manager's page today.
- **E2 · The window keeps its `itemTypes`.** Positions count only those types, so a later read
  with other types would be off by the difference.
- **E3 · A session created again under the id starts the window over** at its end, as
  `readSessionHistory` refuses a page from another session.
- **E4 · `readSessionEarlier` at the start returns the same window with no call**, so a stray
  click costs nothing.
- **E5 · `patch` changeset**, as recent additive client exports.
- **E6 · The real-host check lives in `packages/node/test`**, beside `client-own-sessions`: `node`
  already depends on both the engine and the client, and `client` must not depend on the engine.

## How it got here

- Drafted 2026-10-31 with the build prototyped beside it, so each check's control was seen to fail
  before the check is proposed.

## Notes from review

- FSD Architect, round 1 (417ff27): folded. The window builds on FIX-2374's `readSessionHistory`
  with an `offset`, and the "paging rule in two places" debt is gone. Checked that the window's
  `at` and `sessionCreatedAt` are the `after` that #4360's `followSession` takes.
