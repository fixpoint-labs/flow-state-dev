# FIX-1833 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The cases, written as rules. Each says what a person or the system does and what happens. The
*proved by* column is the check the plan runs. VG is the goal check; CI is the workforce suite.

## Who best fit can pick

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | A best-fit coordinator with a description gets a person's post, and at least one delegate is a choice | The choices are each reachable delegate with a note or a description, as today, plus the coordinator itself, keyed by its worker id and picked by its description ([D1](DECISIONS.md#d1)) | CI |
| BR-2 | The coordinator has no description, or no delegate is a choice | The coordinator isn't offered. Best fit places the post as today: `none-reachable` and `none-described` still go to the fallback, else the turn, with no call | CI |
| BR-3 | An answer goes back out between rounds | The coordinator is not a choice; its delegates are, as today. Its author is never one | CI |
| BR-4 | A coordinator names itself in `delegates:` | Its flow takes no delegated post, so the post check skips it, as today. It is a choice only as itself, never twice | CI |
| BR-5 | Best fit offers one delegate and the coordinator, and nobody holds the post | Jev is still called: two choices, never one | CI |

## What best fit does with the pick

| # | When | Then | Proved by |
|---|---|---|---|
| BR-6 | Jev picks a delegate at or above the coordinator's `minConfidence:` | It is delivered and recorded `by: evaluated`. The coordinator runs no turn and writes no line | CI · VG legs a, b, g |
| BR-7 | Jev picks the coordinator | Its own turn takes the post, as under judgment, even when a fallback delegate is set. Recorded `by: judgment` with `fit.reason: coordinator`. The hold clears, as on any miss | CI · VG leg h, `e:self` |
| BR-8 | Jev picks a delegate below the floor | A miss, `below-floor`: the fallback delegate takes it when set and reachable, else the coordinator's turn. The record names the pick, its confidence and the floor | CI · VG `e:below-floor` |
| BR-9 | A floor is set and the model reports no confidence | A miss, `no-confidence`, placed as BR-8 | CI · VG `e:no-confidence` |
| BR-10 | No floor is set | Any delegate pick is used, whatever its confidence, as today | CI · VG `e:evaluated` |
| BR-11 | Jev picks the coordinator on a coordinator that has a floor | Its turn takes the post at any confidence. The floor is for delegate picks only | CI |
| BR-12 | The call fails, or answers with something that isn't a choice | As today: the fallback, else the turn. The record names the failure | CI · VG `e:fallback`, `e:judgment` |
| BR-13 | The person's last post went to a delegate that hasn't answered | The post goes there too, with no call, whatever it asks ([D2](DECISIONS.md#d2)) | CI · VG `e:held` |
| BR-14 | The coordinator's turn takes a post from best fit, and fails | Nobody takes it: recorded `unplaced` and said in the conversation, as today | CI · VG `e:unplaced` |

## The setting

| # | When | Then | Proved by |
|---|---|---|---|
| BR-15 | `minConfidence:` is below 0, above 1, or not a number | `hireWorkforce` refuses the file, naming the key | CI |
| BR-16 | `minConfidence:` is set on a coordinator that doesn't route by best fit | Refused, naming the key and `routing: best-fit` | CI |

## The DevTeam chief of staff

| # | When | Then | Proved by |
|---|---|---|---|
| BR-17 | Alice asks it to file a feature, in any wording the goal holds out | The post reaches `eng.em` by evaluation. The EM's answer is the first line after her post | VG legs a, b, g |
| BR-18 | Alice asks it to hire, fire, start a project, or add, remove or list its delegates | Its own turn takes the post, and does what it does today | VG legs c, d, f, h |
| BR-19 | Alice asks something vague | Jev's pick falls below 0.7, so the turn takes it, and can still hand it to the EM | POC sets D and S1 only: not a check, since a vague ask can't be held out reliably |
| BR-20 | The gateway can't serve Jev, or refuses the call | Each post goes to the turn: today's behaviour, slower to start | CI (scripted failure) |
| BR-21 | Alice asks it to hire while the EM still works her last post | The hire goes to the EM, which answers that nothing was filed ([D2](DECISIONS.md#d2)) | Stated, not tested |

## Memory

| # | When | Then | Proved by |
|---|---|---|---|
| BR-24 | The DevTeam runs with memory capture on, and a post is routed straight to a delegate | The chief of staff runs no turn on it, so its memory likely records nothing of the post. Confirm, and say so in the README | V5 |

## What the record says

| # | When | Then | Proved by |
|---|---|---|---|
| BR-22 | Best fit doesn't deliver to its pick, and the fallback or the coordinator's turn takes the post | The `by: fallback` or `by: judgment` record carries `fit`: the reason (`coordinator`, `below-floor`, `no-confidence`, `failed`, `not-a-choice`, `no-delegates`), and the pick, its confidence and the floor where they exist | CI · VG leg h, leg e |
| BR-23 | The judgment policy's own turn routes a post | The record carries no best-fit reason, as today | CI |

## Failure taxonomy

Nothing new is fatal. Every doubtful or failed pick degrades to the fallback delegate or the
coordinator's turn, which is the behaviour the DevTeam has today. Only a turn that fails after
that leaves a post unplaced, and that is said in the conversation, as before. Nothing retries:
the evaluation is one call.

## Acceptance criteria this issue owns

[The goal](SPEC.md#the-goal-and-how-well-know-its-met): on Jev and a real turn, legs a, b and g
reach `eng.em` by evaluation with no chief-of-staff turn, legs c, d, f and the new leg h reach its
turn, leg e proves the floor and the coordinator choice on scripted confidences, and
`no-self-choice` and `no-floor` each fail at their named assertion. Docs cover the floor
([DOCS.md](DOCS.md)).
