# FIX-2428 · Decisions

[Spec](SPEC.md) · **Decisions**

Three calls shape this issue. D1 is the one to weigh. Everything else here is context for them.
The epic's D2, D4 and D5 and its rules ER-4, ER-5 and ER-7 are kept, not reopened.

## The tree

```mermaid
flowchart TD
  I["FIX-2428"] --> D1["D1 · a short ticket from the client's fetcher, checked per topic"]
  D1 -.->|"rejected · a bearer header can't ride a browser socket"| X1["the upgrade request signs in on its own"]
  I --> D2["D2 · no check while the socket is open · it ends after an hour"]
  D2 -.->|"rejected · a store read per notice per viewer"| X2["check again on every notice"]
  I --> D3["D3 · read on a timer wherever push can miss a change"]
  D3 -.->|"rejected · a dropped socket goes stale with no sign"| X3["read on a timer only when the server has no push"]
```

Solid edges are what you are signing. Dashed edges lost, and the label says why.

<a name="d1"></a>
## D1 · The socket proves who it is with a short ticket, minted through the client's own fetcher and checked per topic

| | |
|---|---|
| **Instead of** | The upgrade request signing in on its own, through the app's principal resolver, as every other route does |
| **Because** | A browser can't add a header to a WebSocket. Only cookies ride the upgrade, and Shift Manager and the DevTool sign in with a bearer header their client's fetcher adds. The client can't read that header back out of the fetcher, so the client can't move it onto the socket either. A `POST /users/:userId/stream` with the topics goes through that fetcher like any call. The server checks each topic with its scope's route check on that real request (ER-4), and answers with a ticket that names the caller and the granted topics and expires in 30 s. The socket accepts topics only from a ticket. A reconnect mints again, so the check runs on every connect (FIX-1620). FIX-380 answers the same call with its Ably token for the same topics |
| **Locks in** | One extra request per connect and per added topic. The public route `POST /users/:userId/stream` and its answer, one union FIX-380 shares ([below](#decided-not-asked)). A signing secret: one random key per process by default, and `pushSecret` (or `FSD_PUSH_SECRET`) shared by every process behind one address. Without it a connect that lands on another process is refused, and the hook reads on its timer until a retry lands (D3) |

![D1: how the socket proves who it is. Chosen: a short ticket from the client's fetcher, checked per topic, beside the upgrade signing in on its own. Decides it: an app that signs in with a bearer header. Price: one more request per connect, and a secret for several processes. Locks in the mint route FIX-380 shares; flips if every browser app signs in with cookies](figures/d1-ticket.svg)

It comes down to the bearer header: on its own, the upgrade can't carry it, so Shift Manager polls.

**What would change my mind:** every app we serve to a browser signs in with cookies. Then the
upgrade signs in on its own, and the mint and the secret go.

<a name="d2"></a>
## D2 · An open socket is not checked again; the server ends it after an hour

| | |
|---|---|
| **Instead of** | Checking the caller's access again before each notice is sent |
| **Because** | A check per notice is a store read per notice per viewer, the cost the epic chose the bus to avoid ([D1](../../epics/FIX-2367/DECISIONS.md#d1)). A notice carries no rows (epic D2), so what a revoked user keeps is the moment of a change, never its content, and every read they make is checked as always. The hour cap bounds that, because the reconnect mints again and the mint checks again |
| **Locks in** | Revoked access stops notices at the next connect, at most an hour later. Every client reconnects at least hourly, which the at-most-once rule already makes harmless (ER-6: a connect reads once) |

![D2: when an open socket is checked. Chosen: at connect only, with a one-hour cap, beside before every notice. Decides it: what a notice costs. Price: a revoked user hears that something changed, never what, for up to an hour. Flips if a notice ever carries rows](figures/d2-no-recheck.svg)

It comes down to the cost of a notice: a check before each one is a store read per viewer.

**What would change my mind:** a notice that carries data, or a scope whose bare timing of
change is itself confidential. Then a check per notice is the price.

<a name="d3"></a>
## D3 · The hook reads on a timer wherever push can miss a change: no push, the socket down, or a bus that can't cross processes

| | |
|---|---|
| **Instead of** | Reading on a timer only when `GET /capabilities` says there is no push · a server that sends a synthetic notice at the poll pace where its bus can't cross, so the client needs no `crossing` frame. That adds a server timer per connection, while the client already keeps one for a dropped socket |
| **Because** | A socket can be up and still miss a change made on another process, when its process's bus doesn't cross processes (the in-memory bus on two processes, a Postgres bus that stopped hearing its ping). FIX-2426 keeps the session stream's timer there; the hook keeps its own the same way. And a socket on a host with push still drops: a proxy's idle timeout, a deploy, a laptop that sleeps, a ticket that lands on another process. With the timer tied to capabilities alone, the screen goes stale with no sign of it. So `client.subscribe` reads on its timer from the first failed reconnect, the pace `followSession` already treats as lapsed, until the socket is back, and while the socket says its bus doesn't cross (an open Ably connection always crosses, [below](#decided-not-asked)). Each connect and reconnect calls `onChange` once. The timer lives in `client.subscribe`, not in each hook, so every consumer gets one fallback. Epic ER-5 says the same |
| **Locks in** | `pollIntervalMs` on `client.subscribe` and `useSubscription`, a public name. A screen on a push host still costs a read per interval while its socket is down or its bus doesn't cross, which on the in-memory bus is always, even on one process (FIX-2426 D1) |

![D3: when the hook reads on a timer. Chosen: wherever push can miss a change, beside no push only. Decides it: a socket that misses a change, dropped or on a bus that cannot cross. Price: a read per interval meanwhile. Flips if push on long-lived hosts never misses a change](figures/d3-fallback.svg)

It comes down to push that misses a change: without the timer, the screen stops changing with no sign.

## Decided, not asked

- **Push is on whenever `serve()` is the host**, `fsdev dev` and `fsdev serve` included, with
  `push: false` to turn it off. `createServerApp` alone (Lambda, Bun, Deno) reports `push: null`.
- **The convergence point is the mint.** Every topic in a socket's subscription set came from a
  ticket the mint signed, on the first connect, on a topic added to an open socket, and on a
  reconnect. No socket message that names a topic is ever accepted on its own. FIX-380's token
  goes through the same mint (ER-4).
- **User and org topics name no id on the wire** (FIX-2426's wire topic). The mint fills them
  from the caller's identity (BP-031), so no one can name another user's or organization's
  scope. A session topic names its session and passes the check `session_stream` uses. A topic
  narrowed to one resource passes its scope's check.
- **The mint answers one union, keyed by transport**, so FIX-380 shares it rather than defining
  its own: `{ transport: "websocket", ticket, path } | { transport: "ably", tokenRequest, channels }`.
  Both carry only the granted topics. The union, the Ably arm's shape and its crossing rule
  (below) are defined here, once; FIX-380 adopts them and owns only the Ably implementation.
- **A refused topic is absent from the answer**, as a topic for a missing session is: where a
  route would answer `hiddenSessionResponse`, the mint drops the topic, so it tells no one which
  ids exist. The client treats an absent topic as refused and tries it again at the poll pace
  (below). The POST joins the engine's user-route scoping table (`user-route-scoping.test.ts`).
- **The socket says whether its bus crosses processes.** After the ticket, and on each
  `onCrossingChange` (FIX-2426), the server sends a `crossing` frame `{ crosses }`. Until the
  first `crosses: true`, and while it is false, `client.subscribe` reads on its timer as if the
  socket were down (D3), still running `onChange` on each notice; each change of the answer runs
  it once, as a connect does. "Doesn't cross until the first frame" is the WebSocket arm's rule.
  The frame is a delivery control frame, which epic ER-7 admits on the socket; it is never a
  notice kind.
  Not a `GET /capabilities` field: the client reads that once, the answer can change at runtime
  (FIX-2427's ping), and it belongs to the process the socket landed on, not to the host.
- **On the Ably arm, an open Ably connection counts as crossing.** Ably's bus is the delivery
  itself, so no frame is sent or awaited: a mint answer with `transport: "ably"` means push
  covers every process while that connection is up. A dropped Ably connection resumes the timer,
  as a dropped socket does, and its return runs `onChange` once. FIX-380 builds that arm.
- **One way to follow a session** (ER-5). `useSession({ live })` follows its own items; a session
  topic on `useSubscription` is for flow `reads`. FIX-2429 moves `liveBoardDriver` onto it.
- **`GET /capabilities` answers `{ userStream, push }`**, with `push` one of
  `{ transport: "websocket" }`, `{ transport: "ably" }` (FIX-380) or `null`. A client that gets no `push` field, from an older
  server, treats it as `null` (BP-030). Both stay: on FIX-380's Ably host `push` is set and
  `userStream` false. The client branches only on `push` to decide whether to mint. Once it
  mints, the answer's `transport` is authoritative; `capabilities.push.transport` only advertises,
  and a stale capabilities read that disagrees loses.
- **`pushSecret` is `string | (() => string)`**, as the webhook verifiers take it. A ticket that
  fails its signature check is logged, not only met by the timer. Signing may use `jose` or a
  similar library; the format is the implementer's within D1.
- **The ticket travels in the first socket message, not the URL**, so a proxy's access log never
  holds it. A socket with no valid ticket within five seconds is closed.
- **One socket per client** (epic D4), shared by every `client.subscribe` call on it, with topics
  counted so the last `close()` on a topic unsubscribes it and the last handle closes the socket.
- **A refused topic is tried again at the poll pace**, not stopped for good, so access given back
  recovers with no remount (FIX-1620).
- **`pollIntervalMs` omitted means no timer.** The hook then reads on a notice, a connect and a
  reconnect only, and a refused topic is tried again on reconnect. A view that polls only part
  of the time passes it then and omits it otherwise; FIX-2429's Shift Manager does, while a task
  is open.
- **The socket session lives in the engine; `serve()` only takes the upgrade and moves frames**
  (epic D5), so a later host reuses the check. The `ws` library handles frames in
  `@flow-state-dev/node`.
- **`client.stream()` goes with no replacement under its name.** The server never served it and
  it carried rows. `UserStreamEvent` and the user-only event types it unions go from
  `@flow-state-dev/contracts` with it; `StreamEvent` stays, now `RequestStreamEvent`. The new
  wire types join contracts there: the `crossing` frame (`{ type: "crossing", crosses }`) and
  the mint answer's union. Changesets
  (minor) for client, react, node, engine (the POST, `push`, no 501), and contracts and core,
  which re-exports its items. The client's
  says: "`fsd.stream()` never worked (501); use `fsd.subscribe()`".
- **`docs/mechanisms/mechanisms.yaml` gains a `push-delivery` row** (adapters: node; FIX-380 adds
  Ably), with the bus row FIX-2426 adds as what it is built on.

## Considered and dropped

| Alternative | Why not |
|---|---|
| The bearer token in the WebSocket subprotocol header | The client can't read a credential out of an opaque fetcher, and an app's resolver may read a header we don't know |
| The ticket in the socket URL | Access logs and proxies keep URLs |
| Tickets stored once and used once | Needs a store every process shares. A signed 30-second ticket needs only a shared secret, and only with several processes |
| An SSE stream per topic | Epic [D4](../../epics/FIX-2367/DECISIONS.md#d4) |
| A timer in each hook (FIX-1506's, the board's) | Several fallbacks with several paces; ER-5 wants one path |
| Keeping `client.stream()` beside `client.subscribe` | Two ways to watch a user's scope, one of which never worked and carries rows |

## Settled

No POC was built. The one premise the design rests on, that `serve()` can take an upgrade
beside the Hono app, is read from the code: `serve()` holds the `node:http` server, which emits
`upgrade` for any request with one. The spec rests on no counted facts, so it ships no checker.

## Analysis

2026-11-01 · watermark 2026-10-31 (epic approved) · **Right approach.** Run by the author, in
this dispatch, with no fresh sub-agent: this worker could not dispatch one. The coordinator may
run a fresh `analysis` before the gate.

1. **Reuse** — every Adds row extends or composes an existing piece; `client.subscribe` replaces
   `openUserStream` on the same route ([Builds on / Adds](SPEC.md#whats-already-here-and-the-debt)).
2. **Prior art** — Pusher's and Ably's channel auth, and Phoenix's socket token, all mint a
   short credential through an authenticated HTTP call and check it at connect. D1 follows them.
3. **Other shapes** — cookie-only sign-in, the credential in the subprotocol; both in
   *Considered and dropped*.
4. **New factors** — FIX-2426's spec owns the wire topic and its `topic.*` constructors; this
   spec uses them.
5. **Necessity** — earns its place: it is the epic's one client path, and the epic's own apps
   need the bearer-header case.
6. **Ergonomics** — one hook with the read the screen already has; one option, the interval.
7. **Concerns** — the debt line is up. It sits inside the epic's accepted channel. Recorded.

## How it got here

- **Draft** — the socket on the user-stream route under `serve()`, a per-topic ticket from a
  mint through the client's fetcher, `client.subscribe` with the timer inside it, and
  `useSubscription` over the coalesced read. `client.stream()` removed.
- **Amended (Nov 1)** — a refused topic answers as a missing one; one way to follow a session;
  the contracts types and changesets named; `pushSecret`'s shape; D3 tied to epic ER-5.
- **Amended (Nov 2)** — the mint's answer as a union FIX-380 shares, a refused topic absent; D3
  widened to a bus that can't cross processes, which the socket reports in a `crossing` frame
  (raised by FIX-2429's analysis).
- **Review (Nov 2, #4511)** — D3 records the server tick it rejects; the `crossing` frame is a
  control frame under ER-7 and a contracts type; the mint's `transport` is authoritative; the
  goal check uses FIX-2426's one crossing double and starts its idle window at the first frame.
- **Amended (Nov 2, #4513)** — `onChange` is passed the notice that woke it (`null` for a
  connect, a reconnect or a poll), owned here; FIX-1506's panels and FIX-2466's views consume it.

**Open: none.**
