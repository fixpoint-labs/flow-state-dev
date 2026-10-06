# FIX-1791 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The cases, written as rules. Alice and Bob are two users of one org. A *conversation* is one
session on Alice's coordinator. The *proved by* column is the check the plan runs.

## Delegates

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | Alice's first turn in a new conversation | Its delegates are a copy of the coordinator's defaults, in server-owned state. The configuration is not written | CI |
| BR-2 | Alice adds a worker on her roster, her own or a standard one, in the app or through the coordinator's tool | It joins this conversation's delegates, with an optional note on what it's good at. Her other conversations don't change | CI · VG leg d |
| BR-3 | Alice adds Bob's worker, or a name nobody holds | Refused with one answer for both, naming the id. Nothing written | CI · VG leg f |
| BR-4 | Alice adds a worker whose flow can't take a delegated post | Refused, naming the flow. Nothing written | CI |
| BR-5 | Alice adds a delegate already on the list, or a 26th | Refused, naming the delegate or the cap of 25 | CI |
| BR-6 | Alice removes a delegate | It leaves this conversation's list. Posts already delivered to it still take their answer | CI · VG leg d |
| BR-7 | Two changes to one conversation's delegates arrive together | Both land, or one is refused as stale. Neither is lost | CI |
| BR-8 | A conversation is created with delegates in the caller's state | Refused with 400, naming the field ([ER-4](../../epics/FIX-1786/BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt), FIX-1788 BR-15) | CI · VG leg f |
| BR-9 | A delegate is fired while still on a list | The next post skips it and records why. Its entry stays until removed | CI |
| BR-10 | Anyone asks who a coordinator's delegates are | The coordinator answers from its delegate read, which returns the whole list and each note. Never from `discover` or its prompt | CI · VG leg d |
| BR-11 | A standard coordinator's defaults name a worker that isn't standard | Refused at load, naming it ([ER-6](../../epics/FIX-1786/BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt)) | CI |

## Routing a person's post

| # | When | Then | Proved by |
|---|---|---|---|
| BR-12 | The policy is **judgment** | The coordinator's own turn reads the post and hands it to delegates with its tool, or answers itself. Each hand-off is one delivery | CI · VG legs a to c |
| BR-13 | The policy is **best fit** | One evaluator call picks one delegate, from each one's note or else its description. A delegate with neither isn't a choice | CI · VG leg e |
| BR-14 | Best fit, and the person's last post went to a delegate that hasn't answered since | The post goes there too, with no model call. A removed or unreachable holder holds nothing | CI · VG leg e |
| BR-15 | Best fit, and the call fails or picks no delegate | The fallback delegate takes it ([D2](DECISIONS.md#d2)) | CI · VG leg e |
| BR-16 | As BR-15, and the conversation has no fallback, or it can't be reached | Nobody takes it. Recorded `unplaced`, and the conversation says so | CI · VG leg e |
| BR-17 | The policy is **round robin** | The next delegate in list order takes it; the turn moves one step per person's post, skipping one that can't be reached | CI · VG leg e |
| BR-18 | The policy is **everyone** | Each delegate that can be reached gets it once | CI · VG leg e |
| BR-19 | A conversation has no delegate that can be reached | Nobody runs. Recorded `unplaced`, and said in the conversation | CI |

## Answers and rounds

| # | When | Then | Proved by |
|---|---|---|---|
| BR-20 | A delegate answers a delivery | The answer lands in the conversation, under the delegate's name, once. It must carry its delivery's token | CI · VG leg e |
| BR-21 | One delivery reaches a delegate twice, or its answer is sent twice | One answer lands. The second writes nothing | CI · VG leg e |
| BR-22 | An answer names a post or token it wasn't delivered | Refused. Nothing lands | CI |
| BR-23 | `rounds:` is zero, or unset | An answer routes nowhere. Under judgment it doesn't wake the coordinator's turn | CI · VG leg e |
| BR-24 | `rounds:` is *n*, and an answer lands in round *r* below *n* | The policy routes it again in round *r* + 1, never to its own author. Under everyone, each other delegate gets that round's answers in one delivery. Under judgment, it wakes the coordinator's turn | CI · VG leg e |
| BR-25 | An answer lands in round *n* | It routes nowhere | CI · VG control `no-round-limit` |
| BR-26 | A configuration sets `rounds:` above 3 | Refused when saved, or at load for a file, naming the ceiling ([D1](DECISIONS.md#d1)) | CI |
| BR-27 | A post or answer carries a round, an author mark or a token field of its own | Ignored. The round comes from the delivery record alone | CI |

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
that fails its turn leaves its delivery unanswered; nothing retries it, and a redelivery is
answered once. Nothing here deletes a line, a record or a delegate's conversation.

## Acceptance criteria this issue owns

[The goal](SPEC.md#the-goal-and-how-well-know-its-met): legs a to f pass on Shift Manager with two
users and a real model, and each control fails on its named signal. Epic ER-4 and ER-5 hold.
