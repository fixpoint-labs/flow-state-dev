# FIX-2410 · Decisions

[Spec](SPEC.md) · **Decisions**

<a name="d1"></a>
## D1 · The hook settles state at every request end, rather than apps calling a cheap refresh

The issue offers a targeted re-read *or* a terminal-refresh option. Kitchen Sink's turn-end
effect exists because a turn that fails or is stopped gets no read from the hook at all.

| | Hook reads state at every end (chosen) | Apps call `refresh({ items: false })` at turn end | `refreshOnTerminal` option |
|---|---|---|---|
| Kitchen Sink's turn-end effect | deleted | kept, cheaper | deleted, option passed |
| Every app's state after a failed or stopped request | current | stale unless it copies the effect | stale unless it opts in |
| Cost to apps that don't need it | one small state read on a non-completed end (and one fewer full read when such an end changed resources) | none | none |

- **Because:** a completed request already gets a full read; leaving failed and stopped ones with
  none is an inconsistency, not a budget. A state-only read is one request with no items.
- **Locks in:** the background-work read stays out of the terminal path, so the pinned
  one-read-per-turn budget in `docs/architecture/server-and-client.md` is unchanged.
- **Why `completed` keeps the full read:** the view's own stream can run ahead of what the
  server has kept, and the closing snapshot is what settles those items (`applySnapshot`'s
  live-copy rule). Dropping it is FIX-2408's question, with tail-first reads.
- **What would change it:** a host where the state endpoint is costly per call. Then an option.

<a name="d2"></a>
## D2 · `followedRequest` is the request the newest item belongs to

The issue asks for "the followed request's status, not only the latest". After a reload, nothing
is followed, but Kitchen Sink still needs the last turn's status while a steer is newest.

- **One rule:** the request the newest item in `items` belongs to. A steer adds no items, so it
  never takes the place. With `items: false` the field is `null`: such a view shows no request.
  On reload, the newest item names the request before any stream attaches, and its record is read
  once.
- **Sources:** while its stream runs, the stream's status. When it ends, the record: from the
  `latestRequest` read the hook already makes when it is the newest request, else one
  `GET .../requests/:id/status`, made after that read lands, so a plain turn costs no extra read.
- **Shape:** `{ id, status, startedAtMs?, completedAtMs?, failedAtMs? } | null`, a pick of
  `SessionRequestSummary`, so it drops into code that takes `latestRequest`.
- **Why the hook and not the page:** is `status` needed beyond running or not? Yes: the turn
  notice and "worked for" read `completed`, `failed` or `interrupted` and the end time, which the
  turn record doesn't carry (a turn that completed has no record field for it). The page could
  call `flow.request(turnId).status()` itself, but that is the per-app request poll this issue
  removes; every chat view with a side request (a steer, a queued turn) needs the same read.
- **Rejected:** a new session-request-by-id route (engine and client, out of this react slice);
  a bounded list scan, as Kitchen Sink does now (misses a request with more than a page of newer
  ones); "the stream's target" (none after a reload, and a followed queued line would hide the
  turn's end).

## Decided, not asked

- **E1 · Option name `items`**, as the issue writes it: `refresh({ items: false })`. It matches
  the hook's own `items` option.
- **E2 · A state-only read before the first full read lands** is dropped: there is no snapshot to
  merge into yet, and the mount read brings state.
- **E3 · A state-only read never moves the stream's `since`** (`snapshot.at`), which belongs to
  the item history the live follow resumes from.
- **E4 · A stop's state read** is made after the stop is sent, whether or not the server refused
  it.
- **E5 · Kitchen Sink's Flow State page passes `live: true`.** That is the framework's documented
  way to keep background work current between interactions; `BackgroundWorkRefresh` said it was
  waiting for this.
- **E6 · Changesets:** a `minor` for `@flow-state-dev/react` (new option and field), a `patch` for
  `@flow-state-dev/engine` (the status route's end time). README and the `useSession` docs pages
  gain both.
- **E7 · Review round 1** (Jake's review, Cursor, Codex): split `applySnapshot` rather than add a
  parallel counter; D2 to one rule and justified; the "After" column says the history read
  remains once per completed turn; non-completed ends with resource changes go state-only; the
  failed-turn end time; a live change during an in-flight read; a real-host check.

## How it got here

- Drafted 2026-10-31 from the epic spec (FIX-2369, #4358), FIX-2374's spec (branch `spec/FIX-2374`) and
  the code on `main` at `675f614`.
