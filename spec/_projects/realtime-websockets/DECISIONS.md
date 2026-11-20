# Decisions — Realtime / WebSockets

[Spec](SPEC.md) · **Decisions** · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md)

Calls that bind more than one epic under this project. A call one epic owns lives in that epic's
spec. Each card below was made inside FIX-2367 and binds the lanes after it, so the next epic
reads it here instead of making it again.

<a name="pd-1"></a>
### PD-1 · A push carries a notice, never rows

**Binds** FIX-2367, push on serverless hosts, the client talks back, and anything that publishes.

A notice names a scope's topic and a change kind. It may name the request that made it and,
since FIX-2625, the ids that changed. It never carries rows, so it needs no access filter per
row and no replay of its own: the screen reads again through the read path it already has.
Rejected: rows on the push, which makes every adapter an access-control and replay engine.
From FIX-2367 [D2](https://github.com/fixpoint-labs/flow-state-dev/blob/main/specs/epics/FIX-2367/DECISIONS.md#d2).

**Costs** one read after every notice. Accepted: the read is coalesced, and an idle screen costs
nothing.

<a name="pd-2"></a>
### PD-2 · Two seams: a bus in the stores profile, delivery at the host

**Binds** FIX-2367 and push on serverless hosts.

A bus carries a notice between processes; delivery carries it from the server to the client. An
adapter fills the seams it can: Postgres fills the bus, the Node host fills delivery, Ably fills
both. This answers the prior description's first open question (one adapter across managed,
platform and self-hosted, or one per path): one adapter per path, behind two seams. Rejected:
one transport adapter for both, which makes a Postgres user write a socket server to cross a
process. From FIX-2367 [D5](https://github.com/fixpoint-labs/flow-state-dev/blob/main/specs/epics/FIX-2367/DECISIONS.md#d5).

**Costs** two places to configure. Accepted while the adapters we ship split differently.

<a name="pd-3"></a>
### PD-3 · The in-memory bus is single-process, by decision

**Binds** every epic here, and any host that runs more than one process.

The default bus never leaves its process and reports that it crosses, so a single-process app
stops polling (FIX-2545). Two processes need a bus that crosses, such as Postgres. Rejected: the
in-memory bus keeping the session stream's timed read on, which made every single-process app
poll for nothing.

**Costs** one multi-process shape the framework can detect goes stale without a word: a job queue
split into `enqueue-only` and `process-only` on SQLite or a custom store. FIX-2856 is filed to
warn at startup or keep the poll for it. Until it lands, a check that relies on the fallback
there will not see one.

## Decided once

- **The socket carries notices, subscribe messages and control frames such as `crossing`,
  nothing else.** Request and item streams stay on SSE (FIX-2367 D4, ER-7). The talk-back lane is
  the one that would change this, and it does so through its own gate.
- **The fallback pace is `useView`'s `LIVE_POLL_MS`, 3 s, not 2 s** (FIX-2846). Any check that
  times the fallback times it at 3 s.
- **Topics come only from the session, user and org scopes**, optionally narrowed to one
  resource under them (FIX-2367 ER-2). This answers the prior description's question of how
  scopes map to channels.
- **The client half is views.** `client.live` and `useView` (FIX-2551, FIX-2623, epic FIX-2618)
  replaced the hook FIX-2367 shipped within ten days, in another project, with neither spec
  naming the other. A later epic here reads again through views and names no topic in the app.
  Whether `useSubscription` retires is FIX-2854's.
- **Serverless hosts poll until an adapter ships**, and no doc implies push there (FIX-2367 D3).
- **The labs are outside FIX-2367's closure.** Their journey over the Teammates and
  claude-code-style labs is FIX-2843's.

<a name="open"></a>
## Open

None.
