# FIX-1791 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The cases, written as rules. Alice and Bob are two users of one org. A *conversation* is one
session on Alice's coordinator. The *proved by* column is the check the plan runs.

## Delegates

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | A conversation's delegates are read or changed for the first time, by a post or an action | They become a copy of the coordinator's defaults, in server-written session state (FIX-1788 BR-18a). The defaults may be empty: FIX-1793's project coordinator starts with none. The configuration is not written | CI |
| BR-1a | A delegate action names a session that isn't linked to a coordinator worker. *Amended after merge ([FIX-1802 D1](../FIX-1802/DECISIONS.md#d1)):* or to any worker whose file lists `delegates:` | Refused, naming why. Nothing written. A guard: every session on a worker flow is linked at create (FIX-1788 BR-10, BR-14), so any coordinator conversation takes the actions | CI |
| BR-2 | Alice adds a worker on her roster, her own or a standard one, with `addDelegate` in the app or through the coordinator's tool | It joins this conversation's delegates as one delegate record: the worker and an optional note on what it's good at. The record can also hold a target the caller resolves (a project's workstream entry address for FIX-1793), written only through the internal delegate mutation FIX-1793's entry paths call. The public actions and the tool take no target: one sent to `addDelegate` is refused, naming the field. Her other conversations don't change | CI · VG leg d |
| BR-3 | Alice adds Bob's worker, or a name nobody holds | Refused with one answer for both, naming the id. Nothing written | CI · VG leg f |
| BR-4 | Alice adds a worker whose flow can't take a delegated post. *Amended after merge ([FIX-1802 D1](../FIX-1802/DECISIONS.md#d1)):* a post or a task; each use checks its own | Refused, naming the flow. Nothing written | CI |
| BR-5 | Alice adds a delegate record already on the list, or a 26th | Refused, naming the delegate or the cap of 25. Both go by the record, not the bare worker: one worker with two targets is two delegates. The roster check still runs on the worker | CI |
| BR-6 | Alice removes a delegate, including one fired since it was added | The removal names the delegate record (worker plus optional target), and only that record leaves this conversation's list; another record led by the same worker stays. Removal checks the list, not the roster. Posts already delivered to it still take their answer. If it was the fallback, the conversation has none | CI · VG leg d |
| BR-6a | Alice sets the fallback to a delegate on this conversation's list, or clears it, in the app or through the tool | It names the delegate record (worker plus optional target) and changes for this conversation only. A record not on the list is refused, naming it | CI · VG leg e |
| BR-7 | Two changes to one conversation's delegates arrive together | Both land, or one is refused as stale. Neither is lost | CI |
| BR-8 | A conversation is created with delegates in the caller's state | Refused with 400, naming the field. The public create can't seed delegates; only the four actions and the coordinator's tool write them ([ER-4](../../epics/FIX-1786/BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt), FIX-1788 BR-15 and BR-18a) | CI · VG leg f |
| BR-9 | A delegate is fired while still on a list | The next post skips it and records why. Its entry stays until removed | CI |
| BR-10 | Anyone asks who a coordinator's delegates are | The coordinator answers from its delegate read, which returns the whole list and each note. Never from `discover` or its prompt | CI · VG leg d |
| BR-11 | A standard coordinator's defaults name a worker that isn't standard | Refused at load, naming it ([ER-6](../../epics/FIX-1786/BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt)) | CI |

## Routing a user's post

