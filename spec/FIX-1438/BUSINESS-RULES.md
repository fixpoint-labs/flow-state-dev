# FIX-1438 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md)

The cases, written as rules. Each says what a person or the system does and what happens. The *proved by* column is the check the plan runs. A human reviews this page; the plan turns it into work.

**Stop report** throughout means the run's three-way word for how it ended (`finished`, `stopped-at-limit`, `failed`), defined in [SPEC.md](SPEC.md). Where a rule means the run record's own `outcome` bookkeeping instead, it says so.

## What the completion check is handed

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | A run ends cleanly and reports `finished` | The check is asked, exactly as today, and sees `finished` | CI |
| BR-2 | A run ends cleanly and reports `stopped-at-limit` | The check is asked, and sees `stopped-at-limit` | CI |
| BR-3 | A run ends cleanly and reports no stop report at all | The check is asked, and sees the absent case — distinguishable from every reported word | CI |
| BR-4 | A run reports a stop-report word this framework version does not define | The check sees that word as reported. Never mapped to `finished`, never dropped | CI |
| BR-5 | A run did not end cleanly | The check is not asked, as today. The attempt failed | CI, unchanged suite |
| BR-6 | A prompt builder reads its context | No stop report is on it. The previous attempt's reason still arrives as feedback, as today | CI |

## What a phase does with it, and what the row does

| # | When | Then | Proved by |
|---|---|---|---|
| BR-7 | A phase's check ignores the stop report entirely | Its rows settle exactly as they do today, byte for byte | CI · the cost of [D1](DECISIONS.md#d1), asserted rather than assumed |
| BR-8 | A phase refuses because the run stopped at its limit | The row does not settle. The attempt is failed, the row re-opens, and the reason written on it names the budget stop rather than only "still not done" | CI |
| BR-9 | That row is picked up again | The next attempt resumes the previous attempt's confirmed coding session, so it continues rather than restarting | Existing suite, unchanged |
| BR-10 | A phase refuses on a budget stop for every attempt it is given | The row errors once the retry budget is spent. No new status, no second hold | CI · the path a run that produces nothing already takes |
| BR-11 | A phase's check passes despite a budget stop, because that phase judges the job done | The row settles done. The framework imposes nothing | CI |
| BR-12 | A run asked a question *and* stopped at its limit | The row parks on the question. The ask arm is decided before the completion check, unchanged | CI, unchanged suite |

## Conductor and the lab

| # | When | Then | Proved by |
|---|---|---|---|
| BR-13 | Conductor's implement phase sees a budget stop, and a pull request exists on the branch | It refuses. A pull request is a deliverable, not a finished job ([D3](DECISIONS.md#d3)) | CI |
| BR-14 | The DevForce lab's phase sees a budget stop, and a commit the base ref lacks exists | It refuses | Goal check |
| BR-15 | The lab runs with the `stopped-at-limit` control | The control goes red because the row did not settle done — caught by the same assertion that catches every other control, with no clause of its own | Goal check |
| BR-16 | The lab runs with no control | It passes, unchanged: a clean finish that commits still settles the row done | Goal check |

## Failure taxonomy

Nothing here is fatal. A budget stop is a failed attempt, which is a retry — the same class as a clean run that produced nothing.

**The run record's own `outcome` field is untouched by this change**, and it is a different thing from the stop report: it is the manager's bookkeeping on the run row, holding `running`, `succeeded` or `failed`, and the board row stays the authority on the job's state. The stop report is never written to it. Two fields, two enums, and an implementer who wires the wrong one produces exactly the silent wrong answer this issue is about — which is why the plan pins the field's name apart from `outcome`.

The only way this change makes a row worse off than today is the extra attempt a wrongly-refused budget stop costs, which is named in [D3](DECISIONS.md#d3).

## Acceptance criteria this issue owns

`GOAL_CONTROL=stopped-at-limit pnpm tsx goals/devforce-lab/it-wakes-the-seat-a-file-declared/run.mts` goes red, and its red names the row failing to settle done rather than a framework observation the lab cannot fix. The same goal with no control still passes. Both are run today: the control is red on the finding, the plain gate is green.
