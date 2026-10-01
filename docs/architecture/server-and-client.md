# Server and Client

Setup, the route table, the client APIs and the React hooks are user-facing: [Engine setup](../../apps/docs/docs/server/setup.md), [Engine API](../../apps/docs/docs/api/server.md), [Client](../../apps/docs/docs/client/overview.md), [React Integration](../../apps/docs/docs/client/react.md), [Dispatched work](../../apps/docs/docs/server/background-work.md). Package boundaries are in [Overview](./overview.md#package-boundaries). This page holds the contracts that span them.

## Routing by instance

- The HTTP route table is produced by the built-in HTTP adapter that `createFlowApiRouter` mounts on an `InboundTransportHost`; other transports mount beside it ([Inbound Transports](./inbound-transports.md)).
- `:flowId` (also spelled `:flowKind` historically) is the **instance id**. Every session and request records its owner `flowId` beside the definition's `flowKind`; every projection of a session or request includes `flowId` (`GET /api/flows` entries also carry `cardinality`).
- **Routes naming a flow and a record check that they agree before the resolver runs**: `409 wrong-instance-session` / `wrong-instance-request`, or `409 migration-required` for an ownerless record under a collection kind.
- **Routes naming only a record resolve the governing flow from the record's owner.** That flow's resolver authorises the read and decides the anonymous-listing filter. Retry, continue, resume and interrupted recovery re-enter the recorded owner. Clients address by instance id and re-enter via the `flowId` on records they hold.
- POST returns `202` immediately; execution is async. A client may pre-generate `requestId`. The action's `result` (`output` and/or `error`) is written in the same write as the final status; `GET /sessions/:id/requests` includes `result.output` only with `include_result_output=true` (`hasOutput` on every entry). Missing `result` means unfinished, aborted/interrupted, or legacy (BP-030).

## Session retention

`session.retention` (`maxItems`, `maxAge`) evicts whole completed requests, lazily after each completed request. The current request and failed requests are never evicted.

**A request is evicted only after its run has finished and twice the live-tail liveness timeout has passed** (`LIVE_TAIL_LIVENESS_MS`, 30 s → 60 s). Its record turns terminal before the run finishes writing, and a live stream may still be following it, so evicting earlier frees a caller-supplied id while either is active ([Streaming](./streaming.md#event-lifetime-is-bounded-by-the-requests-security)).

- "Finished" is the record's **`finalizedAtMs`**, the run's last write, after `onFinished` and the side-chain work its hooks queued. Retention waits for the mark, not a duration, because `onFinished` has no time limit and another process's run is invisible here. The mark is **fenced on `incarnation`**, so it never lands on a request that took the id since.
- A `suspended` request never finishes a run and is never evicted.
- **Overlapping runs** of one request (a `/continue` after the sweep wrongly judged a slow run dead): only the last to end in this process marks the record and removes the shared registry entry. A run in another process is judged by its heartbeat.
- A run that died before marking, whose late writes didn't flush, or whose mark was refused three times is marked by the stale-request sweep, **only if it was heartbeating through its tail**. With heartbeats off (`request.heartbeatIntervalMs: 0`) a stale entry proves nothing, so the record is marked only by its own run and kept for good if that run is gone. With the sweep disabled, likewise kept.
- **Rollout safety:** a record with no `finalizedAtMs` field was written by a version that never marks, and its run may still be finishing on an old instance. It's kept until the larger of the stale threshold (60 s or the host's `staleSweepThresholdMs`) and `maxAge`, plus the window, has passed since completion. A spared request is evicted at the session's next completed request, so a session can sit above its limits until then, and its items still count toward `maxItems` (so older history goes first).

Items that should never be stored should be `transient: true`, not left to retention.

## Child sessions (background work)

`listChildSessions(parentId)` returns `ChildSessionSummary` rows; a row's own history is `listSessionRequests(row.id)`. Whether work runs in a child is the flow author's choice; a client can't request it.

- **`status`** is its own union, `"active" | "completed" | "incomplete" | "failed" | "aborted"`, **absent** before the child has run anything. `"active"` means *not finished* and nothing more (not running vs queued vs waiting on a person), and it's the last recorded state, not a liveness check. `RequestStatus`'s run states collapse into it; reusing that union would hand consumers exhaustive-switch branches that can't fire. A finer breakdown will arrive as a separate optional field, never as new members.
- **`topic` / `coordinate`** are display labels only: they route, authorise and identify nothing.
- Consumers `== null`-guard every optional field (BP-030).
- The client's only filtering is compatibility: a row whose `parentSessionId` doesn't match is dropped. Authorization is the server's, from the stored parent record (BP-031).

### `useSession().childSessions`

A second axis beside `items`, re-exporting the client's row type; nothing merges into `items`.

- **Interaction-scoped, no polling.** Read on mount, at the **start** of every work-starting call (`sendAction`, `resumeLatestRequest`, `resumeSuspension`, `continueRequest`), and by `refresh()`. The launching turn's stream closes when the turn ends while the work outlives it, so the read is anchored to a local fact (this hook dispatched the interaction) that no board option, dropped connection or `items: false` can remove. Cost: one read per turn.
- With `live: true` it also re-reads on the session stream's run-changed notice and keeps unfinished runs the page lacks, so an old unfinished run still shows.
- **Two guards for two hazards.** A *generation* advances when the read identity changes (session id, or the session client, rebuilt on `baseUrl` change) and retires superseded responses. A per-read *sequence* orders reads within one identity (mount, action-start and `refresh()` can be in flight together), so an older response can't overwrite newer rows or regress a terminal row to `active`.
- A failed re-read keeps the last rows and raises `childSessionsStale` until the next success. Status renders as received; the package doesn't enumerate `ChildSessionStatus`, so a new value needs no change here.
- `isFinishing` is true when the main chain is done but `.sideChain()` work still runs; block input on `isStreaming && !isFinishing`.
