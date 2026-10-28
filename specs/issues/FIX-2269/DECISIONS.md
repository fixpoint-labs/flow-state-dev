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

## Amendments while building

- **E5 · The obligation is a wake, not a request-record field.** It is kept as an engine-owned
  wake, entry `parkOwed:<requestId>`, on the request's session, due one stale threshold out
  (`dueAt` and `landBy` both). The wake store already survives a crash, already arms the sweep's
  tick when owed (so E6 needs no new hook: the tick is armed at `dueAt` as the owe is written), and
  already fires in step 2's scan, so the new branch (2c) sits beside the deadline wakes. A record
  field would have needed a store-contract change on every adapter. A record written before this
  has no such wake, so it owes nothing (BP-030).
- **E4 · The cap is age, not a count.** Wakes coalesce and keep their first `createdAt`, so the
  sweep gives up on a request still owing its park 10 minutes (`PARK_OWED_GIVE_UP_MS`) after the
  first owe, clears the wake and leaves the request `interrupted`. That bounds a crash loop with no
  second value. Each continuation moves the wake 30 s out first, so a continuation that dies again
  is tried again on a later tick, never in the same one.
- **A stop lets the owe go.** Stopping an interrupted request that owes a park clears the wake, so
  the sweep doesn't continue a request someone stopped.
- **A call's repeated send dispatches (Workforce).** The spec assumed the send's `runOnce` result
  survives the death. It doesn't when the process dies after the row is written and before the
  dispatch (the goal's `exit-after-row` fault): the replay repeats the send, which found the row and,
  on a flow with a pass, left the dispatch to the pass. The call then had no request to wait on and
  answered `running`. A repeat of a call's send now dispatches itself, pass or not; the take keeps
  the message once.
- **The dispatcher does not owe a park yet (review, Codex P1).** `runOnce` records a result only
  after its function returns, so a dispatcher that dies after its child is accepted and before the
  record would dispatch a second child on the continuation: the dispatch seam takes no stable
  request id. A call is safe in the same window (its message id is kept first and the recipient
  takes it once), so only the call owes a park. The dispatcher keeps today's behaviour (left
  `interrupted` for a hand continue) until it has a dispatch identity kept before the send.
- **A repeated send pays its budget once (review, Codex P2).** The send's per-request count now
  names the ids it holds (`workforceMessagesPaid`), and the chain row appends an id only once, so a
  call continued after dying between paying and its row isn't charged (or refused) a second time.
- **The owe is read before the logged gate (review, Codex P2).** A later wait's owe outlives an
  earlier wait's gate, answered or pruned, so history, retention and `waits.ended` read it first.
- **A stop and a continuation are fenced by the request's lease (review, Codex P2).** The stop lets
  the owe go under the lease, and the sweep's admission reads the owe again under it; a stop that
  finds the lease held answers `already-resolved` (it runs again).

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
