# Cycle 26 — "One waiting on a person" epic wrap (FIX-2058) (2026-10-27)

Part of the [cycle ledger](../cycle-ledger.md), whose header defines the feedback classes and reading labels.

**The costliest rework this cycle was one shape: a rule about whether something happened, read off a
state that other causes also produce. Thirteen implementation findings in seven PRs had it, and the
cure each time was a mark written where the event happens. Five of twelve direction artifacts took
three or more rounds, against none in cycle 25.**

The classes, checked against the PRs:
- **(a) An event read off a state.** A rule asks *did this happen* (did this turn ask, was the task
  cancelled, were these records written lean) and answers from a state other causes also produce (the
  row has open holds, the row's status, the reader's own env). 13 findings in 7 implementation PRs,
  plus 2 at spec time (table below). Codex found a real bug in each of #3890's first three passes, two of
  them this shape, until 1bb65a34 keyed the one-wait rule on `askedInTurn`; the fourth was
  declined. #3897 found one more, and e41a5a10 made `askedOnTicket` the one predicate. The rule's root is
  at spec altitude: FIX-2131 states it on the turn (*"a turn opens at most one way of waiting on a
  person"*), and FIX-2133's cross-spec fold 8b99f811 (#3747) restated it as a state (*"a row holds an open
  question or a person suspension, never both"*), which #3881 carried onto holds (*"a row's open holds
  come from one source at a time"*). The nearest earlier class is cycle 25 (d), "can't tell" read as a positive.
  **Rung 4 for the one-wait rule (a test already in the tree, shown red on the old commit); rung 5,
  one BP-035 line, for the rest of the class, which no check can see.**
- **(b) A goal control left stale by a later commit.** Two: FIX-2224 (FIX-2133's own fix-round commit
  c67118a3 in #3890 moved the control's anchor, and a stale FAIL row in the verdict log read as current)
  and FIX-2222 (FIX-2214's rename turned FIX-2131's goal red). The premise that a control *"silently
  refused to apply"* is refuted: `goals/lib/module-patch.mts` and `module-patch-hooks.mjs` throw *"has
  nothing matching … to patch"*. Nothing re-ran the model-free goals and their controls after the later
  commit. The closure caught both. Recurs from cycles 21, 24 and 25. **Rung 3: a CI step, FIX-2225. Shown
  red on the breaking commit below; not built in this PR.**
- **(c) The closure graded by loose output,** for the seventh closure running. #3951's first Codex pass:
  *"tried.status only logged"* and *"any failure other than ok satisfies the check"*. No shared verdict
  reader in `goals/lib` yet. **Rung 1 (one reader for every closure): FIX-2226, filed.**
- **(d) Direction artifacts over the two-round budget.** #3748 (7), #3738 (6), #3743 (6), #3735 (5),
  #3747 (3). Most rounds folded mechanism-level findings rather than noting them for the implementer
  (BP-040), and several were a spec fold's own change found wrong on the next pass. All five merged on
  10-23, before #3806 (mechanism creep and `reuse-review`, 10-24) landed, and `epic-wake`'s
  `atReviewBudget()` already enforces the budget. **Rejected as a new change; next cycle measures it.**

**Proposal:** route (b) and (c) to their filed checks; keep one BP-035 line for the part of (a) no
check can see; add the class to the skill's rule → enforcer table.

**Method: scope.** 28 reviewed artifacts. The epic's Linear children and their PR attachments, read over
GraphQL and matched against `main` (`83c444b`) from 10-22 to 10-27. Spec PRs merged by branch merge, so
they were found with `git log --full-history -- specs/…`, not the first-parent log.
- **Direction artifacts (12):** the epic PR #3732; amendments #3740, #3748, #3776, #3833, #3881; the
  issue specs #3734 (FIX-2063), #3735 (2129), #3738 (2131), #3743 (2132), #3747 (2133), #3778 (2134).
- **Feature implementation (7):** #3782, #3854, #3866, #3890, #3897, #3907, and the closure #3951
  (open, partial).
- **Bugs and goal fixes the epic filed (9):** #3749, #3899, #3911, #3927, #3930, #3935, #3936, #3945,
  #3950.

**Out of the sample:** #3918 (closed, superseded by #3927); the Code Snob POC #3900, closed unmerged;
FIX-2209 (Backlog, no PR); FIX-2130 (duplicate); PRs on `main` in the span that belong to no child of
this epic.

**Endpoints and rounds.** As cycle 25: direction artifacts end at the owner's merge, and a **round** is
a distinct reviewer pass that drew a thread. Implementation **waves** are distinct passes by any
reviewer that drew a thread, clustered by timestamp. #3881, #3911, #3927, #3935, #3945 and #3950 drew
no Codex thread. Thread counts come from the review-comment listings; classes are read from the
lead point of each thread and are approximate (about ±10%). Times are UTC.

**Every act sits behind the shared `jhoffner` login**, so this entry doesn't say who merged what.

### Direction artifacts

| PR | Rounds | Endpoint | Threads | Lead classes | Shape of the review | Felt off? |
|---|---|---|---|---|---|---|
| [#3732](https://github.com/fixpoint-labs/flow-state-dev/pull/3732) epic FIX-2058 | 2 | merge 10-23 16:02Z | ~15 | over-engineered · missed-edge-case | Cursor, Codex P1 ×2, a second look; the architect's record-mismatch note after the fold. Owner's D3 folded | no |
| [#3740](https://github.com/fixpoint-labs/flow-state-dev/pull/3740) amend ER-1/ER-2 | 1 | merge 16:59Z | 3 | spec-ambiguity | **merged five seconds after Cursor's notes; Codex P2 two minutes after merge, no reply** | yes |
| [#3748](https://github.com/fixpoint-labs/flow-state-dev/pull/3748) amend: a question holds its task | **7** | merge 19:49Z | 28 | missed-edge-case · stale-restatement | a fold's own change found on the next pass three times (3f05c47, 288e653, 6718bcc); the last three passes were "stop" vs "suspension" restated in 25 places | yes |
| [#3734](https://github.com/fixpoint-labs/flow-state-dev/pull/3734) spec 2063 | 1 | merge 20:12Z | 13 | over-engineered · missed-edge-case | Cursor 8, Codex 5 | no |
| [#3735](https://github.com/fixpoint-labs/flow-state-dev/pull/3735) spec 2129 | **5** | merge 20:46Z | 16 | missed-edge-case | each fold opened the next: cross-board filing → race control → stale mirror | yes |
| [#3738](https://github.com/fixpoint-labs/flow-state-dev/pull/3738) spec 2131 | **6** | merge 20:49Z | 17 | missed-edge-case · spec-ambiguity | one claim looped (`waitForUser` input on task turns: refused r3, permitted r4), settled by the owner; a cap exception folded unbounded in r1, replaced in r2 | yes |
| [#3743](https://github.com/fixpoint-labs/flow-state-dev/pull/3743) spec 2132 | **6** | merge 20:51Z | 19 | missed-edge-case | the flip condition grew one seam per pass until generalized; the legacy guard changed three times, then ER-5 made it moot | yes |
| [#3747](https://github.com/fixpoint-labs/flow-state-dev/pull/3747) spec 2133 | **3** | merge 20:46Z | 13 | missed-edge-case | **the cross-spec fold 8b99f811 wrote "one wait per turn" as a row-state check**, the root of (a) | yes |
| [#3778](https://github.com/fixpoint-labs/flow-state-dev/pull/3778) spec 2134 closure | 2 | merge 21:18Z | 8 | missed-edge-case | Codex's second pass was on the trim fold | no |
| [#3776](https://github.com/fixpoint-labs/flow-state-dev/pull/3776) amend: four child specs | 1 | merge 21:18Z | 4 | stale-restatement | | no |
| [#3833](https://github.com/fixpoint-labs/flow-state-dev/pull/3833) amend: no default deadline | 1 | merge 10-24 13:02Z | 1 | spec-ambiguity | | no |
| [#3881](https://github.com/fixpoint-labs/flow-state-dev/pull/3881) amend: `holds[]` | 1 | merge 10-25 17:01Z | 6 | stale-restatement | Cursor only | no |

### Feature implementation

| PR | Waves | Threads | Shape of the rework | Felt off? |
|---|---|---|---|---|
| [#3782](https://github.com/fixpoint-labs/flow-state-dev/pull/3782) FIX-2063 | 5 | ~14 | **(a) ×2: durability inferred from a tool scan**, so hired workers were missed; now always durable | no |
| [#3866](https://github.com/fixpoint-labs/flow-state-dev/pull/3866) FIX-2129 | 6 | 8 | **(a) ×3: a single stop's cancel read as a task cancel** (→ a `taskCancelled` mark); the parent found by `in_progress` status (→ the run link). r3: the fix covered one path. BP-030 declined (ER-5) | no |
| [#3854](https://github.com/fixpoint-labs/flow-state-dev/pull/3854) FIX-2133 1/2 | 5 | 11 | **(a) ×2: `since` from the row's `updatedAt`; reopened keyed on the item id, not the hold id.** "0 need you" on a failed read. `vacuous-assertion`: the truth used the list's own helper | no |
| [#3890](https://github.com/fixpoint-labs/flow-state-dev/pull/3890) FIX-2133 2/2 | 4 | 10 | **(a) ×2: the one-wait rule as an open-holds guard** (r1 an owed turn erased; r3 a later stop after an answered ask) → 1bb65a34 `askedInTurn`. r2: a stale No. c67118a3 moved a control's anchor (FIX-2224) | yes |
| [#3897](https://github.com/fixpoint-labs/flow-state-dev/pull/3897) FIX-2132 | 3 | 10 | **(a) ×2: settlement after an answer by an open-hold proxy; the request identity as the turn key** (→ `runKey`). r3 on the conductor's drain, a fix round's own change | no |
| [#3907](https://github.com/fixpoint-labs/flow-state-dev/pull/3907) FIX-2131 | 3 | 7 | `goalSeekLoop` judging while an answer is awaited (fixed by reading open holds, a *now* question, so not (a)). A renewal declined `held` aborting the driver; the turn-wait key undefined | no |
| [#3951](https://github.com/fixpoint-labs/flow-state-dev/pull/3951) closure FIX-2134 | 1 so far | 9 | **(c)**, see the class list. Filed FIX-2219–2222 and 2224; run 1 missed three FIX-2133 controls | — |

### Bugs and goal fixes the epic filed

| PR | Issue | Waves | Threads | Shape |
|---|---|---|---|---|
| #3749 | 2137 | **8** | 16 | **(a): replay mode read from the recovering process's env, not the records** (→ a `lean: true` mark), at the end of a fix-opens-next chain (index allocator → fallback cursor → checkpoint restore → an unfenced `root:0` reverted) |
| #3899 | 2210 | 6 | 9 | **(a): an open question's absence read as "the board settled"**; two fix rounds opened the next (re-seed duplicate on 4a5b202, cap exhaustion on b94b438); the seed-skip marker sat in public input (BP-031) |
| #3930 | 2210 | 1 | 5 | the follow-up: a stale marker |
| #3911 | 2213 | 1 | 2 | notes |
| #3927 | 2214 | 2 | 7 | the owner renamed the reason to `waiting-on-a-user`, which made FIX-2131's goal red (FIX-2222) |
| #3935 | 2219 | 1 | 1 | positive |
| #3936 | 2220 | 2 | 3 | moved to the integration suite; BP-030 declined (ER-5) |
| #3945 | 2221, 2222 | 0 | 0 | — |
| #3950 | 2224 | 1 | 2 | (b): the control's anchor re-aimed; the harness refuses a stale control loudly |

**Load.** 49 waves over 16 implementation PRs. Six took four or more: #3749 (8), #3866 (6), #3899 (6),
#3782 (5), #3854 (5), #3890 (4). Direction: 36 rounds over 12 artifacts; 5 took three or more.

**Classes.** Direction (~143 threads): `missed-edge-case` leads, then `over-engineered` (Cursor's simplify
notes, mostly recorded for the implementer) and `stale-restatement` (#3748's sweep, #3776, #3881).
Implementation (~114 threads): `missed-edge-case` leads; (a) is 13 of them. Reading labels:
`vacuous-assertion` on 3 PRs (#3854, #3749, #3951 ×2); `overclaim` on 1 (FIX-2221, the docs said the
deadline ends only one kind of wait).

**Claims (looped / settled / verdicts):** 1 / 1 by the owner / 0 POC. #3738's `waitForUser` input on task
turns, refused then permitted, then reverted by the owner.

**Reviewer exhaustion:** none. **Merged with a finding open:** #3740 (Codex P2 after merge, *"Preserve
FIX-2123's all-parks notice rule"*, no reply). ER-2 on `main` no longer carries the flagged wording; listed
for the coordinator, not filed. **The owner's ER-5 (no old data, 10-23)** waived BP-030; four declines
cite it (#3866, #3890, #3907, #3936).

**Carried / not carried.** Cycle 25's fix (29fcad3, the 10.4 sentence and the pre-push lines), by branch
head and per commit with `git merge-base --is-ancestor`:
- Not carried: #3782 and #3749 (heads before 29fcad3), all direction artifacts (10-23).
- #3866: fix commits 100394dd and 78e3e0a3 not carried; carried from its merge of `main` (757eaea8) on.
- #3854: 07879f67 not carried; carried from bd664a3c on.
- Every other implementation PR carries it on every sampled commit.

**Epic row:**
`ways per job: stop for a person 6→2 · answer a person's stop 3→2 · tell whether a stop is a person's 3→1 ·
list what waits on a person 2→1 · a coding run asks mid-run 3→1 · make a host durable 2→1 · keep a row
from starting 1→1 · end a person's wait at a deadline 0→1 · tell whether a turn asked 0→1 · re-drain a
board without its seed 0→1 · report why a drain stopped 1→1`

## (a) An event read off a state

| PR | Rule (*did this happen?*) | Read off | Cure: a mark written where it happens |
|---|---|---|---|
| #3890 r1, r3 | did this turn already wait on a person? | the row's open holds | `askedInTurn` (1bb65a34) |
| #3897 r1 | was this answer's turn settled inline? | an open hold | fixed in #3897 |
| #3897 r2 | is this the same turn? | the request identity | `runKey` |
| #3899 r1 | has the board settled? | no open question | fixed in #3899 |
| #3866 ×3 | was the task cancelled? which task is the parent? | a stop's cancel; `in_progress` status | `taskCancelled`; the run link |
| #3749 | were these records written lean? | the recovering process's env | `lean: true` on the records |
| #3782 ×2 | does this host need durability? | a scan of declared tools | always durable |
| #3854 ×2 | when did the stop start? which hold reopened? | the row's `updatedAt`; the item id | the hold's own fields |
| #3747 (spec), #3881 | one wait per turn | what the row holds open | — (the implementations inherited it) |
| #3743 (spec) | is this a legacy row? | open/answered, then "any question asked" | an incarnation mark, then moot (ER-5) |

Each reader was the PR's own new code. Each reviewer finding named a second cause of the state that
the author hadn't counted: a later stop, an answered ask, a hired worker, a process restart. That is
BP-035's subject, the paths a change touches but didn't add code for, from the reading side. BP-035's
list names the paths by input. It has no line for the case where the state a rule reads is also
written by someone else.

## Enforcement, rung by rung

Under the skill's enforcement ladder: architecture, then types, then a CI check whose error names the
fix, then a test, then prose.

**(a) An event read off a state.**
- *Rung 1, architecture: already landed.* e41a5a10 made `askedOnTicket` (`tasks/collection/holds.ts`)
  the one turn-asked predicate. The one-wait rule, the request-end check and the settle fence all
  read it, and `turn-wait.ts`'s header says an open hold never decides this.
- *Rung 2, types: not available.* The #3890 bug was an inline `openRowHolds(row).length > 0` in
  `checkTask`, where `row` is the whole task and is needed for other reads. Narrowing a helper's
  parameter can't stop a new inline read.
- *Rung 3, a check: rejected.* A scan could ban open-hold readers from `task-request.ts` and
  `turn-wait.ts`, and it would fail on `1bb65a34^`. But it duplicates the rung-4 test below, it is
  bypassed by reading `row.holds` directly, and open-hold reads are correct elsewhere for "what waits
  on a person now" (`goal-seek-loop.ts`, `board-meta.ts`, the settle fence).
- *Rung 4, a test: in the tree, and shown red on the real mistake.* 1bb65a34 added *"a turn that asked
  and was answered before it stopped for the user opens no stop on the row"* to
  `settles-when-its-work-is-over.test.ts`. Run against `1bb65a34^`'s source, it fails
  (`expected [ { …(5) } ] to deeply equal []`: a stop hold opened beside the owed turn). On this
  branch's head (9e5c57be) it passes.
- *Rung 5, prose: kept, for the rest of the class.* The other ten implementation instances are in unrelated code: a
  durability scan, the replay env, a stop's cancel read as a task's, a status read as a parent link.
  What they share is a judgment about which state means what, and no check sees that. That leftover
  judgment lands as the shortest home on the landing ladder: one line in BP-035's second-path
  checklist, an existing universal BP.

| File | Now | Proposed |
|---|---|---|
| `docs/contributing/best-practices.md` · BP-035 Rule | seven path bullets, ending *"React derived state — …"* | an eighth: *"An event read off a state — a rule asking 'did X happen?' reads a mark written where X happens, never a state other causes also produce (tenet 5)."* |
| `CLAUDE.md` · Best practices, BP-035 line | *"…cost-observability / React-derived-state paths…"* | *"…cost-observability / React-derived-state / event-read-off-state paths…"* |
| `.agents/skills/distill-lessons/SKILL.md` · Rule → enforcer | — | *"A rule asking 'did X happen?' reads X's mark, not a state (BP-035)"* · the behaviour test at each fix (the one-wait rule: `settles-when-its-work-is-over.test.ts`); judgment otherwise · test + docs |

No eval ran: `eval.md` is for a skill line that can't be encoded, and none of these is one. The BP
line goes to the owner's review on this PR (Step 6), in its own commit.

**(b) Stale goal controls, rung 3: FIX-2225.** The step to build: CI runs `pnpm goal:all --model-free`,
then each documented control, and requires each control to fail **its named assertion**. Evidence, run
model-free in a throwaway worktree at `ccdeda62` (after FIX-2214's rename and c67118a3, before #3945
and #3950) and at `9dec9b5a` (both fixes):

| Check | At `ccdeda62` | At `9dec9b5a` |
|---|---|---|
| `asks-a-person-one-way`, `GOAL_LEGS=h` (FIX-2222) | exit 1, `FAIL — h:reports-blocked … terminationReason":"waiting-on-a-user"` | exit 0, `PASS — h: the plan board stopped waiting-on-a-user 84 ms after it started` |
| `holds-a-task-on-questions`, `GOAL_CONTROL=release-on-first` (FIX-2224) | exit 1, `internal.ts has nothing matching /import \{ droppedMirror, hasOpenHold,/ to patch` | exit 1, `FAIL — b:still-held — t1 started on its first answer` (the control's required failure) |

The second row matters for how FIX-2225 is built. A control is *meant* to exit non-zero, so a step that
only checks the exit code reads the broken control as passing. The step has to match the named
assertion. That is the comment to add to FIX-2225; it is not built here, since it is CI code with its
own review.

**(c) Loose closure grading, rung 1: FIX-2226,** a shared verdict reader in `goals/lib`, filed.

## Accepted and Rejected

**Accepted:**
- (a): the BP-035 line, plus the rule → enforcer row naming the test that guards the one-wait rule.
- (b): FIX-2225 as the enforcer, with the evidence above.
- (c): FIX-2226 as the enforcer.

**Rejected:**
- *A scan banning open-hold reads in the turn-asked files.* It is already a check: the rung-4 test
  covers it, and it doesn't reach the other ten.
- *(b) or (c) as text.* Each already has a check, filed.
- *(d) as a rule.* It is already a check: BP-040 states it, and `atReviewBudget()` enforces it. #3806
  landed after these specs.
- *BP-030 declines under ER-5.* One-off: an owner waiver, not a recurring miss.
- *#3740's post-merge finding.* One-off; listed for the coordinator.

## Job audit

The PR body lists every addition the batch made and the job it does. Eight jobs came from the merged
specs' *What's already here* tables (the epic's, FIX-2063's, 2129's, 2131's, 2132's and 2133's); their
counts are the specs'. The impl diffs added three jobs no spec recorded, checked on `main` inline,
scoped across packages:
- **tell whether a turn asked, 0→1.** `askedOnTicket` (`tasks/collection/holds.ts`) is the one predicate
  the one-wait rule, the request-end check and the settle fence share (e41a5a10). The request-end check
  ORs in its own request's `askedQuestions` flag, a second mark of the same event on a different
  record, not a second reader. Coherent.
- **re-drain a board without its seed, 0→1.** FIX-2210's skip, moved out of public input by #3930.
  Coherent.
- **end a person's wait at a deadline, 0→1.** One host setting, `userDeadlineMs`, closes both kinds of
  wait; FIX-2221 fixed docs that said otherwise. Coherent.

No fold filed. *Report why a drain stopped* gained a value (`waiting-on-a-user`), not a way.

## Scoring the previous cycle's fix and claims

- **Claim 1 (do fix rounds stop opening the next finding?):** carried, about 9 in 5 PRs (#3854 ×2,
  #3890, #3897 ×2, #3899 ×3, #3930); not carried, about 7 in 3 (#3749 ×4, #3782 ×2, #3866). Baseline 17
  in 11. Down, on a smaller batch. #3899's fix-round seed-skip marker took more than its finding needed
  and drew a BP-031 finding.
- **Claim 2 (a reviewer deletes a fix line and the suite stays green):** 0 of that exact shape. Baseline
  9 PRs.
- **Claim 3 (retired-word commits):** 4 vocabulary-only commits after the hook (#3854: 4167a186,
  59a00c21; #3890: 70b6254d, 1d7e0020), 3 before it (#3749 b91f1499; #3866 2717f14d, 2eb76dc5). Baseline
  10. The commits can't tell a local hook catch from a CI catch.
- **Claim 4 ((c) on the next closure):** yes, the seventh. No shared reader.
- **Claim 5 (closure findings that are goals out of date with the epic's merges):** 2 (FIX-2222,
  FIX-2224). Baseline 8 plus 5 controls.

## Claims to test next cycle

1. **Event-read-as-state findings.** Count findings where a rule about whether something happened read
   a state other causes also produce. Baseline: 13 in 7 implementation PRs, 2 at spec time.
2. **Direction artifacts past two rounds,** after #3806. Baseline: 5 of 12.
3. **Stale goal controls.** Baseline: 2. If CI runs the model-free goals and their controls, expect 0.
4. **(c) on the next closure.** Baseline: seven closures running.
