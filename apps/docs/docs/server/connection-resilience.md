---
sidebar_position: 7
---

# Connection Resilience

SSE connections are fragile. Network blips, tab backgrounds, server restarts, and proxy idle timeouts all drop streams that the client and server both expected to keep open. Without defenses in place, a dropped stream leaves a request silently running on the server while the chat UI spins forever.

Connection resilience is the framework's coordinated answer. Heartbeats keep healthy streams alive, a watchdog detects dead ones, a server-side sweeper releases locks for requests whose executor went away, and a read-only status endpoint lets the client recover from a dead stream without reloading the page. None of this requires you to write recovery code — but each layer has a knob you may want to tune.

## How the layers fit together

```
Server:                                Client:
┌──────────────────────┐               ┌─────────────────────────┐
│ Wire-level heartbeat │ : ping ─────▶ │ SSE parser → onHeartbeat │
│ (every SSE response) │               │  → bumps lastEventAtRef  │
└──────────────────────┘               └─────────────────────────┘
┌──────────────────────┐               ┌─────────────────────────┐
│ Stale-request sweep  │               │ Watchdog (setInterval)  │
│ (every 30s, marks    │               │ flips session.isStuck   │
│  in_progress →       │               │ when gap > threshold    │
│  interrupted)        │               └─────────────────────────┘
└──────────────────────┘
```

1. **Wire heartbeat.** `@flow-state-dev/engine` injects `: ping\n\n` comment frames into every live and GET-attach SSE response at a configurable cadence. NAT and proxy idle timeouts stop closing the connection, and clients get a wire-level signal that the server is still alive.
2. **Stale-request sweeper.** A periodic in-process job that reads the active request registry. If any entry's executor heartbeat has stopped past the threshold, it marks the persisted record `interrupted` so session locks release.
3. **Client watchdog.** `useSession` tracks the most recent SSE event or heartbeat. When the gap exceeds the configured threshold while a request is in flight, it flips `session.isStuck` so the host can render a dismiss affordance.
4. **Read-only status endpoint.** `GET /api/flows/:flowKind/requests/:requestId/status` returns a `RequestStatusSnapshot`. The client uses it during dismiss to confirm the actual server state when no SSE is connected.

## Configuration

The defaults work for typical Vercel/Next.js deployments — every knob is optional.

```ts title="lib/flowstate.ts"
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";

export const flowstate = createFlowState({
  flows: { chat: chatFlow },
  stores: { default: { primary: inMemoryStores() } },
  // Wire heartbeat cadence applied to every live and GET-attach SSE
  // response. Default 15_000 ms.
  defaultSseHeartbeatMs: 15_000,
  // Internal sweeper cadence. 0 disables. Default 30_000 ms.
  staleSweepIntervalMs: 30_000,
  // Heartbeat-age threshold. Should be ≥ 2× the executor's
  // registry heartbeat (default 10s). Default 60_000 ms.
  staleSweepThresholdMs: 60_000,
  // How long a queued job may wait for a worker. Default 600_000 ms.
  queuedGraceMs: 600_000
});
```

### Queued jobs and `queuedGraceMs`

If you run actions through a background queue instead of in-process, a request is accepted and recorded before any worker picks it up. Nothing is executing it yet, so it has no executor heartbeat — and `staleSweepThresholdMs` measures heartbeat age, which for a queued job would only be measuring how long the queue has been busy.

`queuedGraceMs` is the separate answer for those: how long a job may sit unclaimed before the sweeper decides the queue lost it. It defaults to 10 minutes and applies to every sweep — the periodic one, the pass on server startup, and the on-demand `check-interrupted` call.

Raise it if your worst-case backlog can run longer than 10 minutes. Set too low, a valid job is marked `interrupted` while the queue is still holding it, and recovery can re-dispatch work that later runs anyway. The two knobs are deliberately independent: tightening your heartbeat should not silently shorten how long a queue is allowed to be backed up.

Per-flow overrides win over the host default:

```ts
defineFlow({
  kind: "chat",
  request: {
    sseHeartbeatMs: 10_000
  },
  actions: { /* ... */ }
});
```

## What you need to render

The client ships a watchdog and a `dismissRequest()` method on `useSession`. The host application renders the dismiss UI. A minimal banner:

```tsx
import { useSession } from "@flow-state-dev/react";

function ConnectionBanner({ session }: { session: ReturnType<typeof useSession> }) {
  if (!session.isStuck) return null;
  return (
    <div role="alert">
      <span>Connection lost.</span>
      <button onClick={() => session.dismissRequest()}>Dismiss</button>
    </div>
  );
}
```

`dismissRequest()` works without a live SSE connection. It posts the abort, closes any local stream handle, injects a synthetic `status` item so the user sees a record of the prior request being stopped, and refreshes the latest server snapshot.

A user-triggered `sendAction()` while `isStuck` is true auto-dismisses the prior request before opening the new stream, so the chat keeps moving without an extra click.

## Tuning the threshold

The client-side watchdog default is `stuckThresholdMs: 30_000` — twice the server's default 15 s wire heartbeat. The general rule is **≥ 2× the server's heartbeat**: a healthy stream produces one heartbeat per cadence, so two missed heartbeats give the watchdog a high-confidence signal without firing on a single slow tick.

```tsx
const session = useSession(sessionId, { stuckThresholdMs: 30_000 });
```

If you raise `defaultSseHeartbeatMs` on the server, raise `stuckThresholdMs` on the client to match.

## What this does *not* do

- **Resume from where the request left off.** A dismissed request is terminal. Re-running uses the existing retry path (`session.resumeLatestRequest()` for `interrupted` and `failed` records).
- **Auto-dismiss on the user's behalf.** The watchdog surfaces the affordance; the user clicks Dismiss (or starts a new action). Auto-dismissing a request the user might still be hoping for would be more frustrating than helpful.
- **Diagnose why the SSE dropped.** That's a deployment-level concern, not a framework one.
