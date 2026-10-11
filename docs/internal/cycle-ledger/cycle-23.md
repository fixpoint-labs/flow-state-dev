# Cycle 23 — Hand-offs epic wrap (FIX-1815) (2026-10-11)

Part of the [cycle ledger](../cycle-ledger.md), whose header defines the feedback classes and reading labels.

**Cycle 22's re-aimed race trigger landed, and the one tail it missed fell outside its definition.**
Two concurrency tails reached a named primitive at round 3: #2964's deadline re-arm and #3014's
follow-up and reassignment fence. Cycle 20's baseline was rounds 10–13. The longest tail this cycle
was #2964's stop path, six rounds (r3–r9). It was not a race between two runs. It was a crash
between two writes: a suspension persisted but its status not yet committed, or a gate written but
no log entry. The trigger defines its class as *"a read and a later act on state another run,
process or reused id can change in between"*. A crash window doesn't fit that wording, so nothing in
the rule fired, even though Codex opened four of those six findings with *"Fresh evidence beyond the
earlier … fix"*.

The classes the coordinator named, checked against the ledger:
- **(a) Crash-window tails.** New to the ledger. 16 Codex findings across #2964, #2999, #3015 and
  #3032 name a process dying between two writes. One became a six-round tail. **Proposed below.**
- **(b) A closure control that passes on the wrong red.** This is the fourth closure in a row
  (cycles 19, 21, 22, 23). #3045 Codex P1: *control grading too loose (unrelated red passes)*.
  #3048 Codex P1: `alsoRed` was optional. Once grading was exact, it found FIX-1867, a control
  whose red set depended on the model. Each of the four closures hand-rolls its own grader. FIX-1183
  has been in Backlog since 09-18. **An owner ask, not text.**
- **(c) Implementation PRs merged before their last review's findings were fixed.** #3015 merged
  at 13:30Z, and Codex's fourth pass on that head posted five P2s at 13:34Z. #3045 merged 10 minutes
  after Codex's two P1s on its only head. Both were routed to follow-up PRs (#3032, #3048), so
  nothing was lost. This is the third cycle in a row (#2434, #2633). **Not proposed.**
- **(d) Reviewer exhaustion.** Codex and Cursor rate limits left an in-repo review agent as the
  review of record on #3053. It found one real gap (F1, red→green). **Recorded.**
- **(e) One-off process slips:** a sub-agent dropped PLAN Part 3 (the gap sweep) from #3048's body,
  and the auto-mode classifier blocked a Linear read after a self-merge. **Dropped.**

**Proposal:** one sharpened sentence in existing text. `issue-implement` 10.3's race trigger names
the crash window and the reviewer's reopening phrase.

**Method: scope.** 21 reviewed artifacts. The epic's Linear children (FIX-1816, 1817, 1818
(Canceled), 1820, 1844, 1845, 1846, 1867) were read over GraphQL. The 400 newest repository PRs were
matched on those ids and `hand-offs` in the title, branch or body.
- **Direction artifacts (9):** the epic PR #2891, its amendments #2893 (Q1/Q3) and #2904 (ER-11
  and cross-spec record), the issue specs #2900 (FIX-1816) and #2899 (FIX-1817), the cross-spec
  alignments #2905 and #2906, the FIX-1816 owner amendment #2948, and the closure plan #3036
  (FIX-1820).
- **Implementation (12):** #2912, #2920, #2922, #2964, #3015 and #3032 (FIX-1816); #3014
  (FIX-1817); #2999 (FIX-1846); #3045 and #3048 (FIX-1820); #3053 (FIX-1844); #3052 (FIX-1867).
  FIX-1845 has no PR of its own. #2964's eighth round closed it, deleting `abortParked`.

**Out of the sample:**
- The Code Snob POCs #2927, #3000 and #3054, each folded into its parent by hand and closed unmerged.
- #3001, the overdue-ask deflake. It came from another session and was merged with one Cursor
  pass. #3004 was its duplicate, closed unmerged.
- #2935 (FIX-1794 P2) and #3003 (FIX-1802 P1). These are FIX-1786's inputs to this epic and belong
  to that epic's ledger.

**Endpoints and rounds.** Direction artifacts end at the owner's merge, as in cycles 21 and 22.
Implementation waves use cycle 22's mechanical count: distinct Codex-reviewed heads that drew at
least one thread. A Cursor-only PR reads 0. Acted, declined and deferred come from each thread's
last reply. The mailbox identity header is stripped first, then the reply is classed by its first
word: *Fixed / Done / Folded / Applied / Taken / Trimmed / Cut / Adopted / Added…* is acted;
*Stays / Staying / Kept / Leaving…* is declined; *Filed / tracked / The gap is real…* is deferred.
Totals are thread counts, comparable to cycle 22's and not to cycle 21's.

