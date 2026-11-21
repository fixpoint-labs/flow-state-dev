# Plan — Realtime / WebSockets

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan**

The order the epics run in, what each hands the next, and what is deliberately not next. Status is
[the epics table](SPEC.md#the-epics--derived-live-2026-11-20)'s; this page does not repeat it.

## The arc

![The arc](figures/arc.svg)

One bar, closed: FIX-2367 ran from Oct 31 to Nov 20. The two lanes after it have no bar
because neither is filed, and the now line shows nothing in flight.

| Lane | Consumes | Releases |
|---|---|---|
| **a change reaches every screen watching it** · FIX-2367 | The session stream, flow reads (FIX-2286), the 501 user-stream route, `store-postgres`'s `LISTEN` pool | The notice and topic shape, the `bus` slot with in-memory and Postgres adapters, the WebSocket on the Node host, `GET /capabilities` reporting push, the polling fallback, the realtime guide |
| **push on serverless hosts** · FIX-XXX | Both seams ([PD-2](DECISIONS.md#pd-2)), the mint answer FIX-2428 defined with its Ably arm, and views as the client half | Push on Vercel and Next, starting with the Ably adapter (FIX-380), and the guide's host table with one fewer polling row |
| **the client talks back** · FIX-XXX | The socket and its subscribe check (PR-1) | Interrupt, steer and presence from the client, if a real app asks for them |

Serverless runs next because it is the whole of the outcome's read that is left. The talk-back
lane waits for an app that needs it, and is the one the kill line cuts first.

## What is deliberately not next

- **Rows on the push, or live sync.** [PD-1](DECISIONS.md#pd-1) rules it out for every lane.
- **A self-hosted socket tier beside serverless functions.** The prior description's third path.
  A long-lived host already has the Node socket; a hybrid deployment uses it.
- **A Redis bus on BullMQ's connection.** A possible follow-up FIX-2367 named and did not file.
  Postgres covers BullMQ hosts today.
- **The polish left by FIX-2367.** FIX-2854 to FIX-2856, FIX-2843 and FIX-2844 are loose issues.
  They are not an epic, and none gates the serverless lane.
