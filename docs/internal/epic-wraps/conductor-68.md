# Epic wrap detail — Conductor, L0–L4 (LAB-68)

Per-instance evidence behind [cycle 6 of the cycle ledger](../cycle-ledger.md#cycle-6--conductor-epic-wrap-lab-68-2026-08-18).
The ledger carries the counts and the conclusion; the enumeration lives here so the
instrument stays scannable.

**Not merged.** [#1327](https://github.com/fixpoint-labs/flow-state-dev/pull/1327) (LAB-133),
[#1325](https://github.com/fixpoint-labs/flow-state-dev/pull/1325) (LAB-136),
[#1332](https://github.com/fixpoint-labs/flow-state-dev/pull/1332) (LAB-134),
[#1334](https://github.com/fixpoint-labs/flow-state-dev/pull/1334) (LAB-135) are stacked and
open at the owner's gate; spec PRs #1320, #1329, #1331 closed unmerged by design (BP-037).
Follow-up filed: **LAB-137**.

**This changes what can be scored, and the limitation is load-bearing.** Cycles 4 and 5 score an
*escape rate* — findings that reached `main` — and nothing here reached `main`. Every count below
is therefore **caught-in-review or caught-by-author**, with an escape column that is structurally
empty rather than measured zero. A reader comparing this cycle's escape rate to cycle 5's is
comparing a number to its own absence. **Re-score after the chain merges**; the ledger entry names
what to re-run.

---

## The dominant class: a check that cannot see what it claims to measure

Cycle 5 named `unrun-claim` and flagged one sub-shape as the one BP-003's first wording missed —
*a green result from a check aimed at a neighbour of the claim*. **That sub-shape is this epic's
main sequence.** Twelve instances, and the epic's own subject matter is the same defect one level
down, which is why they kept being found by the artifacts built to find them.

The unifying property: **the check fails green.** It reports *"fine"* where the honest output is
*"I can't tell."* A blind instrument's green is the most expensive output in the system because it
terminates inquiry.

| # | Where | The check | What it could not see | Caught by |
|---|---|---|---|---|
| 1 | `mirrors-a-coding-run…/run.mts` | asserted over `item.seq` | `seq` does not exist on a persisted item; the array was length 0, so the assertion ran over nothing | POC (measured, not read) |
| 2 | coordinator changeset sweep | "every empty-frontmatter changeset has an empty body" | the frontmatter parser was broken; reported 0 body lines for files with paragraphs. **89 of 104 had bodies, including 3 of the 4 cited** | worker re-ran all 104 |
| 3 | LAB-136 `localize` | substring match | the same shape as #2, found independently by that PR's author | author |
| 4 | LAB-136 | `generate()`-only stub | the nested-formatter capture path never executed | author |
| 5 | LAB-135 precondition 1e | `.includes("permission")` against *"NOT a permission problem"* | **true of every input** — a check that passes regardless of what it examines, inside the layer whose job is catching those | grok pass |
| 6 | LAB-135 guard table | mutation testing the grader | guard cases feed the **grader** synthetic accounts, so no world they build reaches **reader**-side judgement. Author broke it, watched the regression run **green** | author, via mutation |
| 7 | LAB-135 `grader.mts:436` | comparison skipped when `outcome` null | a row claiming `applied` stood on no corroboration — an empty input certifying | codex |
| 8 | LAB-135 `run.mts:1424` | `a0-request-dropped` diagnostic | unreachable on the real entry path; the guard case calls `grade()` directly | codex |
| 9 | LAB-135 `grader.mts:665` | plan ROWS arm selected before `toolCalls === 0` | **`toolCalls === 0` is the condition on every real run** (FIX-1185) — a false green one stray row away, on the path every verdict takes | codex |
| 10 | LAB-134 round 10 | 176-test suite | **blind to all four of that round's defects at once**, two of them sitting beside a test that looked like coverage | author sweep |
| 11 | CI dashboard | `Cursor Bugbot: neutral` | a usage-limit abort rendering beside six passes; **an absence wearing a non-failure's clothes** | coordinator |
| 12 | LAB-135 guard case | selected `streamMutations[0]` | after the fixture grew, index 0 was no longer the mutation its row compares against — the broken world graded clean | the guard table's own branch tags |

| 13 | LAB-135 **A3** | `a3-out-of-order` over `itemIndex` | **the store returns items sorted by the exact field A3 tests.** All three branches dead: the batch query the reader lands on is `ORDER BY request_id, sequence ASC`, the legacy dual-read merge re-sorts on `itemIndex` too, `sequence INTEGER NOT NULL` kills `a3-unreadable`, and 31 items are never short of two positions | codex |
| 14 | LAB-135 **A7** | collection truncation | `STATE_LIST_DEFAULT_LIMIT` is 50 and these runs write **three** rows, so `nextCursor` is never offered, `a7-truncated` needs 200 pages, and `a7-never-read` cannot be produced by `readAccount` at all | the A3 sweep |

**#13 and #14 are the epic's real headline, and they are worse than #10.** *Two of eight assertions
in the Proof certify nothing about the run.* All **30** PASSes contained an A3 and an A7 that could
not have been anything else. What those runs actually certify is **A1, A2, A4, A6 and A8** over the
dispatched run — that is the honest sentence, and it is now the one in `goal.md`'s verdict section
rather than in a limits list where it would read as an edge.

**#10 remains the sharpest single measurement.** Not *"we found N bugs"* — a real test suite,
written for that exact code, was blind to four defects simultaneously, and **proximity to a passing
test was actively misleading**.

**What made #14 findable was the question, not the diligence.** #13 was caught by a reviewer
reading the *storage layer* rather than the check. Generalising that into a procedure — **name the
field each assertion reads, then ask what happens to that field between the writer and the check**
— turned up #14 immediately, and one notch higher turned up a third (the reader's plan-row mapping
drops `lastOutcome`, so A5's ROWS arm is blind to whether a transition settled; named, not fixed).
**Three findings from one question, after eight rounds of review had missed all three.**

**And the disclosure is executed rather than remembered**, which is the part worth copying.
Precondition 1f writes two items out of order through a real store and reads them back: sorted
keeps the disclosure, as-written fails the goal with *"THE A3 DISCLOSURE IS STALE"*. So the
scoping cannot quietly go on under-reporting itself once the store changes. **Its first version
could not fail** — the write path sorts each batch by `item.id`, the author's ids agreed with index
order, so the probe went silent against a read doing no sorting at all. **A blind check inside the
fix for a blind check, caught by its author before it shipped.** The ids now contradict the index.

**#12 is a decay mode, not a defect.** The guard was correct when written and retired silently as
the data around it grew — in the direction of passing. It was caught only because an earlier round
had made every case assert *which branch it reaches*.

---

## `wrong-extent` — a fix aimed at the right defect, covering less than the defect

**Six instances, and the class was named by the author who then hit it four more times.** #1332's
implementer, on its own `confirmedStatus` fix whose first attempt its own test caught:

> *"A fix aimed at the right defect can still be aimed at the wrong extent of it. The test caught
> the extent, not the target."*

Every other class here is about aiming at the wrong **target**. This is the only one about the
right target at the wrong **extent** — and it is invisible to the test you would naturally write,
because that test is written against the target.

| # | The rule, applied correctly | The direction still open | Round gap |
|---|---|---|---|
| 1 | `confirmedStatus` suppressed *while* calls overlap | ordering stays unknowable *after* they settle | same round |
| 2 | overlap metadata, **A settles first** | **B settles first** — the round's own regression test did not reach it | 9 → 10 |
| 3 | reported-ID mismatch on the **success** path | the **in-band refusal** path routes around it | 9 → 10 |
| 4 | null **`outcome`** treated as unevaluable | null **`kind`** still skipped the comparison | 5 → 6 |
| 5 | `orderingUnknowable` suppresses **`previousStatus`** derivation | the **current status** has the same dependence on arrival order | 9 → post-stop |
| 6 | `kind` gap-matching integrated on the **file** side | not on the **plan** side | 5 → 6 |

**And the ambiguity rule, seven directions:** one mutation naming many rows (round 1) → many
mutations consuming one gap (round 3) → many gaps offered for one mutation (round 7) → surplus
gaps on the pathless side, where the bound is an inequality rather than a pairing (named, unreached)
→ **and one caused by repairing the third.** Each closed correctly when found; each time the next
stayed open.

**The fifth is the one that matters, and it is the strongest argument this epic produced.** Round
7's fix failed on *"two or more candidate gaps"* — which counts candidates instead of
distinguishing them. Two attempts at one unkeyable path leave two gaps carrying the same
`rawPath`: **one claim twice, not a choice.** Two of them against two mutations is a valid
one-to-one accounting, and the guard rejected it. *A faithful record, failed by a guard written to
catch unfaithful ones.* Fixed by discriminating on the number of distinct **spellings** — which is
what the row side already used, so it completes the rule rather than adding one — with three guard
cases, *because any one alone would look like a fix*:

```
two interchangeable gaps account for two attempts at one path  ->  a2-ok           (pass)
three attempts at one path and only two gaps beside them       ->  a2-unaccounted  (fail)
two gap rows could each be the one covering a lost mutation     ->  a2-ambiguous-gap (fail)
```

Its author's statement of why this bears on LAB-137, which is better than the coordinator's:

> **"A class that generates instances *from its own repairs* is a stronger argument for structural
> treatment than one that merely recurs — no amount of care at the point of fixing gets ahead of
> it, since the care is what produced the next instance."**

That second clause is the load-bearing one and it was not in the coordinator's framing.
**Diligence cannot close this class by construction**, because diligence is the mechanism that
opens the next direction. Everything else here argues that structural beats remembered on grounds
of *reliability*; this argues it on grounds of *possibility*.

**And the epic tested that claim against me directly, twice.**

**First:** routing the fourth direction, I wrote — and the implementer adopted into `goal.md` —
that *the class entry is the thing that stops the fifth.* **The fifth arrived one round later, out
of the fourth's own repair.**

**Second:** folding that fifth, I declared *"self-inflicted regression is a closed category — one
member, used"* and made it the bar for reopening a stopped PR. **Two rounds later the seventh
direction arrived, and it too was a regression from the same repair lineage** — the interchangeable-
gaps fix compared distinct spellings *per mutation* when reconciliation has to be *global*, turning
a correct-by-accident reject into a false green. The category had two members.

**Third, and the implementer counted one I had missed — my own stopping criterion.** *"Every
remaining finding lives in a branch the real runs do not reach"* was confirmed true, twice, and
then A3 turned out to be reached by every run.

**And the criterion has a second weakness, found on the last finding of the epic: *"unreached"*
conflates two very different things.** A `./ledger.txt` spelling makes the path comparison fail on
faithful state — a *double* false red — and it has never fired in thirty-one runs. But not because
it can't:

> *"It survives on a habit of the driver. The harness dispatches absolute paths and the model has
> echoed them back verbatim every time. That is not a property of the system — it is a behaviour of
> one model on one prompt shape, and it can change without anyone being told. Recorded in those
> terms rather than as 'unreached', because 'unreached' undersells how thin the reason is."*

**Structurally impossible and *no model has happened to do it yet* are not the same claim, and the
criterion treated them identically.** Every entry routed to the limits list on the strength of
*"unreached"* inherits that ambiguity — which is a qualification on the whole stopping rule, not on
one entry. A limits list that does not distinguish them is a list whose entries can silently
promote themselves to live defects when a model changes.

**Three bounds, all falsified, set by three different people who each knew the class was recurring
while they wrote them.** That is the argument LAB-137 should lead with, in the implementer's
words rather than mine:

> **"A count invites *'so fix the rest'* and this does not: the thing that keeps being wrong is the
> belief that the set is enumerable."**

A count argues for vigilance. A record of falsified bounds argues vigilance is the wrong
instrument — a stronger and less comfortable claim, and the only one the evidence actually
supports. The operative rule that replaced my bad one is a **standing obligation, not a cap**: a
defect our own repair introduced folds, however many times that happens.

**And the seventh direction produced a question worth carrying past this epic.** Round 7's rule
failed on *"two or more candidate gaps"*, which rejected the seventh's world **correctly, by
accident**. Round 10 fixed a genuine over-rejection — and removed the accident with it, turning a
right-for-the-wrong-reason reject into a false green.

> **"Does this fix also remove a reject that happened to be right?"**

That is now part of the question when loosening any over-strict check, not a nicety. It is the
inverse of `wrong-extent`: not *did the fix reach far enough*, but *did it reach too far and take
something load-bearing with it.*

**One piece of discipline worth copying, from the same fold.** A gap spelling answering to *no*
mutation was left accepted — it is the sixth direction, already **named in `goal.md`**, and the
implementer declined to close it silently while editing that same function *because doing so would
make the named entry false*. Fixing a documented limit without updating the document is how a
limits list rots into fiction.

That is a **tenth coordinator error and a shape distinct from the other three**: not a rule stated
past its boundary, not a true result applied past its subject, not a rule in the wrong units, but a
**prediction** — a claim about the future that got written into an artifact and falsified by
events. It is also the most confidently wrong thing in this epic, and its wrongness is precise:
generalising a class into prose defends against *forgetting the rule*. It does nothing against a
repair that over-corrects, because the person making that repair is holding the rule at the time.

The implementer corrected it **in place and visibly** rather than editing it away, on the grounds
that *"a file about checks that certify more than they measured shouldn't quietly launder its own
overclaim."* Correct, and the visible correction is worth more to LAB-137 than the original
sentence ever was.

Both are spellings of **an input that cannot determine an answer must not produce one.** LAB-135
now records that as *one class* in `goal.md` rather than as five entries — which is the move that
stops the fourth direction, and it is the only thing here that plausibly does.

**Corollary earned at the last instance:** declining to answer should still report what you saw.
`toolCalls === 0` now reads UNMEASURED regardless of rows, but the message **names how many rows
nothing in the stream evidences.** An UNMEASURED that hides an anomaly is a weaker output than one
that names it.

---

## `inverted-check` — new class, one instance, worse than blind

`reader.mts` mapped `Write` → `created`. A valid `Write` overwrites an existing file, and the
shipped translator prefers the result's `type: "update"` and records `edited`
(`translate.ts:516-528`). So:

> **faithful state FAILED (`a2-kind-disagrees`); a recorder regression labelling the overwrite
> `created` PASSED.**

Every other instance in this epic fails green. **This one fails red on truth and green on the
defect** — strictly worse, because the two symptoms disguise each other: the false red sends you
hunting a recorder bug that isn't there while the real one walks past.

Fixed by making `Write` **indeterminate** — the stream carries no field distinguishing creation
from editing, so the check makes no claim rather than guessing. **Guessing a default is how the
table got there.** Proven both directions: a faithful overwrite must PASS, a mislabelled `Edit`
must FAIL.

**Detection note:** a one-directional guard is structurally unable to see an inversion. This is the
concrete case behind *a fix that encodes a preference needs a test where the two sides disagree*.

**And then the repair for it created a new false green on the same assertion — the fourth
self-inflicted regression, and the sharpest single illustration this epic produced.**

Making `Write` indeterminate was **the most carefully reasoned change in the file**, and it was
right about the stream, which genuinely carries no field distinguishing a creation from an
overwrite. It then discarded something the stream never had and **the harness always does**: the
harness makes a fresh temp directory and seeds exactly one file, so it knows before dispatch which
paths cannot exist. A recorder labelling a creation `edited` passed A1 (kind non-null) and passed
A2 (kind comparison correctly skipped), with nothing left to catch it.

*"Don't guess where the stream is silent"* was always the rule; *"discard ground truth we hold"*
never was. The repair puts the expectation on the `Expectation`, introduced **after** the account
exists — so the deprived reader still never sees it and the inversion the goal rests on is intact.

**Stated narrowly, because the obvious version would false-red:** a path that *existed* can never
read `created` (unconditional); a path that *did not exist*, named by exactly one mutation, by a
call that *applied*, must read `created`. Both qualifiers are load-bearing — a create target
written then edited legitimately reads `edited`, and a failed call created nothing. It shipped with
**three stand-downs that must stay green**, so it cannot degrade into *"any `edited` row on a
create target fails"*.

**This is why the argument is about possibility rather than reliability.** Every other instance
here can be answered with *"be more careful."* This one cannot: it was the careful change.

**And the fifth goes one level higher still — a *correction of an error* created the next defect.**
Early on I claimed *"a shell call makes that path unmeasured."* The implementer refuted it **on
measurement**: a real run reached for `Bash`, was refused, and said so — *a call that never ran
cannot have made the change.* Right, evidenced, and it became the `denied` branch. But the
correction was **silent about the other world**, and its silence became an assertion:
`emitToolResult` collapses `isError` to one `status: "failed"`, so a refused `Bash` and a `Bash`
that ran, wrote the file and exited nonzero are **the same persisted item**.

Three careful steps, none of them a mistake at the time. My first instinct was right about a case
the correction did not cover; the correction was right about the case it was shown. The
implementer's summary is the sharpest form of this wrap's whole argument:

> **"Every other entry is *a repair created the next defect*; this one is *a correction of an error
> created the next defect* — the same argument one level up, at the level where the reasoning
> happens rather than where the code does."**

**And the fold's third guard is the epic in miniature.** Having made the arm UNMEASURED, it
removed the aggregate `unmeasured` increment and re-ran, to check that removal would be caught:

```
"A1 — every path unknowable because no shell call completed"
  did not reach A1/a1-all-unmeasured with a fail; it produced
  ["a1-missing-shell-unknowable=unmeasured", ×3]
```

**A run that measured nothing, coming back green with three polite notes.** The increment is
load-bearing rather than tidy — proven, not asserted, inside the fix for the class it belongs to.

`goal.md`'s class entry now leads with this lineage instead of the count.

**The sixth belongs to no single repair, which is why it is a different kind of member.** Comparing
tied candidates by serialized identity rather than by verdict only became wrong once a `null` kind
meant *no claim* — **two repairs, both right, one defect between them.** Five entries each trace to
one repair; this one traces to the seam between two. The count is **six** and stops there.

**A seventh was proposed and rejected on analysis, by the implementer, against the coordinator.**
Round 12 found that a fresh target written twice, recorded `created`, passed both A1 and A2 — the
check certifying the exact recorder regression its harness ground truth was added to catch. I
routed it as a probable seventh. It is not one: **before the ground-truth fix that world passed
too**, because nothing compared a row's kind against what the harness knew. The repair improved one
direction and left the mirror unwritten. That is the **half-applied rule** — the oldest class in
this file — landing on a repair a single round old, not a new member of the newest class.

---

## The closing exhibit — a principle, and its own twin, three lines apart

**Round 13 is the best single illustration this epic produced, and it was found after the work had
stopped.** The ground-truth check reads:

```
if (existed && entry.kind === "created")            -> a1-kind-impossible   (no outcome guard)
if (!existed && entry.kind !== null) ... && naming[0].outcome === "applied"
```

Between them sits the author's own statement of the rule: *"a call that failed created nothing.
Asserting past either would fail faithful state, which is the failure mode this whole file is
about."* **The principle is written in a comment, and applied to one of the two branches it
governs.**

It is reachable. `translate.ts` maps `["Write", "created"]` at call time and falls back to that
kind on failure — its comment says so outright: *"fall back to the call-time kind when it reports
nothing — including on a failure, where there is no outcome to read a kind from."* So a failed
`Write` against a seeded file produces `kind: "created"`, `outcome: "failed"` — **faithful state,
recorded exactly as designed, failing A1.** Verified on both sides directly rather than relayed.

**Not folded, and that is the deliberate call.** Fixing it would improve one prototype's grader by
one clause and delete the clearest evidence the epic has. A rule half-applied *three lines from
where its own principle is written down* is not an argument that people should be more careful — it
is the argument that care is not the mechanism. It goes to LAB-137 as the exhibit, not to a
fourteenth round as a patch.

---

## `false-red` — the check rejects faithful state

Counted separately from the blind class because it fails in the direction that wastes time rather
than the one that lies — #1334's author, round 1:

> *"A false red on a correct record is as bad as a false green — it just fails in the direction
> that wastes time instead of lying."*

| Where | Faithful state it rejected | Consequence if shipped |
|---|---|---|
| **A2 vs aggregate rows** | any run that edits a file it wrote, or retries | **the check's viability.** The recorder stores one aggregate row per path by design; a plain write-then-edit made the goal go red. 19 PASSes happened because no graded run touched a path twice — **the 20th would have failed** |
| plan `a5-lost` | a failed `TaskCreate`, which the translator deliberately never records | faithful behaviour graded as recorder loss |
| cross-run pooling | two requests touching one path in a reused workstream | every correctly-namespaced row read as named twice |
| LAB-136 anchor guard | over-rejected twice, in two opposite directions | **reverted entirely** |

**The write-then-edit instance produced this epic's most important qualification**, now stated in
`goal.md`, the PR description, and Linear: *the earlier PASSes were partly luck of the fixture.*
They remain real — those runs were faithful and the check verified them — but the claim's breadth
was wrong, not its truth. **That distinction had to be drawn four separate times this epic** and is
the one most likely to be flattened by anyone summarising it.

---

## `fixture-gap` — the deepest class, and the one nothing else catches

Two instances, both in LAB-135, both found only when a reviewer proposed a world the fixture could
not produce.

> **A state the fixture does not carry is a state any rule about it can be wrong about
> indefinitely** — invisibly, while the log fills with green.

`known-state.json` had never contained a repeated touch, so no rule about repeats had ever been
exercised. The repair went into the **fixture**, not only into a guard case: it now writes
`alpha.txt` and then edits it, and reintroducing the old rule reports `CALIBRATION FAILED` before a
coding run is spent.

**This generalises the epic's reachability lesson one layer out.** Earlier instances: a *guard*
that cannot reach the code it guards. This one: a *fixture* that cannot produce the state the rule
is about. **The fixture version is harder to see because nothing looks missing** — the rule exists,
the guard exists, the test passes. `goal.md` now states the general form: **when a finding is about
a *state*, the fix belongs in the calibration pair.**

---

## Coordinator errors — five shapes, and how they were caught

Recorded because the coordinator ran the same defect classes it was routing.

**Shape A — a rule stated past its boundary (5).** Correct at the altitude of what *should* be
true, wrong where it meets an implementer: flush-at-end (a run cancelled after a write flushes
nothing — *the runs whose file record matters most are the ones that don't finish*) · empty-plan
hard fail (overrode a VOID arm the worker had **already measured** failing 2 of 4 runs) ·
canonicalize-to-checkout-root (produced `../…`; `normalizeResourcePath` throws; **a false red
reading exactly like a broken recorder**) · gap-visibility assumed to exist · an exemption that
also excuses a row that is present and wrong.

**Shape B — a true result applied past its subject (1).** LAB-135's round-4 structural close was
real; I read *"the pooling class is unwritable"* as *"the check has converged."* **The claim was
about the class; I applied it to the file** — and round 5's four findings were all in code round 4
had just written. The worker's form of it:

> *"A structural close covers a class, not a file, and never code written after it."*

**Shape C — a rule stated in the wrong units (1).** *"Round 6 is the last round"* when the stop
condition I had written was a criterion. Attaching it to a round number implied the two coincide.
They don't.

**Plus:** asserting `status` is never persisted (the contradicting line was **in my own grep
output** and I read the row that agreed with me) and inventing precise timestamps in coordinator
state. Both are the epic's own defect family, committed by the coordinator running it.

**Shape D — a plausible mechanism handed over as a lead (1), and the guardrail is the whole
lesson.** Finding A3 inert, I checked whether a real fix existed and found what looked like one:
`request_events` is written and read by its own `sequence_number`, **not** by `itemIndex`, so the
event stream should be an independent witness of item order. I passed it to the worker **explicitly
as a lead, not a finding**, with instructions to check the world could be produced first.

**It was refuted, with measurement.** The events *are* a genuinely independent surface — but not of
*this* property: `itemIndex` is reserved at item **construction** (`emittedItemCount++`), while the
event sequence is assigned later at **emission**, with awaits between. A faithful model-free run
produced `item.added` events carrying `0,1,1,3,2,3,4,7,5,6,7,11,8,13,9,15`. **Routing A3 through
the event log would have failed ordinary faithful state on every run.** A second sufficient reason
sat underneath: an empty log falls back to `buildReplayEvents`, which reconstructs from
`record.items` and is `itemIndex`-sorted again — *the same tautology one level down.*

**So the coordinator's fix for a blind check was a false red on every run.** The only thing between
that and defect #4 traceable to one of my folds was labelling it a lead and demanding it be
verified before it was built. **That labelling is doing more work than any rule in this document** —
the mechanism was plausible, I had just read the code, and I was the most confident I had been all
epic.

**Shape E — a finding classified before it was analysed (1).** Round 12's defect confirmed exactly
as reported; **my classification of it did not.** I routed it as a probable seventh self-inflicted
regression and the implementer showed it was a half-applied rule, on the test that a regression
requires a repair to have made something worse. I had also written that holding the count was *"the
fourth time holding was right"* — it was not: six was correct when first offered, and this finding
never threatened it. **The policy held while the justification for it was refuted.** Fifth refuted
prediction of the epic, after the `request_events` ordering lead, *"the class entry stops the
fifth"*, *"self-inflicted regression is a closed category"*, and *"round 6 is the last round"*.

The implementer's framing is better than mine and is why this is its own shape rather than a
variant of A:

> *"Classify-before-analysing is the file's oldest class seen from the process side — a rule applied
> at the wrong extent, where the extent is how much you know yet."*

**That symmetry means the structural recommendation is not only about code review.**

**How they were caught: worker pushback ×6, restraint pass ×1, stale review ×1, POC ×1, self ×2 —
no total stated, see Counting.
Never by re-reading my own message.**

---

## The stopping problem — and both halves of the rule

#1332's implementer proposed the criterion that ended it, and it survives its own counterexample.

**Concept novelty per round** says when the *learning* is done. Rounds 6→8 each needed fewer new
concepts; the grain bottomed out at per-call. **This was true, and I accepted it as a stop.**

**Instance arrival rate** says when the *work* is done. Round 8: 3. Round 9: 4. Round 10: 4.
Post-stop: 3. **Never decayed.** Its closing line:

> *"The counts were sitting in the verdict log the whole time."*

The series that would have shown non-convergence was recorded every round by both parties and read
as a log by neither. **An artifact that accumulates a number every round is a trend nobody sees
until someone plots it.**

**The resolution:** #1332 stopped at round 10 with the remainder filed as **LAB-137** — not *"fix
these three"* but *the confirm-only-what-the-harness-confirmed invariant must be structural rather
than per-call-site.* The instance space is large and a reviewer was enumerating cells one review at
a time; only making the wrong shape unwritable terminates that.

**Qualification the author insisted on, against a tidier story:** three of the last four findings
did **not** fall inside the `field × surface × presence` grid the class was described by, so the
grid's cells are named but **its axes are not closed.** LAB-137 inherits that caveat.

**#1334 stopped on a different criterion**, because it is a Proof rather than a mechanism: *every
remaining finding lives in a branch the real runs do not reach, and those branches are named in
`goal.md`.* Confirmed true at `2a6c3892b`. Satisfiable, unlike *"a round that finds nothing in the
previous round's code"* — which requires a wasted round and a reviewer running dry.

**Then four more findings arrived on the next commit, and that is the finding.** Each was genuinely
unreached by the graded runs, so the criterion sentence stayed true — but **the named-limits list
is not a closed set and was never going to be.** A reader who takes it as exhaustive repeats the
coordinator's Shape-B error at one remove. The list is *what we currently know we do not check*,
which is a different and much weaker claim than *what we do not check*.

**A coordinator pattern worth naming against itself:** by that point I had declared a last round
three times and extended past it twice. Each extension was individually defensible — a core-path
defect, then a false red that would have fired on ordinary runs. **Three is not a stopping rule; it
is a preference for one more fix wearing a rule's clothes.** The third extension was therefore
bounded to a single *subtraction* (a vestigial `topLevelTools` count that no assertion reads and
that fails faithful delegated runs), with the instruction to **name it rather than fix it** if it
turned out not to be a deletion.

---

## The objective was a blind check, and nothing in the process could say so

**Written after the owner asked why this was the most important thing to build. It is the largest
finding in this file and it is about the epic, not the code.**

The Proof we gated on: *"a real coding run is reconstructed from FSD state alone, without reading
the harness transcript."* Apply this file's own test to it — **name the world in which it fails.**

It fails in exactly one: recording is broken. **It does not fail in the world where the recording
is perfect and worthless.** So it could not distinguish "this was worth building" from "this was
not," and it returned PASS thirty-four consecutive times without ever being able to speak to the
question. That is the dominant class of this epic — *a check that cannot see what it claims to
measure* — sitting in the objective, one level above the fourteen instances catalogued below, and
nobody caught it because everything downstream was busy passing.

**The evidence was in the artifact the whole time.** The most valuable thing this epic produced is
this document: refuted beliefs, discovered constraints, classified errors. Every line of it came
from reasoning and argument. **Not one line came from a file-operation record.** The machinery we
built could not have written the output we are proud of, and both were produced in the same room
without anyone noticing they were unrelated.

The Outcome line named three things — *"which files it changed, what it thought its job was, where
it stalled or failed."* The first is the weakest and took thirteen review rounds. The third is the
strongest and took almost none. **In the graded run, 33 items; 4 were file mutations.** The rounds
went to the 4.

### The process gap

**The objective is gated exactly once, at the moment of least information.** Everything after it is
scope-cutting *inside* the objective — the restraint pass cuts issues, never the goal. There is no
step that re-asks *"is this the right thing"* at the point we know most, and the Proof's blindness
guaranteed nothing would ever force the question: a green light every round is indistinguishable
from a green light that means nothing.

**Smallest upstream fix — the guard-table clause, applied one level up.** Every guard case on
#1334 had to name the world it fails in and carry a neighbour that must pass. We never asked that
of the Proof itself. So:

> **A Proof line must name the world in which it fails. If the only world is "the mechanism
> broke", it is a capability check, not a proof, and it cannot tell you whether to continue.**

And one re-ask, cheaply placed: **when the first issue's goal check passes**, re-answer the Proof
question once — that is the first moment real evidence exists about what the work actually yields,
and it is early enough to change the remaining issues. Not at the wrap, which is too late to steer.

---

## Counting — computed, appended, remembered

**Found by counting rather than reading, which is why it was missed for eleven rounds.** Sweeping
`goal.md` for quantities turned up **seven stale counts** in its narrative body, against a file
whose entire argument is that remembered rules rot.

Three populations of number in one document, and only one rotted:

- **Computed** — the runtime evidence line reads `GUARD_CASES.length + ACCOUNT_CASES.length`. Right
  at every value from 53 through 81, never touched.
- **Appended** — each verdict-table row froze at write time. *67 guards* at `74d628367` is still
  correct **for that row**. Never touched.
- **Remembered** — seven drifted.

**Fixed by subtracting, not updating**: *"every guard case"*, *"every PASS in the log below"*,
*"unproduced by any graded run"*. Correcting a remembered number by remembering harder resets the
drift clock; removing it stops the clock. The narrative body now carries no quantity at all.

**Three instances of the class landed inside the round that was correcting it**, which is the part
worth keeping:

1. One count (*"answered thirty-three times"*) was **independently verified as current by the
   coordinator**, and went stale before the round finished — the thirty-fourth run happened while
   the correction was being written. *Verified current* is a claim with a shelf life.
2. The implementer's hand-count of `ACCOUNT_CASES` returned 4, because the grep caught
   `because: string` in the type annotation. **The computed number was right and the human count
   was wrong, on the first try, in the round whose subject is that.**
3. **This section of this file carried three disagreeing totals of its own** — the heading said 9
   coordinator errors, the enumerated shapes summed to 8, the catch-attribution summed to 10. Found
   while correcting the same defect elsewhere. **The totals were removed rather than reconciled**,
   on the rule above.

**The levels kept going**: guard → fixture → store → the scans written to close two classes → the
prose describing all of them, which nothing checks at all.

---

## What actually worked

**The 53→64-case guard table, run pre-dispatch.** Every addition after the first came from a
mutation that stayed green. It hard-stops before a coding run, so five rounds of regressions cost
no model call. Its author's summary:

> *"The only defence that survived contact is the one that isn't a rule at all."*

**Rules got half-applied six times. The table never did — because it isn't remembered, it
executes.** That is the epic's argument for structural-over-remembered, and it rests on three
unprompted saves — the green mutation in round 3, the index decay in round 8, and the dead
requirement below — rather than on argument.

**And the table's *gaps* turned out to be a diagnostic nobody designed.** The last finding of the
epic was a non-empty guard requiring `toolOutputs > 0` at top level, which failed any run that
delegated its file work to a sub-agent — while `readAccount` scans every item *specifically* so a
delegating run reads correctly. **A requirement contradicting a derivation two assertions away.**
The fix was a deletion: the count had exactly one reader in the grader, that row, and A6's claim is
*no assertion read an empty set* — so a count belongs in it only if some assertion reads that set.
This one never did. Its author's note is the transferable part:

> *"It was also the only entry in the table **no guard case had ever watched fail** — which is what
> a requirement nothing needs looks like from outside, and I should have noticed that."*

**A requirement no guard case has ever watched fail is a candidate for deletion.** The table finds
defects by what it catches and finds dead weight by what it never exercises, and the second use is
free once the first exists. It also sharpens the *keep* case: the count stays on the view because
the evidence line prints it — **describing a run is not requiring something of it**, and
conflating the two is what put the row there.

**Structural closes, where they were reached — and the two are not equivalent, which I stated
wrongly and am correcting here.**

- **Per-run views making a pooled read a *compile error*.** Genuinely structural: the wrong program
  does not typecheck, and no spelling gets around it.
- **A source scan over the grader** that fails preconditions on functions taking a `GradeableView`
  beside an account-wide value. **This is a regex over text**, and review found two ways past it —
  the per-run scan is declaration-only, so an arrow function is never examined; the cross-surface
  scan requires the literal identifiers `entry` and `mutation`, so an alias or a destructure slips
  by.

**A "structural" guard implemented as a regex is a remembered rule enforced by a spell-checker.**
It catches the shape its author thought of. That is the failure this document describes six times,
now aimed at the guard written to end it — and I compressed both closes into one sentence as
though they were the same kind of thing, which is the overclaim, not the implementer's description.

The distinction survives: **the type-level close does guard the reintroduction path.** The scan
guards it only as currently spelled, and moving it to an AST- or type-aware check would put it in
the same category as the close it supplements. Recorded as a named limit rather than fixed, since
both holes need a future author rather than a run to reach them.

**Cross-issue evidence beat coordinator arbitration, twice, unplanned.** LAB-135's nine UNMEASURED
plan verdicts independently confirmed LAB-134's 8-of-8 plan-tool finding by a different reader on a
different route (both → FIX-1185); LAB-134 then shipped a `kind` field because LAB-135's check
needed it to stop being a counting bound. Neither was designed.

**A green mutation is information, never reassurance.** Round 3 read it as *the guard is blind*;
the `stop()`/gap investigation read the same signal and found *the reported defect is not there* —
an undocumented ordering invariant (`drain` runs the record collections before gaps) made the race
impossible. **Nothing distinguishes the two except going and looking directly.** The invariant now
has a test.

---

## Framework gaps filed

| Issue | What it names |
|---|---|
| FIX-1183 | a goal check can report PASS while asserting over zero evidence; extended with the monitor-timeout and mutation-reachability cases |
| FIX-1184 | grade structured fields, not substrings — five manifestations |
| FIX-1185 | the in-process SDK path never invokes plan tools; the same binary via the CLI does. Confirmed independently by two issues |
| LAB-137 | confirm-only-what-was-confirmed must be structural, not per-call-site. Carries the family, the axes, the arrival-rate table, and the two places the structural move already worked |

## Infrastructure

**Kitchen-sink E2E stalled twice** (~10 min in *Install Playwright browsers*, tests never ran,
`cancelled`), on branches whose diffs touched only `goals/`. An escalation was armed on a third
occurrence. **It did not recur** — subsequent runs completed in 1m38s–2m21s. Recorded because an
armed tripwire that quietly never fires is indistinguishable, months later, from one that was never
armed: the next person to see this stall is seeing a **third**, not a first.

**Cursor Bugbot exhausted its usage budget mid-epic**, account-wide. Both live PRs lost a reviewer
for the remainder. Its contribution had been the *grok pass* class — doc and comment drift, state
trims, one design endorsement — largely readability rather than defects, so no round was held for
it. **But that is an unreviewed dimension, not a cheaper review**, and its abort renders as
`neutral` in the checks list (see blind-check #11).
