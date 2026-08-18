# harness-workstream › it reconstructs a run from state alone

**Issue:** LAB-135

**Outcome:** Hand someone nothing but this system's stored state — no harness transcript, no
working tree, no git — and they can say what a coding run did: which files it touched, how each
turned out, in what order, what it said, and what it thought its job was, or that it kept no
plan and why we can tell. If that account does not hold up against the job the run was given,
the layers built on top of this state have nothing to read.

**Input:** `fixtures/input.json` — the workstream topic, two files the run is asked to create,
one existing file it is asked to edit, and how many to-do items to keep. Held out twice over:
the reader never sees any of it, and the grader receives it only after the account exists. A
different valid fixture must still pass a correct implementation. `fixtures/known-state.json`
and `fixtures/known-account.json` are the calibration pair — a state the routes could really
return, and the one account a correct reader derives from it.

**Signal:** Eight assertions, each of which must fail or declare itself unmeasured when the set
it reads is empty.

1. Every held-out path appears with a recorded kind and a **settled** outcome (`applied` or
   `failed`; `pending` and absent both fail) — or, absent and with a shell call in the run, is
   named **unmeasured for that path**
2. Every mutation the item stream shows and the file record lacks is accounted for by a gap row
   **carrying that path**; a difference nothing accounts for fails, and so does a record row the
   stream never showed. Where the two DO pair up, the record must agree about what happened —
   an `Edit` stored as `created`, or a failed call stored as `applied`, fails. A row is an
   **aggregate** — one per path, folding every call on it, last settlement winning — so several
   mutations naming one row is ordinary, and the row is compared against the **last** of them.
   Several *different paths* matching one row is an ambiguity, never a match, and so is a
   terminal call that cannot be identified
3. Order is non-decreasing over `itemIndex` across at least two distinct positions, over **every
   item the request holds, sub-agents included** — the set the positions assertion 4 compares are
   drawn from, and the set the claim names. **Structurally satisfied on the real path**: the store
   returns the item list sorted by `itemIndex`, so this proves ordering only against a state that
   is handed in. See the verdict section before reading a PASS here as evidence about a run
4. The run's **last** file mutation precedes its final report — a write after the closing word
   leaves a row in the record the report never covered. A **tie** is unevaluable, not a pass:
   `itemIndex` carries duplicates, so equal positions say nothing about which came first
5. The plan half resolves to rows, or to UNMEASURED with its reason named — never to LOST. Judged
   **per run and worst-first**: one run that fired the plan tools and lost every row is our bug,
   and a sibling that recorded fine does not outvote it. **A run that invoked no plan tool is
   UNMEASURED whatever rows exist** — rows with no call behind them are reported, not certified,
   which is the same reading the predecessor goal's truth table already used
6. Every set an assertion iterates is non-empty, failing by name
7. Every `nextCursor` was followed, on all three collections. **Structurally satisfied on the real
   path** for the same reason in a different layer — the route pages at 50 and these runs write
   three rows, so no cursor is ever offered to follow
8. The reader's own source imports nothing but the collection accessor keys

Two arms report rather than fail, and neither may pass silently: assertion 5's UNMEASURED, and
assertion 1's per-path unmeasured. If **every** expected path lands unmeasured the run proved
nothing and the goal is inconclusive, which is a failure.

**A per-run judgement cannot reach a pooled value — structurally, not by filtering.** Five
separate defects were one sentence: a pooled value consumed inside a per-run judgement, so one
run's evidence excused another run's absence. Each was fixed by scoping the read, and the next
review found another. The account is now a **list of per-run views**, and every per-run assertion
is handed one view — the other runs are not in scope, so a pooled read is a compile error rather
than an oversight. The reader partitions; only the entry point sees across runs, and it makes no
per-run claim. The boundary is itself scanned over the grader's source, because a guard that
cannot reach the code it guards looks exactly like one that passes.

**Every exemption is tied to the specific thing it excuses.** A gap row covers *this* missing
record — not any missing record, not another run's, not a different kind of skip. So gaps are
**consumed** one-to-one rather than matched (one gap excuses one loss, because the recorder writes
one row per unrecordable mutation); a pathless skip answers only to a pathless gap **in its own
run**; and the plan arm is judged per run. An exemption that isn't tied to its case is a blanket
amnesty the account's own noise can satisfy.

**A pairing that is not unique is not a pairing.** The two surfaces spell a path differently, so
they are compared by whole trailing path segments rather than by re-implementing the recorder's
canonicalization — which would couple this check to a storage-key layout that is not a contract,
and which already gained a segment mid-build. The cost: when one side is short, the comparison can
be true of more than one candidate. No caller resolves that. The reader leaves the derived path
and position null; the grader fails by name. A wrong assignment would let assertion 2 pass while a
mutation record is genuinely missing, which is the exact failure it exists to catch.

Pairing is scoped **within a run**. A workstream is reused, so two requests touching the same
path each name it — matching against the combined set would read every correctly-namespaced row
as ambiguous and fail a faithful record. A false red is as bad as a false green; it just fails in
the direction that wastes time rather than lying.

**Anti-game:** Must not read the harness transcript, the working tree — including any file the
run wrote — or git. The reader's deprivation is a **parameter shape**: its only input is a bound
route reader, and assertion 8 checks that mechanically over its own source rather than trusting
it. Must not grade whether the run did a **good** job: no assertion on the run's prose, on any
file's contents, or on whether the change would compile — the grader's parameter type removes
the run's words, so reaching for them is a compile error rather than a rule to remember. Must
not assert **how the run was settled** (a stated gap, FIX-1182). Must not search the stored
state for a value it already holds: the account is derived before the expectation is introduced,
which is the whole difference from the two checks that came before. An account that comes back
empty is a FAIL that names which emptiness it hit.

**Model:** real — the Claude Code Agent SDK resolves its own model; the flow declares no
generator actions. The calibration and every guard case are **model-free** and run first.

**Run:** `pnpm tsx goals/harness-workstream/reconstructs-a-run-from-state-alone/run.mts`

## The preconditions, and why they run every time

The reader derives the known account from the known state **exactly**, a deliberately lossy copy
of that state is caught by assertion 2, and every guard case breaks one assertion on purpose
and confirms it reaches the verdict it is supposed to. All of it is model-free, so it runs on
every invocation rather than sitting in this log as a one-time claim — and if any of it fails,
no coding run is dispatched at all. An instrument is sanity-checked against a case whose answer
is known before its sweep is trusted.

