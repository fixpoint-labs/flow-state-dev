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
- **The pieces stay internal.** They are exported from `@flow-state-dev/client/internal`, which
  `@flow-state-dev/react` imports and the README does not document. Two public ways to follow a
  session is the second artifact epic ER-4 rules out.
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
- **Computed once, in `followSession`.** `onConnection` reports the state; `onLapsed` fires on
  entering `lapsed`, or `stopped` after `live`, which is today's meaning, so `useSession`'s
  `childSessionsStale` and the feed agree on when a stream stopped vouching. A stop reads
  `stopped`, not `lapsed`, because it is final.
- **The one vocabulary.** `SessionConnectionState` is exported from the client root. FIX-2373's
  banner reads it, and FIX-2367's delivery hook uses it rather than a set of its own.
- **A stream refused before it named anything** reads `stopped` with the history loaded: the
  server has no stream, and the items are what one read saw.

## Decided, not asked

- **E1 · `sessionFeed(client, sessionId, options?)`**, the issue's signature. Options: `itemTypes`,
  `includeTransient` (default false, as `useSession`).
- **E2 · `getSnapshot()` + `subscribe(listener)`.** Each change makes a new frozen snapshot
  object `{ items, runs, state, error }`. That is the shape React's `useSyncExternalStore` reads,
  which Shift Manager's adoption and a later `useSessionFeed` need; a plain listener works for
  the labs. `runs` is `null` until the stream names any.
- **E3 · One feed, one connection.** No per-client cache of feeds: an app that shares one feed
  between views shares the object, and two feeds (or a feed beside `useSession({ live: true })`)
  on one session cost two reads and two streams. The README says so. Teammates' cache stays an
  app choice.
- **E4 · A failed history read backs off, and gives up.** `readSessionHistory` restarts at most 5
  times when the history moves, then throws, as `useSession` does today; it never retries a
  failed request. The feed retries a thrown read after 2, 4, 8 and 16 seconds, with `error`
  carrying the failure, then reads `stopped` with that error. A fixed retry against a host that
  is down is the steady poll FIX-2367 ER-3 forbids.
- **E5 · `followResponse` keeps every item the filter passes**, not Teammates' three types. The
  merge rule already stops a partial copy replacing a finished one.
- **E6 · No user-stream session-list notices.** The issue mentions them for the labs; epic D2
  routes list changes through FIX-2367's `client.subscribe`.
- **E7 · Changeset:** a `minor` for `@flow-state-dev/client` (new public exports). React's change
  is internal.

- **E9 · FIX-2408 owns the public history read** (EM call, epic seam). `readSessionHistory`
  stays internal. Once FIX-2408's tail read lands, `sessionFeed` starts from it, since its window
  carries `at` and `sessionCreatedAt`, rather than reading from offset 0. Whichever of the two
  merges second makes the switch: in FIX-2408's PR if this merges first, or as a follow-up commit
  here if FIX-2408 lands first.
- **E8 · Page size stays 100**, `useSession`'s. Teammates reads 500 a page today; its adoption
  PR takes the default unless a measured read says otherwise.

## How it got here

- Drafted 2026-10-31 from the epic spec (FIX-2369, #4358) and the code on `main` at `675f614`,
  with the build prototyped beside it on the implementation branch.

## Notes from review

- **Round 1** (FSD Architect; Cursor approved; Codex no findings on `b354e3a`). Folded: the pieces
  go behind an internal subpath (D1); the states are computed once in `followSession` and are the
  client's one vocabulary (D2); the history handoff is one `after` value; E4 backs off and gives
  up; this issue owns the `followSession` lift; the Teammates debt row says what it actually has.
  Kept: a client unit test file and one real-host test, each with its control produced in the
  build PR, because ER-6 asks every check to show its control failing.
