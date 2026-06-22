# Dev-orchestrator redesign: choreography over orchestration

Design note for the next shape of the orchestrator (informs FIX-816). Not yet
implemented. Captures *why* the current durable-flow design should be replaced
and *what* to keep when it is.

## Why change

The current orchestrator carries two state machines that encode the same
progression twice:

1. **The Linear board** — `nextAction(state)`, pure, derived from Linear.
2. **A durable FSD flow** — the spec-stage sequencer with two `ctx.suspend()`
   gates, checkpoints, and a resume lease.

Almost every piece of machinery in the driver exists only to keep #2 consistent
with #1 across restarts: `skipDispatch`, the `claudeRemoteTasks` dispatch guard,
checkpoint replay, and the lease/revert dance in `resumeParked`. The cold-restart
resume bug we hit (a restart between gate 1 and gate 2 bounced the request back
to gate 1 forever) is that drift made visible. The board is the real source of
truth; the durable flow is a redundant second ledger that can only agree or
drift.

Two facts drive the redesign:

- **Multiple entry points.** A human can move an issue to any state — e.g.
  straight to `Spec Approved`, or bounce it backward. A single flow with
  sequential gates assumes top-to-bottom entry and cannot model arbitrary jumps.
  The board state must select the action, not an in-process cursor.
- **`claude setup-token`** (a ~1-year subscription token) makes a server
  deployment viable *without* dropping the Claude subscription, so webhook-driven
  triggers are now realistic rather than blocked on local tunneling.

## Model: choreography, not orchestration

Linear (and the humans poking it) own the event stream. So model the orchestrator
as **discrete, idempotent actions, each keyed to a board state, none assuming
what ran before.** A board transition is an *event* that triggers the matching
action. "Jumped to Spec Approved" simply fires the implement action — nothing was
parked in a particular spot to be skipped.

This replaces orchestration (one conductor holds the sequence via `waitForEvent`)
with choreography (independent reactions to external events). Choreography is the
correct model when the event producer is external and uncontrolled, which Linear
is.

## Architecture: one definition, many trigger surfaces

```
flow definition (isomorphic, deps injected — no I/O baked in)
        │  actions: dispatchSpec, dispatchImplement, dispatchReview, recordApproval, …
        │  + a pure  state → action  map (the canonical "flow" view)
        ▼
trigger adapters (thin, pluggable — all invoke the SAME actions)
   ├─ linear-webhook   verify sig → parse issue+newState → map → invoke   (server)
   ├─ chat-sdk         command/message       → map → invoke               (server)
   ├─ poll/reconcile   list trigger-state issues → invoke                 (daemon/CLI)
   │                   (also the backstop for missed/duplicate webhooks)
   └─ cli              `orchestrate spec FIX-123` → invoke one action     (manual)
        ▼
hosts:  standalone server  │  embedded in an existing server  │  local daemon/script
```

The action never knows which surface fired it. That is what makes "define once,
run in CLI or on the web" a packaging detail instead of a redesign — and it maps
directly onto FSD's existing core / server / cli / chat-sdk split.

## Invariants to preserve

These are cheap to honor now and keep the future free:

1. **Actions are pure board-state reactions** — they re-derive everything from
   the board, never from a prior in-process step. No internal cursor, no
   `skipDispatch`. This is also what makes them safe to fire from any surface, in
   any order.
2. **The trigger is an adapter, not part of the action** — parse/verify lives
   outside the action body, so adding a surface is a new adapter, not a rewrite.
3. **The `state → action` map stays a pure function** — tested in isolation,
   consulted by every adapter. It is the single place orchestrator behavior is
   specified.
4. **Webhook + poll backstop** — webhook for latency, poll for completeness; a
   missed or duplicated webhook must not strand an issue. Cheap once actions are
   idempotent.

## What to keep / drop from the current code

**Keep** (usable now, reusable in the reshape):

- The stage machine `nextAction` → becomes the `state → action` map.
- `LinearStatusClient` + the GraphQL transport (board reads/transitions).
- `GitHubSignalClient` (PR / checks signals).
- The `claude --remote` PTY dispatch (`claude-cli-pty` + the instruction
  builder), including the `ANTHROPIC_API_KEY` scrub.
- The completion predicate (`isAtOrPast`) for board/PR completion detection.

**Drop** (durable-flow complexity that earns its keep neither now nor later):

- The durable spec-stage sequencer and its two suspends.
- `runAction` / `continueRequest`, the durability provider, the SQLite store,
  sequencer checkpoints.
- `resumeParked` and the lease/revert handling.
- `skipDispatch` and the `claudeRemoteTasks` in-flight guard — replaced by a
  board-state check.
- The human-gate suspension — becomes "a state the reconciler waits on," i.e. a
  trigger, not a parked `ctx.suspend()`.

## Auth & deployment

- **Local CLI / daemon:** interactive Claude login (subscription).
- **Server:** `claude setup-token` long-lived token (subscription, ~1 yr). All
  dispatch flows through one account's token, so its rate limits and ToS are the
  real scaling ceiling — not anything in the code.

## Open questions

- **Concurrency:** bounded (max N in-flight, like the open-PR capacity idea in the
  `plan-dispatch` skill) vs fire-and-forget on everything ready.
- **Dispatch double-fire window:** move the board to the in-progress state as part
  of dispatching (so the next observation sees "in flight" from the board), or
  keep a small dispatch record. The board-move approach removes the last bit of
  internal state.
- **Webhook security:** Linear webhook signature verification — build the seam
  into the webhook adapter from day one, treat the body as untrusted.
- **Action granularity:** each action as an FSD action (items log, `runOnce`
  idempotency, server routing for free) vs a plain function. Leaning FSD action
  for the idempotency + routing, *without* the durable sequencer wrapping it.

## Sequencing

The full reshape depends on the **webhook inbound transport** (currently in spec).
Gate the reshape behind that. Interim step that does not wait on webhooks:
simplify the current orchestrator down to the *Keep* list plus a poll/reconcile
loop, which delivers the multi-issue poller (the immediately useful tool) and
extracts exactly the kernel the reshape reuses.