| # | When | Then | Proved by |
|---|---|---|---|
| BR-12 | The policy is **judgment** | The coordinator's own turn reads the post and hands it to delegates with its tool, or answers itself. Each hand-off is one delivery | CI · VG legs a to c |
| BR-13 | The policy is **best fit** | One evaluator call picks one delegate, from each one's note or else its description. A delegate with neither isn't a choice | CI · VG leg e |
| BR-14 | Best fit, and the user's last post went to a delegate that hasn't answered since | The post goes there too, with no model call. A removed or unreachable holder holds nothing | CI · VG leg e |
| BR-15 | Best fit, and the call fails or picks no delegate | The fallback delegate takes it ([D2](DECISIONS.md#d2)) | CI · VG leg e |
| BR-16 | As BR-15, and the conversation has no fallback, or it can't be reached | The coordinator's own judgment turn takes it, as under BR-12: it hands the post on with its tool or answers itself. Recorded `by: judgment` ([D2](DECISIONS.md#d2)) | CI · VG leg e |
| BR-16a | As BR-16, and the judgment turn fails | Nobody takes it. Recorded `unplaced`, and the conversation says so | CI · VG leg e |
| BR-17 | The policy is **round robin** | The next delegate in list order takes it; the turn moves one step per user's post, skipping one that can't be reached | CI · VG leg e |
| BR-18 | The policy is **everyone** | Each delegate that can be reached gets it once | CI · VG leg e |
| BR-19 | A conversation has no delegate that can be reached | Nobody runs. Recorded `unplaced`, and said in the conversation | CI |

## Answers and rounds

| # | When | Then | Proved by |
|---|---|---|---|
| BR-20 | A delegate answers a delivery | The answer lands in the conversation, under the delegate's name, once. It must carry its delivery's token | CI · VG leg e |
| BR-20a | A delivery reaches a delegate | The delivery ledger delivers into a session its caller resolves from the delegate record. The coordinator's delegates have no target, and its default opens one through FIX-1788's `ensureWorkerSession({ worker, filingSessionId })`, on Alice's behalf, with the delegate named, so the server links it at create. The key is the conversation's incarnation, not just its id: the ledger sets `filingSessionId` from the id plus the coordinator session's server-written creation stamp, read server-side and never from a caller, so the derived id includes the incarnation. A coordinator session deleted and created again under the same id opens fresh delegate sessions, never its predecessor's. A later delivery from this conversation reuses it; one from another conversation opens another. FIX-1793's project coordinator passes the workstream's existing session instead, resolved from the record's target by a resolver FIX-1793 supplies, which is also linked at create. Either way, nothing posts to a session id no create linked (FIX-1788 BR-14, BR-18a) | CI |
| BR-21 | One delivery reaches a delegate twice, or its answer is sent twice | One answer lands. The second writes nothing | CI · VG leg e |
| BR-22 | An answer names a post or token it wasn't delivered | Refused. Nothing lands | CI |
| BR-23 | `rounds:` is zero, or unset | An answer routes nowhere. Under judgment it doesn't wake the coordinator's turn | CI · VG leg e |
| BR-24 | `rounds:` is *n*, and an answer lands in round *r* below *n* | Under best fit and round robin, the policy routes it again in round *r* + 1, never to its own author. Under everyone, when round *r* closes, each delegate gets the others' answers from it in one delivery. Under judgment, when round *r* closes, its answers wake the coordinator's turn once | CI · VG leg e |
| BR-24a | Under judgment, the coordinator hands off during a wake for round *r* | The hand-off is delivered in round *r* + 1, at most once per delegate; a second to the same delegate is skipped and recorded. The round comes from the wake, never from the tool's input | CI |
| BR-24b | A round's deliveries are all answered or failed, or its deadline passes | The round closes. A delegate that never answered is left out of what goes on; its answer, if it comes later, lands once and routes nowhere | CI |
| BR-25 | An answer lands in round *n*, or round *n* closes | It routes nowhere, and under judgment wakes nothing | CI · VG control `no-round-limit` |
| BR-26 | A configuration sets `rounds:` above 3 | Refused when saved, or at load for a file, naming the ceiling ([D1](DECISIONS.md#d1)) | CI |
| BR-27 | A post, an answer or a hand-off carries a round, an author mark or a token field of its own | Ignored. The round comes from the delivery record, or for a hand-off from its wake | CI |

## The record

| # | When | Then | Proved by |
|---|---|---|---|
| BR-28 | Any routing decision is made | One `coordinator-route` record: the post, the round, the policy, and per delegate delivered, skipped with why, or none with why. `by` is one of `judgment`, `held`, `evaluated`, `fallback`, `round-robin`, `everyone`, `unplaced` | CI · VG legs a and e |
| BR-29 | A client renders the conversation | Records never show as lines | CI |

## Who can reach what

| # | When | Then | Proved by |
|---|---|---|---|
| BR-30 | Bob opens, reads or posts to Alice's conversation | Refused, as today (engine ownership) | Existing suite · VG leg f |
| BR-31 | A delivery's delegate resolves to a worker that isn't Alice's at delivery time | Not delivered. FIX-1788's link check refuses it as a second line | CI |
| BR-32 | The coordinator's tool is asked to add Bob's worker | As BR-3, through the same check | CI · VG leg f |

## The chief of staff

| # | When | Then | Proved by |
|---|---|---|---|
| BR-33 | Alice opens Shift Manager | The chief of staff, shown as "Shift Coordinator", is first on her roster and runs on the coordinator flow, routing by judgment | CI · VG leg a |
| BR-34 | Alice asks it for work no delegate does | It hires one worker on her roster with a description, adds it to this conversation's delegates, and hands it the post. Asked again, it hires nothing new | VG legs b and c |

## Failure taxonomy

A refused change writes nothing and names why. A post nobody can take is recorded and said in the
conversation, never an error to the poster. A failed evaluator call falls back once. A delegate
that fails its turn leaves its delivery unanswered; nothing retries it, its round closes without
it at the deadline, and a redelivery is answered once. Nothing here deletes a line, a record or
a delegate's conversation.

## Acceptance criteria this issue owns

[The goal](SPEC.md#the-goal-and-how-well-know-its-met): legs a to f pass on Shift Manager with two
users and a real model, and each control fails on its named signal. Epic ER-4 and ER-5 hold.