**Two preconditions check the FIXTURE rather than the code**, because the fixture is what holds
open the sets the reader derives, and a fixture can retire a check silently. It must hold two
runs (so the per-run partition is exercised) and a positioned sub-agent item whose position
reaches the ordering set (so assertion 3's scope is exercised). Delete either from the fixture
and a precondition says so instead of the coverage quietly disappearing.

**And the fixture's own contents are a claim about coverage, which is where two findings landed
rather than in any assertion.** A state the fixture never contains is a state no rule about it
was ever tested against — that is how assertion 2 came to reject a run that edited a file it had
written, for nineteen green runs. The repeat-touch world is now in the fixture; so is the
sub-agent ordering. The lesson is the general one: **when a finding is about a state, the fix
belongs in the calibration pair, not only in a guard case.**

**The broken world is handed in rather than provoked**, and that is the point. Mutating a grader
and re-running a real check has a blind spot congruent with the defects it is meant to catch: a
mutation inside a branch no run reaches never executes, and *"the mutation was rejected"* and
*"the mutation never ran"* produce the identical green. This goal is full of such branches by
construction — the plan half's ROWS arm never executes on this driver, and most of assertion 2's
broken worlds cannot be produced by a correct system at all. So each case follows three steps,
not two: name the broken world · check the assertion rejects **that** world · check the world can
be produced at all.

**Cases exist because a mutation did not go red**, which is a result rather than a formality:

- Whole-segment path matching was unreachable until `known-state.json` gained `my-alpha.txt` — a
  still-pending row whose name ends with `alpha.txt`. Until then a naive `endsWith` derived the
  identical account.
- Assertion 6 read the account's own counts, which can drift from the arrays assertions 1 and 2
  iterate. It now sizes those sets from the arrays themselves, and a case pins the disagreement.
- Assertion 4's two can't-tell conditions sat in one `if`. Deleting the missing-report half left
  the ordering comparison to handle it, `firstToolOutputAt > null` coerced to a comparison
  against `0`, and the resulting failure satisfied a status-only guard perfectly — **the guard
  reported itself proven while the branch it names had been removed.** Every finding now carries
  a stable branch tag, and every guard case asserts on it.
- Assertion 1 treated any shell call as grounds to call a missing path unmeasured. A real run
  reached for `Bash`, was **refused**, and said so — a call that never ran cannot have made the
  change, so counting it would have turned a lost write into an inconclusive. Only a shell call
  the harness actually ran softens the verdict now.

- Assertion 2 accepted a path pairing without comparing what happened, so a record saying
  `created` about an edit passed. Both halves of that are defects the recorder actually shipped.
  The comparison is **preference-shaped** — it only has teeth where the two sides disagree — so
  its cases carry a real disagreement rather than a merely well-formed record.
- Assertion 4 compared the report against the run's *first* activity, so `write, report, write`
  passed: it rejected the world where all activity follows the report and accepted the one where
  only some does. It now grades the last mutation.
- **Assertion 8's verdict was final before dispatch and was not in the pre-dispatch gate**, so a
  reader with a forbidden import spent a full model-backed coding run to return a failure already
  computed. **Not a correctness defect — the verdict was right either way — and it is listed here
  rather than as a limit because what it costs is a run, not an answer.** It is wrong-extent on
  the *gate*: that gate exists for one reason, never spend a run the goal cannot pass, and it left
  out one of the failures it already held. Every other member of this class has been a rule
  half-applied to code; this one was half-applied to the mechanism that protects the budget.
- Assertion 8 checked module specifiers only, and `process.cwd()` names no module. It now also
  scans for bare globals and computed dynamic imports, over the shared `paths.mts` as well as the
  reader.
- **The tool table asserted `Write` means `created`, which made the check inverted.** A `Write`
  over an existing file is an edit, and the recorder knows it — it prefers the harness's reported
  `type` and falls back to the tool name only when none is reported. So faithful state FAILED and
  a recorder that mislabelled an overwrite PASSED: red on truth, green on the defect, each symptom
  disguising the other. `Write` is now indeterminate — the item stream carries no field that could
  tell creation from editing, so it makes no claim. The teeth live on `Edit`, which is
  unambiguous, and both directions have a case.
- A pathless mutation's stream POSITION was dropped along with its path, so a write the recorder
  could not key could land after the closing report while assertion 4 compared only the keyed
  ones and reported that nothing followed it.
- A failed `TaskCreate` was counted as a plan call that should have produced a row. The translator
  records nothing for it because nothing was created, so it is a visible failure rather than a
  lost row — another false red on faithful behaviour.
- A request whose id cannot be read was dropped by control flow, and nothing downstream learned it
  existed. Found by sweeping the code the previous round had just written.
- Assertion 2's gap exemption, as originally specified, could disguise a corrupt row: a gap
  explains a mutation the collection is **missing**, and does not license a row that is present
  and wrong. Partial handling made incomplete handling look complete. The branch order now checks
  the row first, and a case builds that world so a later reorder cannot reintroduce it.
- Assertion 2's reverse direction read a count the reader had computed beside the array. It now
  recomputes from the array, the same rule assertion 6 already follows.
- Assertion 4 treated a **tie** as evidence of order, so a report sharing a position with the last
  mutation was certified as following it. The POC had already measured `itemIndex` carrying
  duplicates — the assertion was built on top of that finding and then ignored it.
- Assertion 2 paired across the whole workstream rather than within a run, which would have failed
  a faithful record the moment a reused workstream held two requests touching one path.
- Assertion 2 matched a gap without consuming it, so a single gap row excused two mutations that
  had both been lost.
- Assertion 2's pathless branch counted the account's gaps globally, so an unrelated plan gap,
  another run's gap, or a named-path gap satisfied it — passing with no evidence that its own skip
  was recorded.
- The plan arm was combined **in the reader**, where the guard cases — which feed the grader
  synthetic accounts — could not reach it. Regressing it to pooled rows ran green, and that green
  is what moved the judgement to the grader. The reader observes per run; the grader decides.
- **Assertion 3 measured a projection of the set it named.** The claim was that the request's
  stream is ordered; the check read the top-level thread, so `message@0, owned Write@3, owned
  Read@2, message@4` passed while the request's own index sequence went backwards — and the
  positions assertion 4 grades were drawn from the whole set all along. The ordering set now
  covers every item. This one is reader-side, so **no guard case can reach it**: the pin is a
  precondition that requires the calibration fixture to carry a positioned sub-agent item and
  that item's position to appear in the derived set. Both of its branches were watched red.
- **Assertion 2's gap exemption could be satisfied by an ambiguous gap.** One relatively-named
  mutation with no record row and two gaps whose paths both end in it: `findIndex` took the first
  and reported the loss excused. That is the third direction of one rule — one mutation naming
  many rows (round 1), many mutations consuming one gap (round 3), many gaps offered for one
  mutation (round 7). Each direction was closed correctly and the next stayed open.
- **Assertion 2 rejected a run that edited a file it had written**, and this is the one that
  would have fired on ordinary work. A record row is an AGGREGATE — one per path, folding every
  call on it — but the check demanded one mutation per row and read a second as an unresolvable
  pairing. A plain write-then-edit, or a retry, is faithful state this check called a defect. The
  fixture now carries the repeat, so the false red is caught by the calibration itself rather
  than by anyone remembering: reintroducing the rule reports *"the grader reports 1 failure(s) on
  a state whose account is correct"* before a run is dispatched.
- **Assertion 2 rejected two attempts at one unkeyable path** — the ambiguity rule's fifth
  direction, and the only defect in this file **created by one of its own repairs**. Round 7's
  fix failed on two-or-more candidate gaps; two attempts leave two gaps carrying the same
  `rawPath`, which is one claim twice rather than a choice, so a valid one-to-one accounting was
  read as unresolvable. The discriminator is now distinct spellings, exactly as it is on the row
  side, and consumption stays one-to-one so a shortfall still reports the loss. Both directions
  have a case: the interchangeable world must pass, and the two-different-paths world must still
  fail, because "stop failing on two candidates" would otherwise look like a fix.
- **Assertion 6 required a top-level tool call, and a run that delegates has none.** Activity is
  scanned over every item of the request specifically so a sub-agent's file work is read
  correctly — and then A6 failed that same run for "reporting without doing anything". A
  requirement contradicting a derivation two assertions away, and the fix was a **deletion**: no
  assertion iterates top-level tool outputs, so the count never belonged in a claim about sets
  assertions read. It was also the only entry in that table no guard case had ever watched fail,
  which is what a requirement nothing needs looks like from outside.
- **Assertion 5 certified plan rows that no plan call evidenced.** The ROWS arm was selected on
  `rows.length > 0` alone, and `toolCalls === 0` is the condition on **every real run**
  (FIX-1185) — so the one thing standing between the graded path and a false `a5-ok` was the
  absence of a spurious row. `toolCalls === 0` is now decided first, and reads UNMEASURED
  whatever rows exist, which is what the predecessor goal's truth table already said.

One masking relationship among the preconditions themselves was removed for the same reason: a
failed lossy-calibration used to return early and hide the entire guard table. All preconditions
now report together.

## What is closed by construction, and what is still a grid

Eight review rounds produced 23 reported findings. The concepts stopped being new around round 3;
the **instances never stopped arriving** — 3, 2, 3, 3, 4, 4, 2, 2 per round. Those are different
questions, and only the second says whether the work is done. Recording both is the point of this
section.

**Round 11 kept the arrival rate up and moved where they arrive from**, which is the more useful
half. Seventeen findings: two assertions that cannot fail on the real path (3 and 7), a field the
reader drops before the grader sees it (`lastOutcome`), a successful create whose lost row leaves
no trace on either surface, the ambiguity rule's sixth **and seventh** directions, a pre-dispatch
gate missing a failure it already held, an A2 branch that reports the stream showed no mutation
when it showed one, a deprivation guard that checks the module rather than the binding, **harness
ground truth discarded along with the stream's silence**, **a tie rejected when nothing depended on
it**, a dot segment that makes one file read as two, a fixture shape the harness cannot seed, **a shell branch that cannot tell a refused call from one that ran and failed**, **a tie comparison that two correct repairs made wrong between them**, and **both source scans being narrower than the word "guard" implies**.
**Five of the seventeen are in an assertion's own logic, and all five are regressions from our own
repairs** — which is the round's finding rather than the count. Every previous round's instances
were in an assertion, because that is where a reviewer reads.

**And the levels kept going.** This same failure has now appeared at the guard, the fixture, the
store, and — this round — **the source scans that were written to close two of the classes above**.
Each was invisible from the one below. The last is the sharpest: a scan is a regex, so it catches
the shape its author anticipated, which is *the remembered rule* this file spent eleven rounds
arguing against. The mechanism built to end the class turns out to be an instance of it.

**Round 8 changed what the earlier PASSes are worth, and that belongs here rather than in a
footnote.** Until it, assertion 2 rejected a run that edited a file it had already written — so
the nineteen consecutive PASSes happened partly because no graded run touched a path twice. They
are still real: those runs were faithful and the check verified them. But the twentieth would
have gone red on ordinary work, and a regression check that fails on normal behaviour gets
switched off inside a week. That was the check's **viability**, not its precision.

The general form is the one this file keeps meeting: a check is only as tested as the states it
has actually been shown. Two of the last four findings were the fixture's silence rather than the
code's logic — a set the fixture never contained, so a rule about it could be wrong for as long
as it liked. Both are now IN the fixture, where the calibration exercises them model-free on
every invocation.

**The two rules that kept coming back are the same rule.** *An input that cannot determine an
answer must not produce one* — the ambiguity rule and the null rule are both spellings of it.
Ambiguity has now been wrong in **seven** directions (many rows for one mutation · many mutations
for one gap · many gaps for one mutation · surplus pathless gaps · interchangeable gaps counted
as a choice · surplus *named* gaps · **one gap spelling offered to several differently-spelled
mutations**) and null in two (outcome, kind). Each was applied correctly
the first time it was found, and each time the *next* direction was still open, because what was
fixed was the instance in front of us. That is the case for the guard table in one sentence: a
rule is remembered, and remembering is what failed; a table executes, and it has never once been
half-applied.

**THE SIXTH IS A SHAPE NONE OF THE OTHERS WERE: TWO OF OUR OWN REPAIRS INTERACTING.** The
indeterminate-`Write` repair made `null` kind mean *no claim*. The tie repair compared *distinct
graded semantics*. Each is correct alone — and the tie repair implemented "distinct" as
**serialized identity**, so a tied `Write` and `Edit` against an `edited`/`applied` row produced two
different strings and was rejected, although both candidates grade the row clean. **Abstention is
not identical to anything.** Neither repair produces that false red by itself; only the pair does.

That matters beyond the fix, and it is the first instance that **argues for** the per-case
must-pass-neighbour clause rather than merely fitting it. Every discipline proposed so far attaches
to a *repair* — check both directions when you change a rule. No amount of per-repair care catches
this one, because neither repair was wrong; the defect lives in the space between them, and only a
requirement attached to the **case** — *every fold carries a world that must still pass* — is
positioned to see it. It is also the reason the existing tie guard stopped expressing its
condition: that case **was** this false red, written as a failure. It is now the must-pass
neighbour, and a genuinely disagreeing tie took its place.

**THE FIFTH IS THE BEST INSTANCE THIS FILE HAS, AND IT IS A PROCESS DEFECT RATHER THAN A CODE ONE.**
It took three careful steps to produce, none of them a mistake at the time:

1. The coordinator claimed *"a shell call makes that path unmeasured."*
2. That was **corrected on measurement** — a real run reached for `Bash`, was refused, and said so,
   so *a call that never ran cannot have made the change.* The correction was right, evidenced, and
   became assertion 1's `denied` branch.
3. **The correction was silent about the other world.** `emitToolResult` stores every errored result
   as `failed`, so a `Bash` the harness refused and a `Bash` that ran, wrote the missing file and
   then exited nonzero are the *same persisted item*. The branch asserted *"none of them ran"* about
   a state that cannot say it.

The original instinct was right about a case the correction did not cover, and the correction was
right about the case it was shown. **Nobody was careless — the class is simply wider than either
position, and the careful step is what narrowed it.** Every other entry here is *a repair created the
next defect*; this one is *a correction of a coordinator's error created the next defect*, which is
the same argument one level up — where the reasoning happens rather than where the code does. That
is what LAB-137 should carry: **the failure is not insufficient care, because care is what produced
this one.**

It is also the only instance that **cannot be repaired by reading state harder.** The distinction
was destroyed upstream, before the record was written. Assertion 1 now reports it as unknowable —
not *denied*, which certifies nothing happened, and not *lost*, which asserts a mutation escaped. A
real fix needs a discriminator on the failure at the recorder (`@flow-state-dev/claude-code`'s
`emitToolResult`), which is **LAB-137's territory, not this file's**.

**Six self-inflicted regressions now — five from a single repair each, and one from two correct
repairs meeting.** The tool table asserting `Write` means `created` was the
only defect here that failed red on truth AND green on the defect; its repair, which is the most
carefully reasoned change in the file, created a **new false green on the same assertion**. That is
the sharpest available statement of what this class is: *the fix is where the next defect comes
from*, and it holds even when the fix is the best-argued one anybody made.

**So the count is not the strongest thing this file has to hand LAB-137. This is: every bound
anyone has placed on this class has been falsified, including two placed by the coordinator who was
watching for exactly that.**

- *"The written-down class entry is what stops the fifth."* The fifth arrived one round later,
  produced by the fourth's own repair.
- *"Self-inflicted regression is a closed category with one member."* Falsified **five times in the
  round it was written** — the seventh gap direction from round 10's per-mutation spelling test,
  the tie over-rejection from the aggregate-row repair, ground truth discarded by the
  indeterminate-`Write` repair, the shell branch that cannot tell refusal from
  execution-then-failure, and the serialized tie comparison that two correct repairs produced
  between them. A bound of one, wrong by five, inside a single round.
- And one placed here rather than by the coordinator: *"every remaining finding lives in a branch
  the real runs do not reach."* Falsified this round by two assertions that cannot fire at all —
  a cell the criterion did not have.

The five self-inflicted ones, so the lineage is legible rather than a number: the **fifth** gap
direction, from round 7's two-or-more-candidates rule; the **seventh**, from round 10's repair of
that fifth; the **tie over-rejection**, from the aggregate-row repair; **ground truth discarded
along with the stream's silence**, from the indeterminate-`Write` repair; and **refusal conflated
with execution-then-failure**, from the correction to a coordinator's own claim. Five repairs, five
new defects, no two in the same place — and the last was produced by the most deliberate step in
the list. **The sixth is not on that list because it belongs to no single repair**: comparing tied
candidates by serialized identity rather than by verdict, which only became wrong once `null` kind
meant *no claim*. Two repairs, both right, one defect between them.

Three bounds, three falsifications, by three different people all of whom knew the class was
recurring while they wrote them — and a fourth self-inflicted instance arriving in the same round
the third was written down. That is a better argument than any count, because a count invites
the reply *"so fix the remaining ones"* and this does not: **the thing that keeps being wrong is
the belief that the set is now enumerable.** The operative rule is therefore not a cap but a
standing obligation — *a defect our own repair introduced folds, however many times that
happens* — because the evidence says a cap is exactly the part that fails.

**The seventh is the sharpest illustration, and it is worth following in detail.** Round 7 failed
on "two or more candidate gaps", which closed a real hole. Round 10 found that this rejected a
faithful record — two attempts at one unkeyable path leave two gaps carrying the same `rawPath`,
one claim twice rather than a choice — and repaired it by counting distinct **spellings** instead
of rows. That repair was correct about the world it was shown and wrong one level up: it counted
spellings **per mutation**, and one gap spelling can answer to several *different* mutation
spellings. Two losses on `alpha.txt` and `sub/alpha.txt` beside two gaps both spelled
`/work/sub/alpha.txt` each saw exactly one spelling, each consumed a row, and A2 said `a2-ok` —
while those gaps evidence two attempts on one path and the other loss has no gap at all.

**Note what that means about round 7's rule: it rejected this world correctly, by accident.**
Fixing the over-rejection removed the accident along with the defect. So "does this repair also
remove a reject that happened to be right?" is now part of the question, not a nicety — and it is
not a question care answers reliably, which is the whole point above. Reconciliation is now
**global**: both sides reduce to distinct spellings, an assignment is made only where nothing else
could claim it, and the counts become the accounting only inside a forced 1:1 pair. Both directions
have a case, including one that must still **pass** — two distinct losses each answered by a gap
only they can claim — because "stop failing on two losses" would otherwise look like a fix.

**The sixth carries a second lesson, because of *where* it was found.** The pathless surplus was
named in the limits list a round ago; its named-path twin sat one branch away and was not. **We
half-applied a naming** — the same wrong-extent shape the rules keep taking, this time in the
prose that tracks them rather than in the code they govern. A limits list is a check whose only
evidence is somebody rereading it, so it fails the way every remembered rule here has failed.

**Closed by construction — but the two closes are NOT the same kind of thing, and saying they are
was an overclaim.** One is enforced by the type system; the other by a regex over source text. The
first cannot be spelled around. The second catches the shapes its author anticipated, which is the
thing this file has documented six times, now sitting inside the guard that was supposed to end it.

- **A pooled value reachable from a per-run judgement — TYPE-LEVEL, and genuinely closed.** Five
  instances across three rounds, each fixed by scoping one read, each followed by another. Ended
  when the account became a list of per-run views: `gradeRun` receives one view, the other runs are
  not in scope, and a pooled read **does not compile**. No spelling gets around it — the data is
  absent, not forbidden. **Instances since: zero.** A source scan guards the one reintroduction path
  the types cannot see, which is somebody *widening the signature*; that scan is a backstop, and its
  reach is a named limit below.
- **A cross-surface field comparison that handles one silence and not the other — SCAN-LEVEL, and
  weaker than it reads.** Null-outcome was given a failure and null-kind kept skipping, the same
  rule half applied, found a round apart. `compareField`'s signature requires an absence rule per
  side, so declining to compare costs a written `why` and appears in the diff — **but the type binds
  only the calls that already go through the door.** Nothing type-level stops a raw comparison being
  written *beside* it; only the scan does, and the scan is a regex. So this class's real closure
  rests on anticipating spellings, which is a different and lesser guarantee than the one above.

**Why the distinction is worth this much space.** *Structural beats remembered* is the strongest
claim this work makes, and it is true of the first close and only partly true of the second. A
reader who sees "a source scan enforces the boundary" and does not know it is a regex will trust it
more than it earns — and misplaced trust in a guard is the same defect as every entry in the grid
below, one level out into the documentation. The scans are worth having: they are cheap, they run
before every dispatch, and each was added after a real regression. They are **backstops for what
the types cannot reach**, not closes in their own right.

**Still enumerable — a grid, and honestly so.** The remaining family is *an assertion certifying
on evidence that does not cover its case*, over roughly `field × surface × presence`. Rounds 6
to 10 filled ten cells between them; these are cells nobody has reported and that this check does
not currently grade:

- `lastTouchedAt` on a row is read into no comparison, so a record may carry any timestamp.
- `previousStatus` on a plan row is derived and never graded.
- **A5's ROWS arm can certify a fractional account in THREE distinct ways, and that list is the
  finding.** It is the weakest thing in this check, and no one of the three says so on its own:

  1. **A plan row's `lastOutcome` never reaches the grader, because the READER drops it.** The
     collection exposes it and the recorder writes it, and `readAccount`'s plan-row mapping
     carries `title`, `status` and `previousStatus` only — so a task with a confirmed title and
     status plus a later `TaskUpdate` that failed grades `a5-ok`, certifying a transition the
     state says never settled.
  2. **Gap handling is skipped whenever any plan row exists** — the entry below, kept there
     because it was reported on its own, and repeated here because it belongs to this set.
  3. **A successful `TaskCreate` whose row is lost leaves neither a row nor a gap**, and
     `rows.length !== 0` bypasses loss accounting entirely, so `a5-ok`. The sharp part is the
     reporter's own note: **checking gaps beside the surviving rows would not catch it.** A gap is
     emitted when a successful create's item id is *unreadable*; a row that simply vanished
     produces no gap, so the loss is invisible on both surfaces at once. Every other exemption in
     this check works because the absent thing leaves a trace somewhere. This one has nowhere to
     look, which is a different repair from the other two and worth knowing before anyone starts.

  Taken together they are one statement: **the arm reports on the rows it can see, and has three
  separate blind spots about the rows it cannot.** That is this goal's own thesis — a fractional
  account certified as whole — appearing three times inside one assertion of it.

  **Number 1 is also A3's shape one notch weaker, and that pair says more than either half does.**
  A3 is an assertion measuring a property the layer below it has already made true; this is an
  assertion blind to a field the layer below it recorded faithfully and the layer *above* the
  store threw away. Both are the same question asked at the wrong altitude — *what happened to
  this value between the writer and the check?* — and neither is visible from the grader, where
  every review of this file has been looking. **All three stay limits rather than fixes on two
  counts:** A5 can fail, so these are dimensions of blindness rather than an assertion that cannot
  fail — which is the bar this PR folds at; and the ROWS arm does not execute on a real run at all
  (`toolCalls === 0`, FIX-1185), so closing any of them would change no verdict until the driver
  does.
- A `tool_output` whose `toolCall.name` is unreadable matches no tool table and is invisible to
  A2 entirely — an existence cell, not a presence one.
- **A2 reports that the stream showed NO mutation when it showed one it could not key — a false
  red that asserts something untrue.** A run whose only file-tool call carries no readable
  `file_path` produces an empty `streamMutations` and an empty record, so the early return fires
  and emits `a2-both-empty`: *"the item stream carries no file-tool call"*. It did carry one. The
  pathless call is counted on the view (`mutationsWithNoPath`) and the pathless branch would have
  graded it, but the early return runs first and never reaches it. **Worth naming in those terms
  rather than as a miss:** every other gap in this list is an assertion failing to *see*
  something, and this one states a fact about the run that is false. Unreached — no real run has
  produced a pathless mutation — which is the only reason it has never been read by anybody.
- **A8 checks the module a binding came from, not the binding — so the deprivation guard does not
  mechanically enforce the boundary it states.** The allowlist is a set of specifiers, and
  membership is tested with `mayImport.includes(spec)`; nothing looks at *what* is imported. So
  `import { createWorkRecorder }` or `import { canonicalFilePathKey }` from the already-permitted
  `@flow-state-dev/claude-code/sdk` yields `a8-ok`, and the reader could reach the recorder's own
  canonicalization — the exact coupling `paths.mts` exists to refuse.

  **Be exact about what this does and does not mean, because the difference is the whole claim.**
  The reader **is** compliant: it imports `OBSERVED_FILE_OPS`, `OBSERVED_GAPS` and `OBSERVED_PLAN`
  and nothing else, which the evidence line prints on every run and which anyone can read in
  twenty seconds. *"Reconstructed from FSD state alone"* holds for every run in the verdict log. What is
  weaker than stated is the **mechanical guarantee**: A8's own description of itself — *the
  reader's source imports nothing but the collection accessor keys* — is enforced only down to the
  module, so the property currently rests on **inspection rather than enforcement**. That is the
  difference between *"the Proof is wrong"* and *"the Proof rests on a weaker mechanism than it
  advertises"*, and only the second is true.

  It is named rather than folded because folding it changes no verdict — the reader is already
  compliant — and this round's bar was an assertion that cannot fail. **The fix is recorded so
  nobody re-derives it:** either scan the imported *bindings* and allowlist the three key names,
  or move the keys into a constants-only module, which makes the specifier check and the binding
  check the same check. The second is the better shape by this file's own standard — it removes
  the gap by construction rather than adding a rule that has to stay right.
- **`sameFile` keeps `.` and `..` as segments, so a run naming a file `./ledger.txt` reads as a
  different file — a FALSE RED, and a double one.** `segmentsOf` splits on `/` and drops only empty
  strings, while the recorder canonicalizes with `resolvePath` before keying its row. So the stream
  spelling `./ledger.txt` has segments `[".", "ledger.txt"]` and the row's key ends
  `[..., "ledger.txt"]`; the suffix comparison fails on `.` versus the directory segment, the two
  surfaces stop pairing, and A2 emits **two** failures on entirely faithful state — the mutation
  unaccounted, and the row without a stream. **Pre-existing rather than one of ours**, and
  unproduced by any graded run because the harness dispatches absolute paths and the model has
  echoed them back verbatim every time. It survives on a habit of the driver, which is exactly the kind of
  thing that changes without telling anybody. **The fix is recorded so nobody re-derives it:**
  normalise lexical dot segments — drop `.`, pop on `..` — before the suffix comparison, in
  `segmentsOf`, where both sides already go through.
- **A replacement fixture naming a path inside a subdirectory aborts the run with `ENOENT` before
  dispatch.** The harness makes the temp root and writes the seed file directly into it, so a
  fixture whose `editPath` is `sub/notes.txt` throws on the seed write rather than reporting a bad
  fixture. Harness robustness for a fixture nobody has written — the goal's contract says a
  different valid fixture must still pass, and this is one shape of "valid" that would not get as
  far as being graded. The smallest item on this list, and named only because "unwritten fixture
  shapes" is the same silence that hid two of the viability defects: `mkdirSync(dirname(...), {
  recursive: true })` before the seed write closes it.
- **THE TWO SOURCE SCANS ARE REGEXES, AND BOTH ARE NARROWER THAN THE WORD "GUARD" IMPLIES.** They
  are grouped here because the pair makes a point neither makes alone: *the thing this file keeps
  catching is now inside the mechanism that was supposed to end it.* A scan catches the shape its
  author thought of; rename a parameter and it goes quiet. That is a remembered rule enforced by a
  spell-checker.

  - **The per-run boundary scan only reads `function name(...)` declarations.** It iterates
    `/function\s+(\w+)\s*\(([^)]*)\)/`, so `const gradeX = (view: GradeableView, all:
    GradeableAccount) => …` is never examined — nor a method shorthand, nor `const x = function
    (…)`. The reintroduction path it exists to watch is *somebody widening a signature*, and the
    most idiomatic way to write a new one in this codebase is the one shape it cannot see.
  - **The cross-surface comparison scan requires the literal identifiers `entry` and `mutation`
    around the operator.** `const { kind } = entry;` then `kind !== mutation.kind`, or
    `const e = entry, m = mutation;` then `e.kind !== m.kind`, both slip past. Since this scan is
    doing the *primary* work for its class rather than backstopping a type — the type binds only
    calls that already go through `compareField` — its reach is the class's reach.

  **Reachable only by a future author, never by a run**, which is why they are named rather than
  folded: nothing a dispatched run does can produce either. **The fix, recorded so nobody
  re-derives it:** make both AST- or type-aware rather than identifier- and declaration-shape
  dependent — resolve the parameter types on every function-like node, and resolve the operands of
  every strict comparison back to their declarations. `ts-morph` is already a repo dependency. That
  would move the backstop into the same category as the close it supplements, which is the whole
  point of the distinction drawn above.
- A row's `storageKey` and its `topic` are never checked against each other.
- A gap's `reason` and `at` are carried and never graded.
- **Surplus pathless gap rows are accepted.** One pathless mutation and two `file`/`rawPath: null`
  gaps satisfies the inequality, and the unmatched gap is a stored claim the stream does not
  evidence. This is **the ambiguity rule's fourth direction** — the pathless side — and it arrived
  after the class was written down.
- **Surplus NAMED gap rows are accepted too — the sixth direction, and the twin of the entry
  directly above.** After one-to-one consumption, whatever is left in the named pool is never
  looked at: one missing mutation beside two identical named gap rows consumes one and grades
  `a2-ok`, with the leftover standing as a recorded claim of a loss the stream never showed. The
  reverse direction — a row the stream never showed — has failed by name since round 1; a *gap*
  the stream never justified does not. **What this entry is really evidence of is the list it is
  in:** the pathless case was written down a round ago and this one sits one branch away in the
  same function, so naming one and not the other is the wrong-extent failure applied to our own
  bookkeeping. Cheap to close — compare the pool's residue the way the pathless side compares its
  count — and deliberately not closed here, because this PR folds only what an assertion cannot
  fail, and A2 fails in five other directions already.

  When this was first recorded it said the class entry *is what stops the fifth*. **That was
  wrong, and the next round proved it wrong**: a fifth direction arrived one round later, produced
  by the fourth's own repair. Writing a class down makes its instances recognisable; it does not
  make them stop. The correction is left visible here rather than edited away, because a file
  about checks that certify more than they measured should not quietly fix its own overclaim.
- **A5 skips gap handling whenever any plan row exists.** A run whose plan was partly recorded and
  partly gapped emits `a5-ok`, because a non-empty `rows` short-circuits the branch that reads
  plan gaps. **It certifies a fractional account** — which is, in one phrase, the thing this whole
  goal exists to reject, appearing as one of its own limits.
- **A message of pure whitespace counts as something the run said.** The readable-text filter
  measures length without trimming. Wrong *extent* on the fix from round 6, which is the same
  family as the half-applied rules: the rule was right and its reach was short.
- **A1 grades against the expectation's BARE NAMES, not the absolute targets the run was given.**
  An incidental file sharing a basename — a `backup/ledger.txt` beside the `ledger.txt` the job
  asked for — makes the relative name match two rows, and A1 fails as ambiguous although the
  dispatched absolute path and both stream-derived paths distinguish them perfectly. Pre-existing
  rather than introduced, and unreached by any graded run. **The fix is named so nobody re-derives it:**
  grade against the absolute `targets` the prompt supplied (`run.mts`) instead of the basenames,
  which removes the ambiguity at the source rather than teaching the matcher to break ties.

**THE NAMED-LIMITS LIST IS NOT A CLOSED SET, AND WAS NEVER GOING TO BE.** Three of the entries
above were added *after* the criterion — "every remaining finding lives in a branch the real runs
do not reach, and those branches are named here" — had been confirmed true. That does not
invalidate the criterion: each of them is genuinely unreached by the graded runs, so the sentence
stayed true the whole time. What it shows is that the sentence is a claim about the **findings we
have**, not about the ones nobody has looked for yet. The list grows every time somebody reads
this file carefully.

Read it as exhaustive and you will make a specific mistake — the same one that produced half the
findings here, which is taking a close that covers a class as though it covered a file. The list
is the set of gaps that have been *seen*; it is not the set that exists.

**Three of the last four findings did not live in that grid, and saying otherwise would repeat
the defect they were.** Assertion 3's scope was *which set a derivation reads*, one level up from
any field. Assertion 2's aggregate-row rejection and assertion 5's rows-without-calls were a
third thing again: **a rule about a state the fixture never contained**, which no amount of
grading precision would have surfaced. The grid describes the family this check has repeatedly
produced. It is not a proof that no other axis exists, and nothing here should be read as one —
the honest statement is that the grid's cells are named and the axes are not closed.

Filling those buys those. **Every one lives in a branch the graded runs do not reach** — they need
an incidental file outside the expectation, an unreadable vendor field, or a plan half that
reports UNMEASURED on every real run. That is the stopping line for a Proof: the question this
issue exists to answer has been answered thirty-three times, and precision on unreached edges is
worth bounding rather than grinding.

**Round 11 falsified the framing of that stopping line, and the correction stays visible for the
same reason the last one did.** The sentence sorts every residual finding into *unreached
branches*, and assertions 3 and 7 are not that. They are assertions that **cannot fire at all** —
a different thing and a worse one, because an unreached branch still means the assertion works and
this run did not exercise it, while these two report a PASS about a run they never read. The
criterion had no cell for that, which is precisely why nothing in ten rounds of applying it
noticed. It still holds over the *named* findings above; it was never a statement about the ones
nobody had looked for, and this is the second time this file has had to say so.

The residual belongs beside **LAB-137**, not inside it. LAB-137 is recorder-side — *confirm only
what the harness confirmed*. This is reader-side — *assert only what the state shows*. Siblings,
same disease, opposite ends of the same wire.

**One item crosses that line and is handed over explicitly.** `emitToolResult` collapses every
errored tool result to `status: "failed"`, so a refused call and one that ran and then failed are
the same persisted item — and assertion 1 can therefore only report *unknowable* where it used to
claim *nothing ran*. No amount of reading state better recovers that; the information is destroyed
before the record exists. **A discriminator on the failure at the recorder is LAB-137's to make**,
and it would turn one of this check's unmeasured arms back into a graded one.

## Named limits

Three things this check states rather than proves, so none of them is a silent gap. **Assertions 3
and 7 are deliberately NOT here** — an assertion that cannot fire is not a limit on what the check
proves, it is a correction to what its PASSes have meant, and it lives in the verdict section
below where the PASSes are recorded. (The heading said *five* over three bullets for several
rounds. A miscount in the list this file uses to hold itself honest is a small thing that is
exactly the wrong small thing.)

- **The plan half is UNMEASURED on every run** (FIX-1185), so its ROWS branch has never executed
  against real data. Every part of it is exercised by directly-fed worlds instead.
- **Two runs in one workstream are never produced by a real dispatch.** This goal dispatches one
  run per invocation. The reader's per-run partition is covered model-free by a two-run
  calibration fixture — which it has to be, since the guard cases feed `gradeRun` a single view
  and nothing they build can reach reader-side derivation. Producing two real runs is the
  predecessor goal's ground.
- **Two runs in one workstream are never GRADED.** The expectation belongs to the run this goal
  dispatched, and a workstream holding more than one request has runs no expectation can be
  attributed to — so the goal aborts rather than picking one. The reader's per-run partition is
  still exercised on every invocation, because the calibration fixture holds two runs.

## What this deliberately does not re-assert

That the workstream is a child session carrying the held-out topic; that `include_items=true` is
load-bearing on this adapter; that the originating request's stream carries none of the run's
items; that the dispatching board's task collection stayed clean; and that the collections
declare client state reads. Each has its own goal, and duplicating it here would inflate this
one's PASS into a claim about theirs.

## Verdict log

**THE VERDICT IS TWO ASSERTIONS WEAKER THAN IT HAS BEEN REPORTING.** Assertions 3 and 7 are
**structurally satisfied on the real path** — not unreached edges, not named limits, but claims
the system makes true before the run is consulted. **Their combined contribution to every PASS in the log below
is zero.** Each has real teeth in the calibration fixture and the guard table, where the state is
handed in; neither can say anything about a dispatched run. This is stated here, in the verdict
section, because it is a correction to what the PASSes mean — putting it in the named-limits list
would read as an edge case, and it is not one.

**Assertion 3 measures a field the store sorts by.** The reader's ordering set comes from
`/sessions/:id/requests?include_items=true`, which lands on `store.request.list({withItems:true})`.
In `packages/store-sqlite/src/request-store.ts` the item write persists `sequence = item.itemIndex`,
and both read paths — `selectItemsStmt` and the batch `list` query — are `ORDER BY … sequence ASC`.
The legacy dual-read merge beside them re-sorts on `itemIndex` too. So the item list arrives sorted
by **the exact field A3 tests for non-decreasing order**: a run emitting `0, 3, 2, 4` reads back
`0, 2, 3, 4` and grades `a3-ok`. `a3-out-of-order` is unreachable outside a directly-fed state.
Its two other branches are closed by the same layer — `sequence INTEGER NOT NULL` means a
persisted item always carries a numeric `itemIndex`, so `a3-unreadable` cannot fire either (nor
can A4's `a4-unreadable-mutation`, which reads the same absence), and a run of 30-odd items is
never short of two distinct positions.

**Assertion 7 followed a cursor that was never offered.** `STATE_LIST_DEFAULT_LIMIT` is 50 and
these runs write three file rows, no gaps and no plan rows, so every collection fits in one page
and `nextCursor` is never returned. `a7-truncated` needs 200 pages; `a7-never-read` needs a view
whose `reads` map lacks a collection, which `readAccount` cannot produce because it assigns all
three unconditionally or throws. A7's real teeth are in the calibration — the page-cap-1 mutation
went red there — and that is the whole of its coverage.

**The rest of the verdict is unaffected, and naming what survives is part of being honest about
what does not.** A1, A2, A4 and A6 read field *values*, not the order they arrive in, so the
store's sort passes through them: A4 compares `max(mutation itemIndex)` against
`max(message itemIndex)` and still goes red on a run that writes after its closing word. A8 grades
source text. A5 reports UNMEASURED, which is disclosed above and is not a silent tautology. So
what every PASS certifies is **A1, A2, A4, A6 and A8 over the dispatched run**, plus the
model-free half in full.

**An independent ordering surface was looked for, found, and rejected on measurement — recorded
so nobody re-derives it.** `request_events` is written with its own `sequence_number` and read
`ORDER BY sequence_number ASC`, so it is genuinely not sorted by `itemIndex`: the counter is
`this.sequenceNumber += 1` inside the emitter's `appendEvent`, and `item.added` carries the whole
item, `itemIndex` included. It is a real second surface. It is also **not a witness of the
property A3 names**, because `itemIndex` is reserved at item *construction* (`emittedItemCount++`
in `createExecutionContext`) and the event sequence is assigned later at *emission*, with awaits
between. On a faithful model-free run of this goal's own board-and-detached-worker shape, the
persisted log's `item.added` events carried
`0,1,1,3,2,3,4,7,5,6,7,11,8,13,9,15` — a state snapshot reserved at 3 emitted before a block trace
reserved at 2, and so on down the run. Routing A3 through the event log would therefore fail
**ordinary faithful state on every run**, which is this file's most repeated defect wearing a new
hat. A second reason on its own would have been enough: when the persisted log is empty the stream
route falls back to `buildReplayEvents`, which reconstructs from `record.items` and is
`itemIndex`-sorted again — the identical tautology one level down, with nothing at the reader able
to tell the two apart.

**The level is the lesson, and it is the third one.** A3 was caught by reading the *storage
layer*, which is invisible from the check, from the fixture, and from the guard table alike — the
three levels this same failure has now appeared at. A guard case proves an assertion rejects a
world; it cannot prove the world reaches the assertion, because everything between the emitter and
the grader is stubbed out. So the sweep that found A7 is the one worth repeating: **for every
assertion, name the field it reads and ask what happens to that field between the writer and the
check.** Asked that way it catches one more, a notch weaker and on the other side of the wire: the
reader's plan-row mapping **drops `lastOutcome`**, a field the collection exposes and the recorder
writes, so A5's ROWS arm is blind to whether a plan transition settled. It is named in the grid
below rather than fixed, and it belongs beside A3 rather than filed away from it — A3 is a check
measuring a property something below it already made true, this is a check blind to a value
something above the store threw away, and the two together say what neither says alone: **this
file's remaining defects are not in the grader, which is where every review has been looking.**

Both halves of the disclosure are **executed rather than remembered**, because a paragraph is
exactly the artifact that decayed here. Precondition 1f writes two items out of order through a
real store and reads them back: sorted means this disclosure stands; **as-written means the store
changed, A3 has teeth on the real path again, and the goal fails saying so** — the disclosure is
wrong in the generous direction and must not sit there quietly under-reporting itself. A7's half
is computed from the run instead of asserted: every run's evidence line reports how many cursors
it actually followed, and its **wording branches on that count**, so the first run where a
collection pages says *"A7 graded a real read — the entry in goal.md no longer holds"* instead of
repeating this paragraph. **That second branch has never executed**, and in a file about checks
that certify what they never measured, saying so is not optional: it is an evidence string rather
than a graded assertion, so nothing rides on it, but it is exactly the shape that has been wrong
here before.

**Assertion 5 has reported UNMEASURED on every run**, and that is the finding rather than a
footnote. Through the in-process Agent SDK path the run invokes no plan tool at all — it writes
its to-do list as **prose in its own messages**, which the account shows verbatim
(`To-do list: 1. … — completed 2. … — in progress`). The predecessor ruled out both of our own
configuration suspects by measurement across eight consecutive runs, and the plan tools are named
in `allowedTools` here too, so this is the driver's behaviour and not this file's. Filed as
FIX-1185. It cannot fail the kill line by design — the proof rests on what the run **did** — but
the plan half of the graph remains unexercised end to end and must not be read as proven.

**Every run has also reached for the shell**, with `Bash` absent from `allowedTools`. That is
assertion 1's split doing its job rather than an anomaly: the allowlist is a permission filter,
not an availability one. On one run the call was **refused** and the agent said so in its own
words, which is what surfaced the difference between a shell call that ran and one that did not.
On these runs no expected path was missing, so nothing went unmeasured — but both branches are
live, and the branch that would call the whole run inconclusive sits behind them.

| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-08-18 | **`58006beb4`** | Agent SDK default | **PASS — the verdict** | Thirty-third consecutive real run, on the committed tree, round 11 folded and final. 3 of 3 held-out paths `created`/`edited` and `applied`; **4 stream mutations against 3 rows** — the first REAL run to touch a path twice, so the aggregate-row rule and terminal selection were exercised on live data rather than only by the fixture; non-decreasing across 33 items at 28 distinct positions; mutations 17–25, last word at 27; 1 shell call, 0 completed. **78 guards** proven first. Plan arm UNMEASURED. CI on the branch head `2d6f854c7`: 6 passed, 1 neutral (Vercel Agent Review); Cursor Bugbot registered no run — an absence, not a pass |
| 2026-08-18 | working tree at `58006beb4`, grader at `1c2fe209f` | — | FAIL *(deliberate)* | **The sixth self-inflicted regression, and the first from TWO repairs meeting.** *"'A2 — a tied Write and Edit that both grade clean against the row' did not reach A2/a2-ok with a pass; it produced `["a2-terminal-tied=fail"]`"* — a faithful concurrent state rejected because the tie check compared serialized values while `null` kind means *no claim*. The old `a2-terminal-tied` case **was** this world, written as a failure; it is now the must-pass neighbour |
| 2026-08-18 | working tree at `58006beb4` | — | PASS *(the direction that must keep failing)* | A tie whose candidates genuinely disagree — two `Edit` calls at one position, one completed and one failed, against an `edited`/`applied` row — still reaches `a2-terminal-tied`. Red under both the old rule and the new one, which is what makes it the discriminator rather than a casualty of the fix |
| 2026-08-18 | **`2f5760ddc`** | Agent SDK default | **PASS — the verdict** | Thirty-second consecutive real run, on the committed tree, round 11 folded and final. 3 of 3 held-out paths `created`/`edited` and `applied`; 3 stream mutations and 3 rows naming the same files; non-decreasing across 30 items of the request at 25 distinct positions; mutations 17–22, last word at 24; 1 shell call, 0 of them completed. **77 guards** proven first; precondition 1f and the A8 gate silent. Plan arm UNMEASURED. The shell branch now reads *unknowable* rather than *denied* — unreached on this run, since no expected path was missing |
| 2026-08-18 | working tree at `2f5760ddc`, grader at `2940cbb48` | — | FAIL *(deliberate)* | **The fifth self-inflicted regression, and the only one produced by a CORRECTION rather than a repair.** *"'A1 — an expected path is absent and no shell call completed' did not reach A1/a1-missing-shell-unknowable with a unmeasured; it produced `["a1-missing-shell-denied=fail"]`"* — the check asserting *"none of them ran"* about a state that stores a refused call and a ran-then-failed call identically |
| 2026-08-18 | working tree at `2f5760ddc`, increment removed | — | FAIL *(deliberate, and the one that mattered)* | The `unmeasured += 1` taken out of the new branch. *"'A1 — every path unknowable because no shell call completed' did not reach A1/a1-all-unmeasured with a fail; it produced `["a1-missing-shell-unknowable=unmeasured","a1-missing-shell-unknowable=unmeasured","a1-missing-shell-unknowable=unmeasured"]`"* — **a run that measured nothing, coming back green with three polite notes.** The hole the fold could have opened, watched before it was closed |
| 2026-08-18 | working tree at `2f5760ddc` | — | PASS *(the neighbour that must not be swept up)* | A missing path with **no** shell call is still `a1-missing-no-shell` and still fails: with no second world there is nothing to be uncertain about. Without it, "stop failing when the shell failed" would be indistinguishable from "stop failing" |
| 2026-08-18 | **`5f3849211`** | Agent SDK default | **PASS — the verdict** | Thirty-first consecutive real run, on the committed tree, round 11 folded and final. 3 of 3 held-out paths `created`/`edited` and `applied`; 3 stream mutations and 3 rows naming the same files; non-decreasing across 31 items of the request at 25 distinct positions; mutations 19–23, last word at 25; 1 shell call, 0 of them ran. **75 guards** proven first; precondition 1f and the A8 gate silent. Plan arm UNMEASURED. **First run graded against harness ground truth** — the two create targets held to `created`, the seeded file held to never-`created` |
| 2026-08-18 | working tree at `5f3849211`, grader at `1fa078a1e` | — | FAIL *(deliberate)* | **The fourth self-inflicted regression, from the repair for the worst defect this file had.** A creation recorded as an edit: *"'A1 — a creation the harness knows about, recorded as an edit' did not reach A1/a1-kind-not-created with a fail; it produced `["a1-ok=pass"]`"*, and the seeded-file direction the same way. The indeterminate-`Write` repair was right about the stream and discarded what the harness knows |
| 2026-08-18 | working tree at `5f3849211`, grader at `1fa078a1e` | — | FAIL *(deliberate)* | **The third self-inflicted regression.** A tie whose calls grade identically: *"'A2 — a tie whose calls are graded identically settles nothing' did not reach A2/a2-ok with a pass; it produced `["a2-terminal-tied=fail"]`"* — the aggregate-row repair rejecting a faithful record because a choice existed, not because it mattered |
| 2026-08-18 | working tree at `5f3849211` | — | PASS *(the over-rejection directions)* | Three stand-downs that must stay green, so neither fold becomes "any repeat fails" or "any tie fails": a create target written and then edited reads `edited`; a create target whose only call failed is not held to `created`; a tie whose calls disagree still fails |
| 2026-08-18 | **`fbcc6eb3f`** | Agent SDK default | **PASS — the verdict** | Thirtieth consecutive real run, on the committed tree, round 11 folded and final. 3 of 3 held-out paths `created`/`edited` and `applied`; 3 stream mutations and 3 rows naming the same files; non-decreasing across 30 items of the request at 25 distinct positions; mutations 17–22, last word at 24; 1 shell call, 0 of them ran. **69 guards** proven first; precondition 1f silent and the A8 gate silent. Plan arm UNMEASURED. First run with mutation↔gap reconciliation done globally |
| 2026-08-18 | working tree at `fbcc6eb3f`, grader at `d602dc0cc` | — | FAIL *(deliberate)* | **The seventh direction, watched red against the pre-fix grader.** Two lost mutations spelled `gamma.txt` and `sub/gamma.txt` beside two gaps both spelled `/work/repo/sub/gamma.txt`: *"'A2 — one gap spelling offered to two differently-spelled lost mutations' did not reach A2/a2-ambiguous-gap with a fail; it produced `["a2-ok=pass"]`"*. The per-mutation spelling test consumed one gap for each, while the gaps evidence two attempts on one path and the other loss has no gap at all. Round 7's rule rejected this world correctly **by accident**; round 10's repair removed the accident with the defect |
| 2026-08-18 | working tree at `fbcc6eb3f` | — | PASS *(the over-rejection direction)* | Two distinct losses, each answered by a gap only it can claim, must still reach `a2-ok` — without it, "stop failing on two losses" would look like a fix. Green on the pre-fix grader too, which is the point: it pins what the repair must NOT break |
| 2026-08-18 | **`74d628367`** | Agent SDK default | **PASS — the verdict** | Twenty-ninth consecutive real run, on the committed tree, round 11 folded and final. 3 of 3 held-out paths `created`/`edited` and `applied`; 3 stream mutations and 3 rows naming the same files; non-decreasing across 30 items of the request at 26 distinct positions; mutations 17–22, last word at 24; 1 shell call, 0 of them ran. **67 guards** proven first; precondition 1f silent and the A8 gate silent. Plan arm UNMEASURED. The evidence line closes with what the run does **not** prove: *"Two of the eight assertions certify nothing about this run: A3 grades a field the store returns sorted by, and A7 followed 0 cursor(s) because every collection fitted in one page"* |
| 2026-08-18 | **`88a1bcb08`** | Agent SDK default | **PASS** *(superseded — the evidence line's A7 clause was made to branch after it)* | Twenty-eighth consecutive real run, on the committed tree, round 11 folded and final. 3 of 3 held-out paths `created`/`edited` and `applied`; 3 stream mutations and 3 rows naming the same files; non-decreasing across 30 items of the request at 25 distinct positions; mutations 16–22, last word at 24; 1 shell call, 0 of them ran. **67 guards** proven first; precondition 1f silent and the A8 gate silent. Plan arm UNMEASURED. Evidence line states what it does not prove: A3 grades a field the store returns sorted by, A7 followed 0 cursors |
| 2026-08-18 | working tree at `88a1bcb08` | — | FAIL *(deliberate)* | `import { readFileSync } from "node:fs"` in the reader again — but now caught by the **gate**: *"A8/a8-forbidden-import — reader.mts imports "node:fs""* followed by *"the preconditions did not hold, so no coding run was dispatched and nothing was graded"*. The same defect used to cost a full model-backed run to report; it now returns in seconds. Both directions watched, the pass direction being the verdict run above |
| 2026-08-18 | **`45e31d952`** | Agent SDK default | **PASS** *(superseded)* | Twenty-seventh consecutive real run, on the committed tree, round 11 folded. 3 of 3 held-out paths `created`/`edited` and `applied`; 3 stream mutations and 3 rows naming the same files; non-decreasing across 31 items of the request at 27 distinct positions; mutations 18–23, last word at 25; 1 shell call, 0 of them ran. **67 guards** proven first, and precondition 1f silent. Plan arm UNMEASURED. **The first run whose evidence line states what it does NOT prove**: A3 grades a field the store returns sorted by, and A7 followed 0 cursors because every collection fitted in one page — so this PASS is A1, A2, A4, A6 and A8 over the run, not eight assertions over it |
| 2026-08-18 | working tree at `45e31d952` | — | FAIL *(deliberate)* | Precondition 1f's other direction: the probe's two rows read back without the `ORDER BY`, which is what a store that stopped sorting returns. `[1,0]` reaches *"THE A3 DISCLOSURE IS STALE — items written out of order (1, 0) read back as written"*. The disclosure fails loudly when it stops being true, instead of quietly over-reporting |
| 2026-08-18 | working tree at `45e31d952` | — | FAIL *(deliberate, and unplanned)* | **The first version of precondition 1f could not fail.** Its two items were named `item_probe_early` / `item_probe_late`, and the write path sorts each batch by `item.id` — so the rows were already in index order on disk and the probe went silent against a read doing no sorting at all. A check of a tautology that was itself a tautology, found by running its second direction. The ids now contradict the index order |
| 2026-08-18 | **`7570fac56`** | Agent SDK default | **PASS — the verdict** | Twenty-sixth consecutive real run, on the committed tree, round 10 folded. 3 of 3 held-out paths `created`/`edited` and `applied`; 3 stream mutations and 3 rows naming the same files; non-decreasing across 32 items of the request at 28 distinct positions; mutations 19–24, last word at 26; 2 shell calls, 0 of them ran. **67 guards** proven first. Plan arm UNMEASURED |
| 2026-08-18 | working tree at `5fb92957b`, pre-commit | — | FAIL *(deliberate)* | Candidate gaps counted rather than distinguished — the round-7 repair as it stood. *"'A2 — two interchangeable gaps account for two attempts at one path' did not reach A2/a2-ok with a pass; it produced `["a2-ambiguous-gap=fail","a2-ambiguous-gap=fail"]`"*. The over-rejection a fix of ours introduced |
| 2026-08-18 | working tree at `5fb92957b`, pre-commit | — | FAIL *(deliberate)* | The ambiguity branch loosened away entirely — what "stop failing on two candidates" looks like if done carelessly. *"'A2 — two gap rows could each be the one covering a lost mutation' did not reach A2/a2-ambiguous-gap with a fail; it produced `["a2-ok=pass"]`"* — the round-7 hole, reopened |
| 2026-08-18 | **`c0e56d379`** | Agent SDK default | **PASS — the verdict** | Twenty-fourth consecutive real run, on the committed tree, round 9 folded. 3 of 3 held-out paths `created`/`edited` and `applied`; 3 stream mutations and 3 rows naming the same files; non-decreasing across 31 items of the request at 26 distinct positions; mutations 18–23, last word at 25; 1 shell call, 0 of them ran. **65 guards** proven first. Plan arm UNMEASURED |
| 2026-08-18 | working tree at `46da7d212`, pre-commit | — | FAIL *(deliberate)* | A6's top-level tool-output requirement restored. *"'A6 — the run delegated every tool call to a sub-agent' did not reach A6/a6-ok with a pass; it produced `["a6-empty:toolOutputs=fail"]`"* — a run that did everything asked of it, failed for reporting without doing anything |
| 2026-08-18 | **`2a6c3892b`** | Agent SDK default | **PASS — the verdict** | Twenty-second consecutive real run, on the committed tree, round 8 folded. 3 of 3 held-out paths `created`/`edited` and `applied`; 3 stream mutations and 3 rows naming the same files; non-decreasing across 31 items of the request at 26 distinct positions; mutations 16–23, last word at 25; 1 shell call, 0 of them ran. **64 guards** proven first, over a fixture that now carries a path written and then edited. Plan arm UNMEASURED |
| 2026-08-18 | working tree at `6f62875fe`, pre-commit (round 8 folded) | Agent SDK default | PASS | Twenty-first consecutive real run. **64 guards**. The fixture now carries a path written and then edited |
| 2026-08-18 | working tree at `6f62875fe`, pre-commit | — | FAIL *(deliberate)* | Any repeated touch treated as an ambiguity again — the state of the check for its first nineteen PASSes. **`CALIBRATION FAILED — the grader reports 1 failure(s) on a state whose account is correct`**, plus nine guard cases red. The false red on faithful state, caught before a run is dispatched |
| 2026-08-18 | working tree at `6f62875fe`, pre-commit | — | FAIL *(deliberate)* | Plan rows allowed to outvote the absence of any plan call. *"'A5 — plan rows exist and the run invoked no plan tool' did not reach A5/a5-unmeasured; it produced `["a5-ok=pass"]`"* — the false green on the branch every real run takes |
| 2026-08-18 | working tree at `6f62875fe`, pre-commit | — | FAIL *(deliberate, and unplanned)* | Adding the repeat to the fixture made a guard case stop expressing its condition: `streamMutations[0]` was no longer the mutation its row is compared against, so the world graded clean. *"'A2 — the stream cannot say how a mutation ended and the row claims applied' did not reach A2/a2-outcome-unevaluable; it produced `["a2-ok=pass"]`"*. It now selects by path |
| 2026-08-18 | **`91d726679`** | Agent SDK default | PASS *(superseded)* | Nineteenth consecutive real run, on the committed tree, round 7 folded and final. 3 of 3 held-out paths `created`/`edited` and `applied`; 3 stream mutations and 3 rows naming the same files; non-decreasing across 30 items of the request at 26 distinct positions; mutations 17–22, last word at 24; 1 shell call, 0 of them ran. **60 guards** proven first. Plan arm UNMEASURED. This run spawned no sub-agent, so `items` and `topLevel` are both 30 — A3's widened scope is exercised by the calibration fixture and precondition 1c-ter, not by this run |
| 2026-08-18 | working tree at `fca81252b`, pre-commit (round 7 folded) | Agent SDK default | PASS | Eighteenth consecutive real run. **60 guards**. A3 now reads *"non-decreasing across 30 item(s) of this request, sub-agents included, at 26 distinct position(s)"* — and on this run that is the same 30 items, because the run spawned no sub-agent. The broader scope is exercised model-free by the calibration fixture, not by the graded run |
| 2026-08-18 | working tree at `fca81252b`, pre-commit | — | FAIL *(deliberate)* | A2's gap exemption regressed to `findIndex`. *"'A2 — two gap rows could each be the one covering a lost mutation' did not reach A2/a2-ambiguous-gap with a fail; it produced ["a2-ok=pass"]"* — the ambiguity rule's third direction, reproducing the reported false green exactly |
| 2026-08-18 | working tree at `fca81252b`, pre-commit | — | FAIL *(deliberate)* | The ordering set narrowed back to the top-level thread. Calibration red before dispatch; in isolation the world the review reported — `0,1,2,3,4,4,4,5,6,5,7,8` with the nested pair reversed — grades `a3-out-of-order=fail` now and graded `a3-ok=pass` under the old scope |
| 2026-08-18 | working tree at `fca81252b`, pre-commit | — | FAIL *(deliberate)* | The fixture's sub-agent item **retired the way a tidy-up would** — item and the row it produced both removed, account regenerated, so calibration itself stays green. Precondition 1c-ter is what speaks: *"the calibration state carries no positioned sub-agent item, so nothing holds A3's set open past the top-level thread"*. Two guard cases keyed to that row go red beside it |
| 2026-08-18 | **`358957f4e`** | Agent SDK default | **PASS — the verdict** | Seventeenth consecutive real run, on the committed tree, round 6 folded and final. 3 of 3 held-out paths `created`/`edited` and `applied`; 3 stream mutations and 3 rows naming the same files; non-decreasing across 30 top-level items at 25 distinct positions; mutations 17–22, last word at 24; 1 shell call, 0 of them ran. 58 guards proven first. Plan arm UNMEASURED |
| 2026-08-18 | working tree at `91ca856c0`, pre-commit (round 6 folded) | Agent SDK default | PASS | Sixteenth consecutive real run. **58 guards** |
| 2026-08-18 | working tree at `91ca856c0`, pre-commit | — | FAIL *(deliberate)* | The half-applied kind rule re-applied — null kind skipping while null outcome fails, exactly as found. *"'a paired row cannot say how its file was touched' did not reach A2/a2-row-kind-missing"* |
| 2026-08-18 | working tree at `91ca856c0`, pre-commit | — | FAIL *(deliberate)* | A raw `entry.kind !== mutation.kind` written beside the combinator. *"A FIELD IS COMPARED OUTSIDE compareField"* — the scan that makes half-application unwritable |
| 2026-08-18 | working tree at `91ca856c0`, pre-commit | — | FAIL *(deliberate)* | Plan gaps ignored when declaring LOST. *"'every plan call is accounted for by a plan gap' did not reach A5/a5-unmeasured"* — the false-red direction |
| 2026-08-18 | **`8dcfcd945`** | Agent SDK default | **PASS — the verdict** | Fifteenth consecutive real run, on the committed tree, with round 5 folded. 3 of 3 held-out paths `created`/`edited` and `applied`; 3 stream mutations and 3 rows naming the same files; non-decreasing across 30 top-level items at 26 distinct positions; mutations 17–22, last word at 24; 1 shell call, 0 of them ran. 53 guards proven first, over a two-run calibration state carrying a pathless write and a failed plan create. Plan arm UNMEASURED |
| 2026-08-18 | working tree at `247725355`, pre-commit (round 5 folded) | Agent SDK default | PASS | Fourteenth consecutive real run. **53 guards** |
| 2026-08-18 | working tree at `247725355`, pre-commit | — | FAIL *(deliberate)* | The `Write → created` table restored. Calibration red — the reader no longer derives the known account. **The only defect this epic found that fails red on truth AND green on the defect** |
| 2026-08-18 | working tree at `247725355`, pre-commit | — | FAIL *(deliberate)* | The indeterminacy removed from the comparison only, so the reader still derives correctly. *"'A2 — a Write recorded as an edit is faithful' did not reach A2/a2-ok with a pass; it produced ["a2-kind-disagrees=fail"]"* — the false-red direction, caught. The false-green direction stays covered by the `Edit`-mislabelled case |
| 2026-08-18 | working tree at `247725355`, pre-commit | — | FAIL *(deliberate)* | A pathless mutation's position dropped again. Calibration red — the causality span shortens from 7 to 6 |
| 2026-08-18 | working tree at `247725355`, pre-commit | — | FAIL *(deliberate)* | A2's row-outcome branch disabled. *"'A2 — a paired row cannot say how its mutation ended' did not reach A2/a2-row-outcome-missing"* |
| 2026-08-18 | working tree at `247725355`, pre-commit | — | FAIL *(deliberate)* | The failed `TaskCreate` counted as a plan call again. Calibration red |
| 2026-08-18 | **`ec6b0b3a0`** | Agent SDK default | **PASS — the verdict** | Thirteenth consecutive real run, on the committed tree, against the per-run structure and with round 4 folded. 3 of 3 held-out paths `created`/`edited` and `applied`; 3 stream mutations and 3 rows naming the same files; non-decreasing across 30 top-level items at 27 distinct positions; mutations 17–22, last word at 24; 0 gap rows; 1 shell call, 0 of them ran. 47 guards proven first, over a two-run calibration state. Plan arm UNMEASURED |
| 2026-08-18 | working tree at `8b01b39a8` (rebased base), pre-commit | Agent SDK default | PASS | Twelfth consecutive real run, and the **first against the per-run structure**. 47 guards. Calibration now derives a TWO-run state and asserts no view holds another run's rows |
| 2026-08-18 | working tree at `8b01b39a8`, pre-commit | — | FAIL *(deliberate)* | The per-run boundary reopened — `gradePaths` given the whole account alongside its view, which is the shape all five pooled defects had. *"THE PER-RUN BOUNDARY IS OPEN — gradePaths takes a run view AND an account-wide value"*, before any run was dispatched |
| 2026-08-18 | working tree at `05c6d3125`, pre-commit (round 3 folded) | Agent SDK default | PASS | Eleventh consecutive real run. **44 guards** |
| 2026-08-18 | working tree at `05c6d3125`, pre-commit | — | FAIL *(deliberate)* | Gaps matched without being consumed. *"'A2 — one gap row is made to excuse two lost mutations' did not reach A2/a2-unaccounted"* |
| 2026-08-18 | working tree at `05c6d3125`, pre-commit | — | FAIL *(deliberate)* | The pathless branch counting the account's gaps globally. Both new cases red — another run's gap, and a named-path gap offered for a pathless skip |
| 2026-08-18 | working tree at `05c6d3125`, pre-commit | — | **PASS *(the mutation that should have failed)*** | Pooled plan rows allowed to outvote a run's LOST, with the combination still **in the reader**. It ran green: the guard cases feed the grader, so nothing could reach reader-side judgement. That green is the finding — the combination moved to the grader, and the same regression is now caught: *"'A5 — one run lost its plan rows and a sibling recorded fine' did not reach A5/a5-lost"* |
| 2026-08-18 | working tree at `87c3edcc0`, pre-commit (round 2 folded) | Agent SDK default | PASS | Ninth consecutive real run. **40 guards** |
| 2026-08-18 | working tree at `87c3edcc0`, pre-commit | — | FAIL *(deliberate)* | A tie allowed to certify causality again. *"'A4 — the report and the last mutation share a stream position' did not reach A4/a4-tied"* |
| 2026-08-18 | working tree at `87c3edcc0`, pre-commit | — | FAIL *(deliberate)* | Per-run scoping dropped from both of A2's pairing directions. The false red reproduces exactly: *"'A2 — two runs touched the same path and both records are faithful' did not reach A2/a2-ok with a pass; it produced ["a2-ambiguous-mutation=fail","a2-ambiguous-mutation=fail","a2-ambiguous-row=fail","a2-ambiguous-row=fail"]"* |
| 2026-08-18 | working tree at `87c3edcc0`, pre-commit (round 1 corrections) | Agent SDK default | PASS | Eighth consecutive real run. **37 guards**. Adds the world where a gap row sits beside a file row whose semantics contradict the stream — reintroducing the short-circuit is caught: *"'A2 — a gap row is present AND the file row contradicts the stream' did not reach A2/a2-kind-disagrees … it produced ["a2-ok=pass"]"* |
| 2026-08-18 | working tree at `238f71137`, pre-commit (round 1 folded) | Agent SDK default | PASS | Seventh consecutive real run, with the round-1 fixes in. 31 items at 28 distinct positions; mutations 18–23, last word at 25; 1 shell call, 0 of them ran. **36 guards**, up from 30 |
| 2026-08-18 | working tree at `238f71137`, pre-commit | — | FAIL *(deliberate)* | Assertion 2's semantic comparison removed entirely. Both new cases red: *"did not reach A2/a2-kind-disagrees … it produced ["a2-ok=pass"]"*, same for `a2-outcome-disagrees`. The world where a record says `created` about an `Edit` |
| 2026-08-18 | working tree at `238f71137`, pre-commit | — | FAIL *(deliberate)* | Assertion 2 regressed to **silently picking the first candidate** — the reviewer's P1 verbatim. *"did not reach A2/a2-ambiguous-mutation"*. This is the mutation that would have let a lost record hide behind a row sharing its tail |
| 2026-08-18 | working tree at `238f71137`, pre-commit | — | FAIL *(deliberate)* | Assertion 4 regressed to the **first** mutation. *"'A4 — the run wrote another file after its final report' did not reach A4/a4-activity-after-report"*. The `write, report, write` world a first-activity comparison certifies |
| 2026-08-18 | working tree at `238f71137`, pre-commit | — | FAIL *(deliberate)* | `const here = process.cwd();` added to the reader — **no import at all**. A8: *"reader.mts reaches `process`"*. The half a module allowlist cannot see |
| 2026-08-18 | working tree at `d513bc512`, pre-commit (behaviour-identical; only a parenthesisation and a flattened conditional changed after) | Agent SDK default | PASS | Sixth consecutive real run. 30 items at 26 distinct positions; 1 shell call, 0 of them ran |
| 2026-08-18 | `1067fa7ac` | Agent SDK default | PASS | Fifth consecutive real run, on the committed tree. 3 of 3 held-out paths present with a kind and a settled outcome; 3 stream mutations and 3 rows naming the same files; non-decreasing across 31 top-level items at 27 distinct positions; activity at 14 before the last word at 25; 0 gap rows. **1 shell call, 0 of them ran** — the refused-`Bash` case again, on the very next run after the fix for it. All paths were present, so nothing went unmeasured on that account. Plan arm UNMEASURED. 30 guards proven first |
| 2026-08-18 | working tree at `4f2f63d37`, pre-commit | Agent SDK default | PASS | First real run. 3 of 3 held-out paths `created`/`edited` and `applied`; 3 stream mutations and 3 rows naming the same files; non-decreasing across 30 top-level items at 25 distinct positions; activity at 13 before the last word at 24; 0 gap rows; 1 shell call. Plan arm UNMEASURED — 0 plan tool calls; tools used `Bash`, `Edit`, `Read`, `Write` |
| 2026-08-18 | working tree at `4f2f63d37`, pre-commit (fixture + assertion 6 strengthened) | Agent SDK default | PASS | Second consecutive run, same shape; 26 distinct positions of 30 items. 27 guards proven, up from 24 |
| 2026-08-18 | working tree at `4f2f63d37`, pre-commit (branch tags added) | Agent SDK default | PASS | Third consecutive run, 32 items at 28 distinct positions, 4 messages, 6 tool_outputs. **The run reached for `Bash`, was refused, and said so** — which is what exposed assertion 1 treating a denied shell call as grounds to call a missing path unmeasured. Fixed after this run |
| 2026-08-18 | working tree at `4f2f63d37`, pre-commit | Agent SDK default | PASS | Fourth consecutive run, with the denied-shell split in place. 30 guards proven |
| 2026-08-18 | working tree at `4f2f63d37`, pre-commit | — | FAIL *(deliberate)* | The reader stopped following `nextCursor` (page cap 1). *"CALIBRATION FAILED — the reader does not derive the known account from the known state"*, aborting **before** spending a coding run. The single-page read that would otherwise have graded a fragment while reporting on the whole |
| 2026-08-18 | working tree at `4f2f63d37`, pre-commit | Agent SDK default | FAIL *(deliberate)* | `import { readFileSync } from "node:fs"` added to the reader. Assertion 8: *"the reader imports "node:fs" — its deprivation is a parameter shape, and an import is a second way in"* |
| 2026-08-18 | working tree at `4f2f63d37`, pre-commit | — | FAIL *(deliberate)* | Assertion 2's **reverse** direction — a record row the stream never showed — disabled. Caught by its own guard case before any run was dispatched |
| 2026-08-18 | working tree at `4f2f63d37`, pre-commit | — | FAIL *(deliberate)* | Assertion 2's **forward** direction disabled. Caught four ways: the lossy calibration plus three independent guard cases. Also how the precondition masking was found — the lossy check used to return early and hide the guard table entirely |
| 2026-08-18 | working tree at `4f2f63d37`, pre-commit | — | FAIL *(deliberate)* | Assertion 5's status check (`no plan row carries a status`) disabled — a branch **no real run reaches**, so only a directly-fed world could catch it. *"GUARD NOT PROVEN — 'A5 — plan rows are worded but none carries a status'"* |
| 2026-08-18 | working tree at `4f2f63d37`, pre-commit | — | FAIL *(deliberate)* | Assertion 4's missing-report condition deleted. **Caught only after branch tags existed:** *"did not reach A4/a4-unevaluable with a fail; it produced ["a4-out-of-order=fail"]"*. The first attempt at this mutation passed — the ordering comparison absorbed the case via `null` coercion, and a status-only guard accepted it |
| 2026-08-18 | working tree at `4f2f63d37`, pre-commit | — | FAIL *(deliberate)* | Whole-segment path matching degraded to `a.endsWith(b)`. The calibration went red on `my-alpha.txt` being dragged into `alpha.txt`'s grading. **This mutation passed silently until the fixture was changed to make it fail** — the guard was there and nothing could reach it |
| 2026-08-18 | working tree at `4f2f63d37`, pre-commit | — | PASS *(model-free half)* | 30 guard cases, each breaking one assertion on purpose and pinned to the exact branch it must reach: assertion 1's seven (absent with a shell call that ran, absent with every shell call refused, absent with no shell call, all-paths-unmeasured, pending, projected-away outcome, missing kind), assertion 2's six, assertion 3's four, assertion 4's three, assertion 5's five arms, assertion 6's three, assertion 7's two. 30/30 reached the branch they name |
