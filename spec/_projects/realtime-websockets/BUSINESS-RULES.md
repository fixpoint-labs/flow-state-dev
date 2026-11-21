# Rules — Realtime / WebSockets

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md)

What every epic under this project obeys. Each rule has exactly one owner: the epic that
implements and proves it. Every other epic inherits it, the serverless lane first.

| | Rule | Owner | Checked where |
|---|---|---|---|
| **PR-1** | When a client subscribes to a topic, or reconnects, then the server checks the caller's trusted identity with the check the scope's read route already uses, on every connect, never a claim the client sends | FIX-2367 | FIX-2368's leg c; each new adapter's spec review |
| **PR-2** | When push can miss a change (no push in `GET /capabilities`, the socket down, or a bus that can't cross processes), then the screen polls at `LIVE_POLL_MS`, 3 s | FIX-2367 | FIX-2846's check and FIX-2368's fallback journey |

PR-2 has one known hole: a split job queue on the in-memory bus does not poll ([PD-3](DECISIONS.md#pd-3), FIX-2856).

**No epic may** put rows or items on a notice; replay, acknowledge or store a notice (they are
at most once, and a client reads again on connect); add an always-on poll beside the session
stream and the socket; invent a topic outside the session, user and org scopes; or let the docs
imply push on a host with no adapter for it.
