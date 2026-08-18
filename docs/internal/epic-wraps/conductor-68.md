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

**#10 is the measurement worth keeping from this epic.** Not *"we found N bugs"* — a real test
suite, written for that exact code, was blind to four defects simultaneously, and **proximity to a
passing test was actively misleading**.

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

**And the ambiguity rule, three directions across five rounds:** one mutation naming many rows
(round 1) → many mutations consuming one gap (round 3) → many gaps offered for one mutation
(round 6). Each closed correctly when found; each time the next stayed open.

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

## Coordinator errors — 9, and 3 distinct shapes

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

**How they were caught: worker pushback ×4, restraint pass ×1, stale review ×1, POC ×1, self ×2.
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

**Structural closes, where they were reached:** per-run views making a pooled read a *compile
error*, plus a source scan over the grader that fails preconditions on any function taking a
`GradeableView` beside an account-wide value — **guarding the reintroduction path, not just the
current code.** Every other fix this epic was verified against the code as it is; that one against
the code as someone might next write it.

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
