# FIX-1472 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md)

Nothing here is new. Each row is how a recorder behaves **today**, on `main` at `67a3bb9b`, and
must behave identically after the move. Together they are the equivalence matrix: every row is
pinned as a characterization test before any code moves ([PLAN V0](PLAN.md#checks)).

"Saved nothing / saved / can't tell" is the write-correlation answer for a write that threw:
the board compares the row against the baseline it took before writing. A *raising* site is the
hand-off gate and any recorder composed with no wiring; a *deferring* site is the drain.

## The success recorder

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | There is no claim | Nothing is written; renewal stops; it returns | matrix |
| BR-2 | The worker parked its own row for review | Nothing is written; renewal stops; the claim is cleared; it returns | matrix |
| BR-3 | The write succeeds, or is declined by the fence | Renewal stops **after** the write; the claim is cleared; no report | matrix · existing lease tests |
| BR-4 | The write throws and **saved nothing** | The write's own error is rethrown unchanged. Renewal is **still running** and the claim **still set**, because the rescue's fenced fail comes next | matrix · existing lease tests |
| BR-5 | The write throws and **saved** | No release write. Renewal stops, claim cleared, then a report with verdict `committed`. Raising site: throws a recorder failure naming the task. Deferring site: returns quietly | matrix · existing integration tests |
| BR-6 | The write throws and the board **can't tell** | One fenced fail write releases the row (its own failure is swallowed), then as BR-5 with verdict `undetermined` | matrix · existing integration tests |

## The error recorder

| # | When | Then | Proved by |
|---|---|---|---|
| BR-7 | The rescued error is a **report that could not be delivered** | Rethrown at **every** site. Renewal stops. Nothing is written, the claim is untouched, `onError` is not consulted | matrix |
| BR-8 | The rescued error is a **recorder failure**, at a raising site | Same as BR-7 | matrix |
| BR-9 | The rescued error is a recorder failure, at a **deferring** site | Treated as an ordinary worker error: BR-10 to BR-14 apply. A nested board's failure must not abandon this board's siblings | matrix · existing nested-board test |
| BR-10 | There is no claim | Nothing is written; renewal stops; `onError` decides | matrix |
| BR-11 | The worker parked its own row | Nothing is written; the claim is cleared; renewal stops; `onError` decides | matrix |
| BR-12 | The fail write succeeds, or is declined | Claim cleared, renewal stopped. `onError: "fail"` rethrows the original error (a non-Error is wrapped with its message); `"skip"` returns `{ recorded: "errored", error }` | matrix |
| BR-13 | The fail write throws and **saved nothing** | The **fail write's** error propagates, not the original. The claim stays set; renewal stops | matrix |
| BR-14 | The fail write throws and **saved** or **can't tell** | Release first when it can't tell. Then a report. Raising site: throws a recorder failure. Deferring site: returns `{ recorded: "errored", error }` and `onError` is **not** consulted | matrix · existing standalone test |

## Both recorders

| # | When | Then | Proved by |
|---|---|---|---|
| BR-15 | The report itself can't be emitted, or the context has no awaited emission seam | A report-delivery failure propagates from the recorder, after renewal stopped and the claim cleared | matrix · existing integration test |
| BR-16 | A recorder is composed with no wiring | It raises; it never defers silently | existing standalone tests |
| BR-17 | Any path that writes | Renewal stops only after the last fenced write, including the release write | existing lease tests |
| BR-18 | Any path | The persisted entry carries the same fields as today: collection, task, recorder label, verdict, message, and the run stamp where the site supplies one | matrix · existing integration tests |

## Failure taxonomy

Unchanged. A write that saved nothing goes back the way it came (BR-4, BR-13). A bookkeeping
failure after a write saved, or may have, is reported and then raised or deferred by site
(BR-5, BR-6, BR-14). A report that couldn't be delivered is fatal at once, everywhere (BR-7,
BR-15). Nothing retries.

## Acceptance criteria this issue owns

- The baseline, write, classify, release sequence exists once, and both recorders use it. The
  report-then-raise-or-defer tail stays written out in each recorder, where its rule runs.
- The shared step takes no argument that selects an exit rule or raise-or-defer.
- BR-1 to BR-18 pass on `main` before the move and pass unedited after it, and the planted
  controls turn them red ([PLAN V2](PLAN.md#checks)).
