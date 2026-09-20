# FIX-963 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md)

The cases, written as rules. Each says what happens and what proves it. A human reviews this page for a case that is missing; the plan turns it into work.

## When a recorder's write fails

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | The write saved the work and announcing it threw | Reported on a saved entry naming the task and which recorder. The original error is not re-raised here; the run reports at its boundary | Integration |
| BR-2 | The write saved nothing and threw | Exactly today's behaviour. The success recorder hands the error to the safety net; the error recorder honours `onError` | Integration + unit |
| BR-3 | The board cannot tell which of the two happened | Same as BR-1 ([D1](DECISIONS.md#d1)). It is reported as *undetermined*, not as *failed to save* — the two are different entries, never collapsed. **And the row is released**: the recorder does not swallow the write and walk away leaving the task claimed, because an unsettled row is recoverable only by waiting out the lease | Integration + unit |
| BR-3b | The board cannot tell, and the write in fact never landed | The task ends up settled or back in the queue on the same pass, not left `in_progress` under a lease nobody is renewing. Today the rethrow into the safety net does this for free; the swallow path removes that, so it has to be done deliberately | Integration |
| BR-4 | The write was declined rather than failing — the task was cancelled, reclaimed, or already settled by someone else | Nothing reported. A decline is not a failure, and this is FIX-951's containment property | Integration |
| BR-5 | The worker parked its own task for a human before returning or throwing | Neither recorder writes at all, so there is nothing to report | Unit |
| BR-6 | A task still has retries left, so its failure re-queues it rather than ending it | Treated identically to any other saved write. Nothing in the rule names a status, which is what keeps this correct | Integration + unit |
| BR-7 | The store is simply down, and the task is untouched | Not reported as a bookkeeping failure on our own stores — the token says nothing was saved. On a custom store this is BR-3 | Unit |
| BR-7b | The same, on a row that was already in a persistent store before the record shipped | This is BR-3, not BR-7, and permanently so: the row carries no identity nonce, nothing backfills one, and the answer is withheld before the revision proof is reached. It is the only way a built-in store gives *cannot tell* | Unit |

## What the run reports

| # | When | Then | Proved by |
|---|---|---|---|
| BR-8 | One task's bookkeeping failed and the others are healthy | Every other task finishes first. Only then does the run fail. Non-negotiable | Integration |
| BR-9 | `onError: "skip"` is set | The run still fails. `onError` governs a task going wrong, not the board's own bookkeeping ([D2](DECISIONS.md#d2)) | Integration |
| BR-10 | Two tasks' bookkeeping failed in one run | Both reported. The raised error names both rather than only the first | Integration |
| BR-11 | Nothing failed | Byte for byte as today. No new entry, no new failure mode | Existing suite |
| BR-12 | A second batch runs in the same request after one that had a failure | It reports on its own run only. It does not inherit the earlier failure | Integration |
| BR-13 | The report itself fails to be written | It escapes the safety net and the run fails, whatever `onError` says. Never retried, never swallowed — a board that cannot report cannot honestly continue | Integration |

## When the task was handed off to a child run

| # | When | Then | Proved by |
|---|---|---|---|
| BR-14 | A handed-off task's bookkeeping fails the same way | Reported the same way, and the child run fails. There is no batch here and no sibling to protect, so the report needs no deferral | Integration |
| BR-15 | A handed-off task is settled normally | Unchanged | Existing suite |

## What a reader of the stream sees

| # | When | Then | Proved by |
|---|---|---|---|
| BR-16 | A bookkeeping failure is reported | The entry survives the run — it is not a diagnostic breadcrumb. This is the assertion that would have caught the original bug | Integration |
| BR-17 | Someone asks what a given task produced | The failure entry is not in the answer. It is the substrate's, not the worker's | Unit |
| BR-18 | A board is rendered | No extra board card appears, and the completion card is not overwritten | Unit |

## Failure taxonomy

One failure class is fatal to the run and nothing else is: a write that saved the work, or may have, and could not be announced. It fails the run at the boundary after everything else has finished. The report of that failure is the one thing that is fatal *immediately* — it escapes every containment, because a substrate that cannot report has nothing left to be honest with. Nothing retries. A declined write and a parked task are not failures and produce no entry.

## Acceptance criteria this issue owns

A batch in which one task's result is saved and then fails to be announced: every other task completes, the run reports failure, the caller's error names the task, and the failure is on an entry that survives the run. The same holds when the failure is on the error-recording path, and when the task was handed off to a child run instead of drained inline.
