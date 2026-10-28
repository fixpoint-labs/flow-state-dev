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
| Who says replay is safe | the durable-action contract the wait already needs | Workforce | the engine, guessing |

- **Instead of:** the issue's first shape, a wake on the calling session for a Workforce entry.
  A wake starts a new request; it can't continue the one that died, so Workforce would also need a
  new engine verb to continue a request by id, plus its own lease and retry. That is the engine's
  recovery, copied.
- **Instead of:** the issue's second shape, the engine reading the message log for an outstanding
  call. Workforce concepts stay out of Layer 1.
- **Because:** the gap is "a wait's work started and its gate never got written", which is a
  wait-gate fact, and the wait gate is the engine's.
- **Locks in:** the sweep acts on the durable-action contract for a request that owes a park, with
  no one pressing Continue.

## Decided, not asked

- **E1 · The obligation is the running request's own.** Server-written, with no request id in the
  verb's input, so one request can't make the engine continue another (BP-031).
- **E2 · The caller can't forget the clear.** The verb wraps the work (a callback, or a disposer)
  and the engine clears on every exit of the wait, success or throw, and on the park and the
  request's end. A request that parks is recovered by its gate (step 2b's existing case); a call
  that answers without parking is cleared on return, so a later death elsewhere in the turn is not
  replayed.
- **E3 · Continued with no resume context**, like the continue route: replay injects what was
  recorded and runs the in-flight block again, whose `runOnce` keys return the send.
- **E4 · Bounded.** A request continued this way that dies again before parking is continued again
  a bounded number of times (the implementer's number, logged), then left `interrupted` with a
  warning, so a crash loop can't spin the sweep. The build tests the cap. The count lives with the
  obligation (one nullable value), not in a second field; if retention's age-out already bounds a
  crash loop, the build may drop the count and say why.
- **E5 · Storage is the implementer's** (a nullable field on the request record, which step 2b's
  existing list already returns, is the lean choice; a row the durability provider keeps costs a
  read per request), read with `== null` guards so records written before it read as
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

## Notes from review

Round 1 (Codex: no findings; Cursor: direction approved). Folded: the obligation's lifecycle in one
SPEC line, the tick armed like `onWakeOwed`, history and retention reading an owed request as one
that runs again, E4's cap left to the implementer with a test. For the implementer, verbatim in
substance:

- One core helper for "owe, send under `runOnce`, `waitOnRequest`", so the dispatcher and the call
  can't drift on where they owe.
- Every blocking call pays one durable write; a mass crash can fan out many continuations in one
  tick. Consider a per-tick limit if fleet restarts matter.

Round 2 (a second-look pass on the PR). Folded: the debt reframed as the durable-action contract
a wait already needs, so D1's table names that contract rather than the caller; E2's owe and clear
as one wrapped pair; E4's count kept with the obligation; two more controls (owed, parked, resumed,
then died; and a fault right after the owe). For the implementer: keep the new branch inside step
2b's existing scan, and update the `RequestWaits` JSDoc and the engine README if it lists the verbs.
