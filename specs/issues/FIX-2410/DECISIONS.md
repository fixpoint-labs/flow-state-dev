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
| Cost to apps that don't need it | one small state read on a non-completed end | none | none |

- **Because:** a completed request already gets a full read; leaving failed and stopped ones with
  none is an inconsistency, not a budget. A state-only read is one request with no items.
- **Locks in:** the background-work read stays out of the terminal path, so the pinned
  one-read-per-turn budget in `docs/architecture/server-and-client.md` is unchanged.
- **What would change it:** a host where the state endpoint is costly per call. Then an option.

<a name="d2"></a>
## D2 · `followedRequest` is the request the view shows last

The issue asks for "the followed request's status, not only the latest". After a reload, nothing
is followed, but Kitchen Sink still needs the last turn's status while a steer is newest.

- **Chosen:** the request the newest item on screen belongs to (with `items: false`, the
  request the hook last followed). While its stream runs, the status comes from the stream. When
  it ends, or when it changes, its record is read: from the `latestRequest` read when it is the
  newest, else one `GET .../requests/:id/status`.
- **Shape:** `{ id, status, startedAtMs?, completedAtMs? } | null`, a pick of
  `SessionRequestSummary`, so it drops into code that takes `latestRequest`. The status route
  sets `completedAtMs` for every terminal status.
- **Rejected:** a new session-request-by-id route (engine and client, out of this react slice);
  a bounded list scan, as Kitchen Sink does now (misses a request with more than a page of newer
  ones).

## Decided, not asked

- **E1 · Option name `items`**, as the issue writes it: `refresh({ items: false })`. It matches
  the hook's own `items` option.
- **E2 · A state-only read before the first full read lands** sets state and leaves items
  loading; the mount read then loads items and keeps the newer state (the sequence guard in the spec).
- **E3 · A state-only read never moves the stream's `since`** (`snapshot.at`), which belongs to
  the item history the live follow resumes from.
- **E4 · A stop's state read** is made after the stop is sent, whether or not the server refused
  it.
- **E5 · Kitchen Sink's Flow State page passes `live: true`.** That is the framework's documented
  way to keep background work current between interactions; `BackgroundWorkRefresh` said it was
  waiting for this.
- **E6 · Changeset:** a `minor` for `@flow-state-dev/react` (new option and field). README and the
  `useSession` docs page gain both.

## How it got here

- Drafted 2026-10-31 from the epic spec (FIX-2369, #4358), FIX-2374's spec (branch `spec/FIX-2374`) and
  the code on `main` at `675f614`.
