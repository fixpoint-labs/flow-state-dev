<!-- Verbatim copy of the Linear project "Realtime / WebSockets" content field, read 2026-11-20 (last edited in Linear 2026-05-04T21:24:01Z) before the project-spec replaced it. Kept so any fold or drop below can be reversed. -->

Bidirectional, persistent transport for FSD as a peer to the existing HTTP/SSE story. The unresolved questions are real — especially serverless — and this project is the place to figure them out before any Realtime claim shows up in the docs.

## Why this is its own project

FSD's current transport story is one-directional from the runtime's perspective: the client POSTs an action and the server streams items back via SSE. That works because SSE is a single long-lived HTTP response, which serverless platforms tolerate (Vercel, Cloudflare, Lambda streaming). It does not extend cleanly to:

* **Server-initiated push to a connected client without a pending request** — proactive notifications, multi-client fan-out within a session, presence
* **Cross-client coordination in a shared session or org scope** — collaborative artifacts, multi-user rooms, multiplayer agents
* **Low-latency bidirectional control** — interrupt/cancel/steer mid-generation from the client without re-establishing a request

These are WebSocket-shaped problems, not SSE-shaped problems. Treating them as a transport variant under the existing inbound adapter contract ([FIX-438](https://linear.app/fixpoint-labs/issue/FIX-438/inbound-transport-adapter-abstraction-parent-design)) is the natural framing — but the implementation surface is different enough to warrant its own project.

## The serverless tension

WebSockets need a persistent connection. Serverless functions don't run persistently. Three paths exist; we need to pick deliberately:

1. **Managed pub/sub services** — Ably, Pusher, Soketi. The client holds a WebSocket to the managed service; FSD serverless functions publish to topics; the service fans out. Cleanest for serverless. [FIX-380](https://linear.app/fixpoint-labs/issue/FIX-380/spike-ably-ai-transport-integration-as-pluggable-websocket-transport) is the existing Ably spike. Vendor lock-in and per-message cost are the tradeoffs.
2. **Platform-native primitives** — AWS API Gateway WebSocket APIs, Cloudflare Durable Objects, Vercel Realtime (if/when it ships). Cheaper at scale; coupled to the platform.
3. **Persistent server tier** — run a small WebSocket server alongside the serverless functions (Node + `ws`, or a Worker that stays warm). Defeats serverless but works for hybrid deployments.

Open question worth answering early: is there a single transport adapter that abstracts across all three, or do we ship one adapter per path and let users choose?

## Relationship to existing work

* **Inbound transport adapter (**[FIX-438](https://linear.app/fixpoint-labs/issue/FIX-438/inbound-transport-adapter-abstraction-parent-design)**, done)** — Realtime is the next adapter in that family. Same `InboundTransportAdapter` contract; different envelope semantics (push vs request/response).
* `ActiveStreamRegistry` ([FIX-404](https://linear.app/fixpoint-labs/issue/FIX-404/activestreamregistry-interface-pubsub-capable-emitter-seam)) — already designed as pub/sub-capable. A WebSocket adapter slots into the same pub/sub seam, so server-initiated messages can target the right connected client across nodes. [FIX-404](https://linear.app/fixpoint-labs/issue/FIX-404/activestreamregistry-interface-pubsub-capable-emitter-seam) is the load-bearing piece this project depends on.
* **SSE outbound (current)** — stays as the default for request/response streaming. Realtime is additive, not a replacement.
* **MCP transport (**[FIX-22](https://linear.app/fixpoint-labs/issue/FIX-22/mcp-server-integration-expose-flows-as-mcp-servers)**)** — separate concern. MCP has its own session/transport model.

## What probably belongs here

* [FIX-380](https://linear.app/fixpoint-labs/issue/FIX-380/spike-ably-ai-transport-integration-as-pluggable-websocket-transport) — Ably AI Transport spike (existing)
* A platform-native variant (AWS API GW or Cloudflare DO) once the Ably spike clarifies the contract
* Client-side WebSocket consumer in `@flow-state-dev/client` and `@flow-state-dev/react`
* Patterns enabled by bidirectional transport: presence, collaborative artifact editing, multi-client session views, agent steering
* Documentation: when to reach for Realtime vs SSE; the serverless decision tree

## Out of scope

* General message bus / event sourcing (covered by `Reactive Flows` cross-flow events)
* MCP server transport (separate)
* Outbound webhooks (separate)

## Open questions

1. Single adapter abstraction across managed/platform/self-hosted, or one adapter per path?
2. Does the contract need to distinguish "ephemeral push" from "session-bound stream"?
3. How do scopes (session/user/org) map to channels/rooms in a Realtime backend?
4. Authentication: how does the principal resolver hook ([FIX-23](https://linear.app/fixpoint-labs/issue/FIX-23/authentication-strategy-principal-resolver-and-auth-hooks)) translate to WebSocket connect-time auth and per-message auth?
5. Backpressure: SSE handles this implicitly (HTTP). WebSocket needs explicit policy.
6. Is the v1 deliberately one path (Ably) until usage justifies more, or do we ship the abstraction first?