**Every act sits behind the shared `jhoffner` login.** Who merged what is taken from the
coordinator's notes (`.orchestration/epic.md`), not inferred from the login.

| PR | Kind | Rounds / waves | Endpoint | Acted · declined (· deferred) | Shape of the rework | Felt off? |
|---|---|---|---|---|---|---|
| [#2891](https://github.com/fixpoint-labs/flow-state-dev/pull/2891) epic FIX-1815 | epic | 1 | merge 10-08 20:58Z | 0 · 0 (8 Cursor threads fanned out as implementer notes) | Q2 settled with FIX-1786's coordinator and folded at `6074cb44`. **No Codex** | no |
| [#2893](https://github.com/fixpoint-labs/flow-state-dev/pull/2893) amend Q1/Q3 | epic (amend) | 1 | merge 10-08 21:38Z | 3 · 1 | record-only; the owner cut FIX-1818 and FIX-1819. **No Codex** | no |
| [#2904](https://github.com/fixpoint-labs/flow-state-dev/pull/2904) amend ER-11 + cross-spec | epic (amend) | 1 | merge 10-08 22:01Z | 5 · 1 | stale-restatement ×2 (the L2 wording, FIX-1537's EVOLUTION row); the auto-mode classifier refused the standing merge authorization for a material amendment | no |
| [#2900](https://github.com/fixpoint-labs/flow-state-dev/pull/2900) spec FIX-1816 | spec | 2 | merge 10-08 21:39Z | 10 · 2 | round 1: the timeout had no resume path. Round 2 was the **owner's design call**: drop `askTask`, use `addTask(…, { waitForResponse: true })`. The restraint pass cut nested asks, a testing helper and `timeoutMs` (about −0.8k of 2.4k). **No Codex** | yes (owner) |
| [#2899](https://github.com/fixpoint-labs/flow-state-dev/pull/2899) spec FIX-1817 | spec | 1 + restraint churn | merge 10-08 22:00Z | 3 · 2 | the restraint pass cut the BR-25 one-at-a-time scan, assuming the engine serializes a session. A correction showed the default is `allow`. `queue` was proposed and rejected. BR-25 was restored. **Claim looped** (see Claims). **No Codex** | no |
| [#2905](https://github.com/fixpoint-labs/flow-state-dev/pull/2905) FIX-1816 alignment | spec (amend) | 1 | merge 10-08 21:59Z | 4 · 0 | Cursor CHANGES_REQUESTED; one direction change: the ask gate binds row identity and settlement. **No Codex** | no |
| [#2906](https://github.com/fixpoint-labs/flow-state-dev/pull/2906) FIX-1817 alignment | spec (amend) | 1 | merge 10-08 22:14Z (coordinator, standing authorization) | 2 · 2 | five cross-spec alignments, none refused. **No Codex** | no |
| [#2948](https://github.com/fixpoint-labs/flow-state-dev/pull/2948) FIX-1816 amend (stop, timeout) | spec (amend) | 1 | merge 10-09 18:10Z | 5 · 2 | owner scope: stop a paused ask, configurable timeout. Codex P1: *nothing re-drives a suspended request whose gate is resolved*, which also affected shipped P2. That became BR-11a | no |
| [#3036](https://github.com/fixpoint-labs/flow-state-dev/pull/3036) spec FIX-1820 (closure plan) | spec | 1 | merge 10-10 19:37Z | 0 · 0 (6 Cursor threads unanswered) | the restraint pass trimmed it from about 900 lines to 450 before the gate. **No Codex** | no |
| [#2912](https://github.com/fixpoint-labs/flow-state-dev/pull/2912) impl FIX-1816 P1 | impl | 1 | merge 10-08 23:36Z (coordinator, on the owner's "merge it") | 4 · 2 · 1 | Codex P1: the gate id was ambiguous across concurrent requests in a session | no |
| [#2920](https://github.com/fixpoint-labs/flow-state-dev/pull/2920) impl FIX-1816 P2 | impl | 0 (Cursor only) | merge 10-09 02:05Z | 3 · 0 | Code Snob subtraction from POC #2927 | no |
| [#2922](https://github.com/fixpoint-labs/flow-state-dev/pull/2922) impl FIX-1816 P2b | impl | 0 (Cursor only) | merge 10-09 02:07Z | 2 · 1 | stacked on #2920, retargeted to `main` when #2920 merged | no |
| [#2964](https://github.com/fixpoint-labs/flow-state-dev/pull/2964) impl FIX-1816 P2c | impl | **9** | merge 10-10 00:57Z (owner accepted the FIX-1844 gap) | 36 · 0 · 2 | **three tails** (see (a)): deadline re-arm r1–r3, **named at r3**; stop crash window r3–r9, **never named**; cleanup debt r4–r7, deferred to FIX-1844 and FIX-1845. 16 P1s, and 12 findings open *"Fresh evidence beyond the earlier … fix"*. The coordinator stopped requesting reviews after r9. Docker Hub rate limits failed CI twice | no |
| [#2999](https://github.com/fixpoint-labs/flow-state-dev/pull/2999) impl FIX-1846 | impl | 3 (+ r4 clean) | merge 10-10 11:24Z | 9 · 1 | expiry write race, fenced on round 2 (`expireUnderLease`). The owner's answer was first recorded backwards ("ends the turn") and corrected within minutes. A flake hypothesis (a held lease) was **refuted** by diagnosis: the cause was test timing, already fixed on `main` by #3001 | no |
| [#3015](https://github.com/fixpoint-labs/flow-state-dev/pull/3015) impl FIX-1816 P3 | impl | 3 + 1 after merge | merge 10-10 13:30Z | 9 · 2 (+ 5 unanswered) | crash windows (the notice cleared before resume; the ask id persisted after filing); the direct-router sweeper fact. **(c)**: Codex's fourth pass on the merged head posted at 13:34Z, and all five findings went to #3032 | no |
| [#3014](https://github.com/fixpoint-labs/flow-state-dev/pull/3014) impl FIX-1817 | impl | **5** | merge 10-10 13:53Z | 16 · 5 · 3 | **follow-up and reassignment race**: r1 exclusivity (concurrent `addTask` in one turn), r2 the answered-row fence, r3 the fence not atomic. **Root cause named at r3**: the rules moved into an atomic `setAssignee`. The r4 reopening (answered + blocked) was keyed on the unconsumed answer. FIX-1860, 1864 and 1865 filed | no |
| [#3032](https://github.com/fixpoint-labs/flow-state-dev/pull/3032) impl FIX-1816 follow-ups | impl | **5** (+ r6 clean) | merge 10-10 19:36Z | 12 · 3 | #3015's post-merge findings. A crash and rolling-deploy tail (legacy `runOnce` key r1, r4, r5; process death r1, r4); r5 declined as equal to the shipped baseline. The re-drive test exposed a real bug (restart reported `wait_task_cancelled`) | no |
| [#3045](https://github.com/fixpoint-labs/flow-state-dev/pull/3045) closure FIX-1820 | impl (closure) | 1 | merge 10-10 21:10Z, **10 min after Codex's two P1s, unfixed** | 3 · 5 | **(b)**: P1 control grading too loose; P1 J4 didn't prove the ticket was drawn before the kill; P2 still-answers had no status check. **(c)**: routed to #3048 | no |
| [#3048](https://github.com/fixpoint-labs/flow-state-dev/pull/3048) closure checks FIX-1820 | impl (closure) | 1 | merge 10-11 18:28Z | 1 · 4 | **(b)** again: P1 `alsoRed` optional, so require exactly `mustFail ∪ alsoRed`. The exact rerun found FIX-1867. The final closure ran on `2e940454d`. **(e)**: a sub-agent dropped PLAN Part 3 from the body, and the coordinator sent it back | no |
| [#3053](https://github.com/fixpoint-labs/flow-state-dev/pull/3053) impl FIX-1844 | impl | 0 (**Codex and Cursor rate-limited**; in-repo review of record) | merge 10-11 01:36Z | 0 · 3 (+ in-repo F1, F3 applied) | in-repo F1: the touch must re-check `row.cancelOwed` (red→green) | no |
| [#3052](https://github.com/fixpoint-labs/flow-state-dev/pull/3052) impl FIX-1867 | impl | 0 (**rate-limited**; Cursor approved later) | merge 10-11 01:37Z (**coordinator self-merge**, Architect Approved, blocking FIX-1820) | 1 · 2 | the drop-answer control now patches a decoy answer, so a re-ask can't widen the red set. The auto-mode classifier then denied a Linear read as *"Merge Without Review"* | no |

**Load.** 29 waves over the 12 implementation artifacts (cycle 22: 104 over 21; cycle 21: 29 over
29). No PR reached 10 waves (cycle 22: seven did). Three carry 19 of the 29: #2964 9, #3014 5, #3032 5.
About 96 acted threads in implementation and 32 in direction artifacts. No direction artifact took
a third round. #2900's second round was the owner's direction call, recorded as `design-off` from
the owner. Compare wave counts across cycles, not thread totals (see Method).

**Claims (looped / settled / verdicts):** 1 / 0. On #2899 the claim *"the engine serializes a
session's turns, so BR-25's follow-up scan is redundant"* was argued at the restraint pass, then
corrected (`allow`), then argued again (`queue`), and settled by reading the code. BR-25 was
restored. The premise came back as #3014's r1 P2 (two `addTask` calls in one turn run concurrently)
and took that PR three rounds to close. Settling it with a POC would have tested parallel tool calls
in one turn. Argument tested only the engine's policy. One instance, recorded.

**Reviewer exhaustion:** 12 of 21 artifacts had no Codex pass on any head (cycle 22: 4). That is
eight of the nine direction artifacts, all reviewed on 10-08, plus #2920, #2922, #3052 and #3053.
Bugbot reported its usage limit on 11 PRs.
**Unread merged heads:** 9 of 12 merged implementation PRs had no Codex review of their merged head
(cycle 22: at least 9 of 19). Two of the nine moved only by a merge of `main` (#2999) or a docs-only
fix (#3014). Read from Codex's reviewed commits against each PR's final head.

**Carried / not carried.** Cycle 22's fix commit `7e56e4bf9` (10-06 18:03Z) is an ancestor of the
first head of every implementation PR here (`cd6f7fb7`, `0b57bc97`, `e4576977`, `cd180d7f`,
`5181ddba`, `be1bddfa`, `038b220c`, `f7496a00`, `5a024137`, `27923ec5`, `bc4a613b`, `10ded493`),
checked with `git merge-base --is-ancestor`. The whole sample carries it.

## (a) The tail the trigger didn't name: two writes a crash can split

| PR | Tail | Rounds | Where it ended | Codex's own reopening phrase |
|---|---|---|---|---|
| #2964 | deadline re-arm (an ask's deadline lost while a sweep runs, on lease loss, or in the publish window) | r1–r3 | **r3**: *"re-arm derived from durable earliest pending deadline (root cause, 3 rounds of deadline patches)"*; the r1 and r2 special cases were deleted | r2, r3 ×2 |
| #3014 | follow-up exclusivity and the answered-row fence | r1–r4 | **r3**: *"ROOT CAUSE: assignee rules as pre-reads → move into atomic setAssignee"* | r4 ×2 |
| #2964 | **a stop recorded while a suspension is half-committed**: r3 stop in the suspend-commit window; r4 the parking bridge fails; r5 the process dies after `abortRequested`; r6 an interrupted ask with no log entry; r8 the process dies after the gate and item are persisted but before the status commit; r9 a pre-log ask's stop | **r3–r9** | r8 deleted `abortParked` and routed approval stops through the continuation; r9's remainder folded into FIX-1844; the coordinator stopped requesting reviews | r4, r5, r6, r9 |

The first two are what cycle 22's sentence was written for, and both fired at round 3. The third
is the same shape: one invariant, reopened round after round, with Codex saying so in the opening
words of the finding. The atomic operation it needed was never named. The candidate is one write
for gate, log entry and status, or a recorded intent that recovery replays. The rule was in the
tree and didn't fire because its definition of the class is *a read and a later act that another
run can split*. Nothing in this tail is a second run. The process that acts on the half-written
state is the same flow after a restart.

The class reaches beyond #2964. 16 of the 82 Codex findings on implementation PRs name a process
dying between two writes (#2964 7, #3032 5, #3015 2, #2999 1, #3045 1). This was a durability epic,
so the rate is expected. A trigger that excludes the class isn't.

## (b) The fourth closure whose controls passed on the wrong red

| Cycle | Closure | First-head finding | Grader |
|---|---|---|---|
| 19 | #2348 | controls matched by leg; a leg that never ran read green | `kitchen-sink-talk/…/run.mts` |
| 21 | #2709 | `GOAL_PART=bogus` printed PASS | `shift-manager/…/run.mts` |
| 22 | #2781 | a child control accepted on any nonzero exit | `manager-queue-lab/…/run.mts` |
| 23 | #3045 → #3048 | any red passed; then `alsoRed` optional | `hand-offs/survives-a-restart-and-runs-once/run.mts` |

Each was found on the first reviewed head, as in cycle 22. This time the fix took two PRs, because
#3045 merged before its finding was fixed (see (c)). The exact grader then surfaced FIX-1867. With
the decoy answer gone, a model that re-asks reddens 11 assertions instead of one, so the control
had no stable red set.

All four closures hand-roll their own control grader, and none lives in `goals/lib/verdict.mts`.
The hand-offs one is the strictest so far: red exactly `mustFail ∪ alsoRed`. FIX-1183 (*"A goal
check can report PASS while asserting over zero evidence"*) has been in Backlog since 09-18. Cycle 22
held that prose can't make this cheaper than one wave. The fourth recurrence is the evidence for
lifting this grader into `goals/lib` and scheduling FIX-1183. **That is code and scheduling, not
grounding, so it goes to the owner as an ask** and isn't written here.

## The proposed upstream fix: one sentence, in existing text

| File | Now | Proposed |
|---|---|---|
| `.agents/skills/issue-implement/SKILL.md` · 10.3, the race trigger | *"When a finding is an interleaving — a read and a later act on state another run, process or reused id can change in between — a fix that only narrows the gap…"* · *"…a second finding that reopens the same race (the same invariant an earlier round already fixed) is the trigger…"* · *"(a conditional write, a per-attempt id, a namespace)"* | *"…can change in between, or two writes a crash or restart can split —"* · *"…already fixed; a reviewer's "fresh evidence beyond the earlier … fix" says so) is the trigger…"* · *"(a conditional write, a per-attempt id, a namespace, one write or a recorded intent recovery replays)"* |

This sharpens cycle 22's sentence. It adds no rule. The first clause brings the crash window into
the trigger's class. The second names the reopening signal the reviewer already prints, so whether
a finding reopens the class becomes a matter of reading the finding, not of the author's own
judgement. Cycle 22 aimed at that same self-judgement. The third clause gives the crash case its
primitive.

## Candidates considered and dropped

- **A new BP for durable multi-write paths.** BP-035's second-path checklist already names the
  `cancel-error` path, and the trigger is where the tail gets cut. A BP would duplicate both.
- **(b) as text.** Covered, caught on first read every time; its fix is code (above).
- **(c) Merged before the last review's findings were fixed** (#3015, #3045; #2434 and #2633
  before). Owner merges, nothing lost, and orchestration already routes post-merge feedback to a
  new PR. #3048's stricter rerun is what found FIX-1867. Third cycle running; hold.
- **(e) A sub-agent dropping a required PR-body section** (#3048 Part 3). One instance, caught
  before merge.
- **(e) The auto-mode classifier blocking work after a self-merge, and refusing standing merge
  authorization on #2904.** Environment, not a rework class.
- **The looped engine-serialization claim on #2899.** One instance, and the trigger already exists
  (`settle-claim`, *argued twice*). Recorded under Claims.
- **Owner answers recorded wrong** (FIX-1846, corrected in minutes). One instance.

## Scoring the previous cycles' fixes and claims

- **Cycle 22's claim 1 (does the re-aimed race trigger fire by round 3?): yes, on both qualifying
  concurrency tails.** #2964's deadline re-arm and #3014's fence were both named at r3 (baseline
  rounds 10, 13, 11). It missed the crash-window tail (r3–r9), which its definition excludes. This
  cycle's proposal widens it. All carry `7e56e4bf9`.
- **Cycle 22's claim 2 (does a model-backed goal grade data or prose?): 0 instances of the
  retelling shape.** `task-session-stays-open` grades same-session and one-draw on stored rows. It
  grades names-ticket and names-region on output, which is right for a claim about what the session
  remembers. The new shape, FIX-1867, is a control whose red set depended on the model. One
  instance, fixed with a deterministic decoy. Recorded under (b).
- **Cycle 22's claim 3 ((b) on the next closure): yes, on the first head and again on the
  follow-up.** FIX-1183 has not landed. Fourth closure in a row.
- **Cycle 22's claim 4 (changeset length): 2** (#2964 r2, #3014 r4), down from 6.
- **Cycle 21's claim 2 (reviewer exhaustion): 12 of 21**, up from 4. Driven by 10-08's direction
  artifacts and 10-11's rate limit.
- **Cycle 21's claim 3 (unread merged heads): 9 of 12**, up from at least 9 of 19.

## Claims to test next cycle

1. **Does the widened trigger name a crash-window primitive by round 3?** For each implementation
   PR with two or more findings that reopen one crash window, record the round of the first named
   primitive or deferral. Baseline: #2964's stop tail, r3–r9, never named.
2. **Are reopenings counted from the reviewer's marker?** Count findings that open *"Fresh evidence
   beyond"* and the round each tail closed. Baseline: #2964, 12 such findings over 9 rounds.
3. **(b) on the next closure,** and whether a shared control grader or FIX-1183 has landed.
   Baseline: four closures running.
4. **Reviewer exhaustion on direction artifacts.** Baseline: 8 of 9 with no Codex pass.
