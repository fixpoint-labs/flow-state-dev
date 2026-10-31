# FIX-2374 · Decisions

[Spec](SPEC.md) · **Decisions**

<a name="d1"></a>
## D1 · `useSession` rebases on the feed's pieces, not on the feed object

The issue says "rebase useSession on it". There are two readings.

| | Pieces move down; both build on them (chosen) | `useSession` holds a `sessionFeed` and reads from it |
|---|---|---|
| One implementation of follow, history read and merge rule | yes | yes |
| `useSession`'s join (optimistic user message, stop records, state and resource merges, the snapshot sequence guard) | stays where it is, untouched | moves into the feed, or is rebuilt on top of its output |
| Risk to every React app | low: three functions move, tests unchanged | high: a 2,200-line hook's join is rewritten |
| What the feed carries | only what a non-chat app needs | every chat rule, for apps that don't want them |

- **Because:** the duplicated part, the reason the labs wrote their own, is the follow, the paged
  read and the merge rule. `useSession`'s join exists for a chat view's own sends; a feed with no
  composer has none of it.
- **Locks in:** two consumers of the pieces instead of one. FIX-2410 (a state-only re-read in
  `useSession`) builds on `useSession` as it stands, which is why it stacks on this.
- **What would change it:** a second React hook that wants a non-chat feed. Then a thin
  `useSessionFeed` over `sessionFeed` is the move, not a rewrite of `useSession`.

<a name="d2"></a>
## D2 · Five states, one meaning each

`state` is `connecting | live | reconnecting | lapsed | stopped`.

| State | Means | Comes from |
|---|---|---|
| `connecting` | Not yet live: the history is being read, or the stream hasn't named the runs | start; a history read that failed and is retried |
| `live` | The current connection named the runs: items and runs are current | `onRuns` |
| `reconnecting` | The connection closed and the first retry is coming (an ordinary close, such as the server's own after 15 minutes) | `onReconnecting` attempt 1, after `live` |
| `lapsed` | A retry has failed: what the feed last said may be out of date | `onReconnecting` attempt 2+, after `live` |
| `stopped` | It will not come back: refused, the session gone, or `close()` | `onStop`, `close()` |

- **`connecting` is added** to the issue's four. A feed that has read nothing yet is neither
  live nor lapsed, and a banner (FIX-2373) must not say "reconnecting" on first load.
- **Lapsed matches `followSession`'s existing `onLapsed`** (attempt 2, or a stop after the runs
  were named), so `useSession`'s `childSessionsStale` and the feed agree on when a stream stopped
  vouching. A stop is reported as `stopped`, not `lapsed`, because it is final.
- **A stream refused before it named anything** reads `stopped` with the history loaded: the
  server has no stream, and the items are what one read saw.

## Decided, not asked

- **E1 · `sessionFeed(client, sessionId, options?)`**, the issue's signature. Options: `itemTypes`,
  `includeTransient` (default false, as `useSession`).
- **E2 · `getSnapshot()` + `subscribe(listener)`.** Each change makes a new frozen snapshot
  object `{ items, runs, state, error }`, so React's `useSyncExternalStore` can read it directly
  later. `runs` is `null` until the stream names any.
- **E3 · One feed, one connection.** No per-client cache of feeds: an app that shares one feed
  between views shares the object. Teammates' cache stays an app choice.
- **E4 · A failed history read retries every 2 seconds** while the feed is open, and `error`
  carries the last failure until a read lands, as Teammates does now.
- **E5 · `followResponse` keeps every item the filter passes**, not Teammates' three types. The
  merge rule already stops a partial copy replacing a finished one.
- **E6 · No user-stream session-list notices.** The issue mentions them for the labs; epic D2
  routes list changes through FIX-2367's `client.subscribe`.
- **E7 · Changeset:** a `minor` for `@flow-state-dev/client` (new public exports). React's change
  is internal.

## How it got here

- Drafted 2026-10-31 from the epic spec (FIX-2369, #4358) and the code on `main` at `675f614`.
