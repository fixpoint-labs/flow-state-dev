# FIX-2269 · Decisions

[Spec](SPEC.md) · **Decisions**

<a name="d1"></a>
## D1 · The engine offers "owe a park"; the wait callers use it

A wait that starts its own work (a call's send, a dispatcher's dispatch) owes a park through a
new `RequestWaits` verb before it starts that work. The engine keeps the obligation on the running
request and continues that request if it dies before it parks.

| | Engine verb, callers owe (chosen) | Workforce continues its own calls | Engine reads Workforce's log |
|---|---|---|---|
| Fixes `dispatcher({ wait: true })` too | yes | no | no |
| Layer boundary | generic hook in L1, policy in callers | needs an engine "continue this request" verb anyway | breaks it: L1 reads a Workforce row |
| Recovery mechanics (lease, replay, sweep timing) | the engine's existing ones | a second copy in Workforce | the engine's |
| Who says replay is safe | the caller, which knows its `runOnce` keys | Workforce | the engine, guessing |

- **Instead of:** the issue's first shape, a wake on the calling session for a Workforce entry.
  A wake starts a new request; it can't continue the one that died, so Workforce would also need a
  new engine verb to continue a request by id, plus its own lease and retry. That is the engine's
  recovery, copied.
- **Instead of:** the issue's second shape, the engine reading the message log for an outstanding
  call. Workforce concepts stay out of Layer 1.
- **Because:** the gap is "a wait's work started and its gate never got written", which is a
  wait-gate fact, and the wait gate is the engine's.
- **Locks in:** a caller that owes a park promises its request replays safely up to the park.

## Decided, not asked

- **E1 · The obligation is the running request's own.** Server-written, with no request id in the
  verb's input, so one request can't make the engine continue another (BP-031).
- **E2 · The park or the end clears it.** A request that owes a park and then parks is recovered by
  its gate (step 2b's existing case). A call that answers without parking (no request to follow
  yet) clears it on return, so a later death elsewhere in the turn is not replayed.
- **E3 · Continued with no resume context**, like the continue route: replay injects what was
  recorded and runs the in-flight block again, whose `runOnce` keys return the send.
- **E4 · Bounded.** A request continued this way that dies again before parking is continued again,
  at most three times, then left `interrupted` with a warning. A crash loop can't spin the sweep.
- **E5 · Storage is the implementer's** (a nullable field on the request record, or a row the
  durability provider keeps), read with `== null` guards so records written before it read as
  owing nothing (BP-030).
- **E6 · The tick comes forward** when the stale sweep marks a request that owes a park, as
  FIX-2166 does for wakes, so recovery is about one stale threshold.

## Considered and dropped

- **Write the gate before the work.** A call's gate binds to the request that acts on the message,
  which isn't known until the dispatch, and a dispatcher's to the child it starts. A gate with no
  binding would wait for its deadline, minutes late.
- **Continue every `interrupted` request.** Unsafe: the engine can't tell which effects ran
  outside `runOnce`.

## Open

None.

## How it got here

- **Draft:** written from the issue (the closure walk's scene ac and its hand continue) and `main`
  at `ba527aa`: `durability-sweeper.ts` step 2b, `request-recovery.ts`, `call.ts`, and the
  dispatcher's `sendAndWait`, which has the same window.
