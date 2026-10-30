# Cycle 27 — "See how much subscription usage each harness has left" epic wrap (FIX-2139) (2026-10-29)

Part of the [cycle ledger](../cycle-ledger.md), whose header defines the feedback classes and reading labels.

**A small epic: three specs, three feature PRs. The rework sat in two implementation PRs, and it had
one shape. A record or count that more than one writer, attempt or process touches was given its
ordering rules one review pass at a time. #4013 spent all twelve auto-handled rounds that way, and
#3795 spent four. Direction artifacts converged in one to three rounds.**

The classes, checked against the PRs:
- **(a) Interleaving and crash-window tails, fixed one window per pass.** #4013 (FIX-2145): the
  request's spend moved to an in-memory ledger (D3), and Codex found a new way to lose or double-count
  it on most of its twelve passes: a suspension, a client disconnect, a process crash, an `onFinished`
  that is still running, an older ending that finishes after a continuation, a failed `onStarted`, its
  side chains, a live attempt counted twice, a dead run's flag left set, and harness steps across a
  crash. #3795 (FIX-2142) did the same on one usage record shared by run writes and refreshes:
  account rebinds, `accountAt`, the no-subscription barrier and a failed look, over four passes, after
  #3771's spec had already spent three rounds on the account order. **`issue-implement` 10.3 already
  names this trigger** (*"a second race on the same structure is a missing primitive"*). Neither PR
  named a primitive or filed one. #4013's closing shape (recover from the log past a cursor, a523e9d,
  answering pass 4) came mid-chain, and the tail moved on to FIX-2323 after FIX-2288. Recurs from cycles
  22, 23 and 25. **The rule is written and was not applied. Proposed below: put the question in
  `epic-wake`'s dispatch at round 4 (not built here).**
- **(b) An event read off a state**, cycle 26's class (a). 3 in #3795 (none carried the cycle-26
  line) and 2 in #4013 (carried). See *Scoring* below.
- **(c) Two PRs merged on stale heads, and `main` went red.** #3768 and #3795 were last pushed on
  10-23 and merged on 10-25 at 20:06Z. FIX-2162 (#3857, #3870) had changed the Lab client API on 10-24,
  so `main` failed Typecheck and `usage.test.ts` until #3888 merged at 21:54Z. #3889 carried the same
  port. Recurs from cycle 24 (c). GitHub does not require a branch to be current before merge. **An
  owner ask, not text:** turn on "require branches to be up to date" or a merge queue.
- **(d) A direction artifact merged before its requested Codex pass posted.** #3771 merged at
  20:54:30Z. Codex's third pass, which the PR had asked for at 20:53, posted three P1s at 20:58. All
  three were fixed in #3795 within the hour, so nothing was lost this time. Recurs from cycle 24 (d)
  and cycle 26 (#3740). **An owner ask, not text.**
- **(e) Docs that restate a list.** #3916 (FIX-2217): a lab listed the slot's feeds by name and
  dropped `onUsage`, because the docs it copied did the same. #4013's one P1 was the architecture docs
  still saying `tokenUsage` sums traces. Both `stale-restatement`. The first is now a fold, FIX-2327.

**Proposal:** one change, for (a), in `epic-wake`'s PR-feedback dispatch. It is not built in this PR.
(c) and (d) are owner asks. (b) is scored, with nothing new proposed.

**Method: scope.** 11 reviewed artifacts. FIX-2139's Linear children and their PR attachments, read
over GraphQL, plus a GitHub search for PRs naming FIX-2139, 2141, 2142 or 2145. Review data read from
the REST API (reviews, review comments, issue comments, commits). FIX-2139 has no epic spec PR. The
brief lives on the Linear issue, and FIX-2141's spec carries the shared contract, so the epic PR row
is absent by construction, not zero.
- **Direction artifacts (3):** #3759 (FIX-2141), #3771 (FIX-2142), #3886 (FIX-2145).
- **Feature implementation (3):** #3768, #3795, #4013.
- **Fixes the epic caused (3):** #3888 (the port after FIX-2162), #3889 (a clock-pinned test that
  also carried the port), #3916 (FIX-2217).

**Out of the sample:** FIX-2140 (duplicate), FIX-2143 and FIX-2144 (on hold, no PR). #4149 is
FIX-2288's PR. It is stacked on #4013 and attached to FIX-2145 in Linear, but it belongs to its own
issue. Cursor's POC #3923 was closed unmerged and folded into #3916. FIX-2162's #3857 and #3870 are
the other side of (c), not this epic's work.

**Endpoints and rounds.** As cycle 26: direction artifacts end at the owner's merge, and a **round** is
a distinct reviewer pass that drew a thread or a hold. Implementation **waves** are distinct passes by
any reviewer that drew a thread, clustered by reviewed head. Cursor's notes on spec PRs were recorded
for the implementer each time (BP-040) and are classed `over-engineered` or `nit`. Classes come from
the lead point of each thread and are approximate (about ±10%). Times are UTC.

**Every act sits behind the shared `jhoffner` login**, so this entry doesn't say who merged what.

### Direction artifacts

| PR | Rounds | Endpoint | Threads | Lead classes | Shape of the review | Felt off? |
|---|---|---|---|---|---|---|
| [#3759](https://github.com/fixpoint-labs/flow-state-dev/pull/3759) spec 2141 | 1 | merge 10-23 19:52Z | 8 | over-engineered · missed-edge-case | Second look, Cursor, Codex and the Architect all on `726441e`. Adopted: the run hook moved to 2142, one current record per harness (Codex P1), the query became a flow action (Codex P1: a capability adds no route), single-flight refresh | no |
| [#3771](https://github.com/fixpoint-labs/flow-state-dev/pull/3771) spec 2142 | **3** (third after merge) | merge 20:54Z | 17 | missed-edge-case | Cursor's seven notes recorded, one of them *"a single named merge spec … would shrink implementer error surface."* Codex's account-ordering findings ran 3 → 4 → 3, each pass on the previous fold's rules. **Merged 3.5 min before the requested third pass posted three P1s** (d) | yes |
| [#3886](https://github.com/fixpoint-labs/flow-state-dev/pull/3886) spec 2145 | 2 | merge 10-27 21:44Z | 9 | over-engineered · missed-edge-case | r1: Codex P2 ×2 (suspended and killed runs keep their spend), folded. r2: the Architect held on a second `onRequestEnded` on the session config, folded to one registry (the job check working) | no |

### Feature implementation

| PR | Waves | Threads | Shape of the rework | Felt off? |
|---|---|---|---|---|
| [#3768](https://github.com/fixpoint-labs/flow-state-dev/pull/3768) FIX-2141 | 3 | 13 | `CODEX_API_KEY` stripped from the usage read, then a saved login read over an API key; fractional percent rounded; a failed reread hidden by old rows; a sync throw; **multi-tenant ×2** (the single-flight key and the reader session, BP-035). Cancel-on-abort declined after an Architect hold. Codex hit its usage limit twice. **Merged on a 10-23 head (c)** | no |
| [#3795](https://github.com/fixpoint-labs/flow-state-dev/pull/3795) FIX-2142 | 4 | 13 | **(a) on the usage record** r2–r4: a timed-out probe read as signed-out; run-only windows cleared by a failed first look; a failed look blocking runs; **cb079fca's own change** reopened the barrier; an unanswered look advanced `accountAt`. Codex hit its usage limit twice. **Merged on a 10-23 head (c)** | yes |
| [#4013](https://github.com/fixpoint-labs/flow-state-dev/pull/4013) FIX-2145 | **12** (the cap) | 29 | **(a) across durable boundaries, ~11 findings on 10 passes.** At least 4 fix rounds opened the next finding (71ba6e2, 04c7c1b, 20694f0 ×2). Cursor: one cache-token reader (folded, c41797b). P1: architecture docs still said `tokenUsage` sums traces (`stale-restatement`). Code Snob POC #4014 folded | yes |

### Fixes the epic caused

| PR | Issue | Waves | Threads | Shape |
|---|---|---|---|---|
| [#3888](https://github.com/fixpoint-labs/flow-state-dev/pull/3888) | — | 1 | 2 | (c): the Usage view ported to the one Lab client. Cursor: the flow lookup duplicates `projects.ts` (FIX-2326) |
| [#3889](https://github.com/fixpoint-labs/flow-state-dev/pull/3889) | — | 1 | 2 | a clock-dependent schedule test pinned; carried #3888's port so either could merge first |
| [#3916](https://github.com/fixpoint-labs/flow-state-dev/pull/3916) | 2217 | 2 | 7 | (e): the conductor lab dropped `onUsage`. The second look named the hand-copied feed list as the cause; the lab now spreads, the docs still list (FIX-2327) |

**Load.** 23 waves over 6 implementation PRs; two took four or more: #4013 (12), #3795 (4).
Direction: 6 rounds over 3 artifacts; 1 took three, and its third posted after merge.

**Classes.** Direction (~34 threads): `missed-edge-case` leads (#3771's account order), then
`over-engineered` (Cursor's notes, recorded) and one `design-off` (#3759's query as a capability).
Implementation (~66 threads): `missed-edge-case` leads, and (a) is about 16 of them. `stale-restatement`
×2 (#4013's P1, #3916). Reading labels: `overclaim` on 1 (#3916: the docs said three feeds).
No `vacuous-assertion` found.

**Claims (looped / settled / verdicts):** 0 / 0 / —. #3771's three rounds were new orderings each pass,
not one claim re-argued.

**Reviewer exhaustion:** Codex reported its usage limit on #3768 (22:09Z ×2) and #3795 (22:06Z ×2),
10-23. The next pass on each came about 1h40m later. **Merged with a finding open:** #3771 (three P1s
after merge, all fixed and answered in #3795 at 21:49Z).

**Carried / not carried.** Cycle 26's fix (d0a6de9a, the BP-035 line), by branch head with
`git merge-base --is-ancestor` (PR heads fetched where the squash merge dropped them):
- Not carried: #3759, #3771, #3886, #3768, #3795, #3888, #3889, #3916 (heads up to 10-26).
- Carried: #4013 from its first commit (f8823b87).

**Epic row:**
`ways per job: read a vendor's subscription usage 0→1 · keep host-wide harness facts per user 1→1 ·
write a harness's usage to the store 0→1 · a harness tells its host something during a run 1→2 ·
total spend 4→5 · run a hook when a request ends 1→1 · find the Codex CLI 1→1 · read a model result's
cache tokens 2→1 · carry a request's spend across a resume 0→1 · give a browser view a Workforce
query's name and row shape 1→2 · find the Lab flow that answers an action 1→2 · open a reader session
when another organization holds its id 1→2 · forward a slot's feeds to a harness 1→2`

## (a) Interleaving tails, one pass at a time

| PR | Structure | Passes on it | Primitive named? |
|---|---|---|---|
| #3771 (spec) | the usage record's account binding | r1 → r3, each on the last fold | no; Cursor's "one merge function with invariants" recorded as a note |
| #3795 | the same record, in `harness-usage.ts` | r2 → r4 (`unanswered`, `noSubscriptionAt`, `accountAt` rules) | no |
| #4013 | the request's spend across suspend, disconnect, crash and continuation | passes 2–12 in `createExecutionContext.ts`, `runAction.ts` and `request-spend-ledger.ts` | in part: "recover from the log past `spentThroughItemIndex`" at a523e9d (pass 5); the per-block form went to FIX-2323, after FIX-2288 |

The 10.3 trigger fires on *"a second finding that reopens the same race"*. On #4013 that was pass 3
(478d878: an interrupted continuation, after pass 2's suspension fix). The rule asks the worker to
judge its own chain, mid-chain, and twice in two cycles it hasn't. Cycle 25 scored the same trigger
"inside the class, and it fired late".

## Enforcement, rung by rung

**(a) Interleaving tails.**
- *Rung 1, architecture: proposed, not built.* `epic-wake` already counts PR-feedback rounds
  (`prFeedbackRounds`, `PR_FEEDBACK_CAP = 12`) and writes the dispatch prompt. At round 4, a third of
  the cap, the prompt would carry 10.3's question as a step the worker must answer on the PR before
  fixing: *do this batch's findings reopen a structure an earlier round fixed? If so, name the
  primitive, file it or point to the issue that holds it, and fix in this PR only what the existing
  primitives close.* A worker whose findings share no structure says so in one line. Against this
  cycle and the last:

  | PR | Waves | Fires at round 4? | Chain on one structure? |
  |---|---|---|---|
  | #4013 | 12 | yes, at 83a4397 (10-28 17:13Z), with 8 passes still to come | yes |
  | #3795 | 4 | yes, at cb079fc, the last pass | yes |
  | #3768 | 3 | no | no (unrelated findings) |
  | cycle 26 #3749, #3899 | 8, 6 | yes | yes: each fix round opened the next (cycle 26) |
  | cycle 26 #3866, #3782, #3854, #3890 | 6, 5, 5, 4 | yes | no single race structure: a one-line answer each |

  The cost of a false positive is one sentence. The change is one conditional in the dispatch prompt
  and a `verify.mjs` case. It touches orchestration's control flow, so it goes to the owner first
  and is not built in a lessons PR.
- *Rung 2, types:* not available. The structures differ: a record's merge rules, a ledger, a request
  record.
- *Rung 3, a check:* rejected. A "same file in three consecutive passes" scan fires on #3768 (three
  unrelated findings in `usage.ts`) and misses #3795 (two passes per file).
- *Rung 5, prose:* rejected. 10.3 already says it.

**(c) Stale heads merged, rung 1: an owner ask.** A repository setting (require up-to-date branches,
or a merge queue), not an agent rule. Cycle 24 asked the same.

**(d) Merged before the requested Codex pass, an owner ask.** The merge is the owner's act, and the
PR's own *What's asked of you* line already says to wait for checks.

## Accepted and Rejected

**Accepted:**
- (a): the `epic-wake` round-4 step above, for the owner's review on this PR.
- Job audit: FIX-2325, FIX-2326, FIX-2327 filed as folds.

**Rejected:**
- *A new BP or skill line for (a).* It is already written: `issue-implement` 10.3.
- *A file-repeat check for (a).* Fails on #3768 and #3795 (above).
- *(b) as new text.* It already has its line: cycle 26's BP-035 line landed and #4013 still had two
  instances. One cycle carried isn't enough to move it up a rung.
- *(c) and (d) as text.* Each is a merge-time act with a setting or an owner behind it.
- *Codex usage limits.* One-off, and outside the repo.

## Job audit

The PR body lists every addition the batch made and the job it does. Seven jobs come from the merged
specs' *What's already here* tables (FIX-2141, 2142 and 2145), and their counts are the specs'.
*A harness tells its host something during a run* had two additions from two specs (2142's `onUsage`
feed, 2145's `reportHarnessSpend` request seam), so it was audited. The impl diffs added six jobs no
spec recorded. Each was checked on `main` across packages:

- **a harness tells its host something during a run, 1→2.** Slot feeds (`onSession`, `onUsage`, and
  `onActivity` from FIX-2288) are harness-manager's. `reportHarnessSpend` reaches the request through
  `REQUEST_SPEND_SEAM`, because the Error Reporter and kitchen-sink run harnesses outside the slot.
  FIX-2145 compared both and recorded why. Coherent.
- **read a model result's cache tokens, 2→1.** `cacheTokensOf` (core) replaced the copies in
  `executeBlock` and the sequencer intercept (c41797b). A fall.
- **carry a request's spend across a resume, 0→1.** `spentByModel` and `spentThroughItemIndex` on the
  request record, plus the log past that cursor. Nothing else carries a request counter across a
  resume. Coherent.
- **give a browser view a Workforce query's name and row shape, 1→2.** `@flow-state-dev/workforce/browser`
  is the way: fifteen Shift Manager files import from it. `usage.ts` restates `WORKER_USAGE_ACTION` and the
  row types. **Fold: FIX-2325.**
- **find the Lab flow that answers an action, 1→2,** and **open a reader session when another
  organization holds its id, 1→2.** `usage.ts`'s `usageFlowOf` and `runUsageQuery` beside
  `projects.ts`'s `readProjectSetup` and `reads.ts`'s `openReaderSession`. **One fold: FIX-2326.**
- **forward a slot's feeds to a harness, 1→2.** #3916 made the conductor spread its feeds. The docs and
  `manager.ts`'s own example still list them by name, and that example already lacks `onActivity`.
  **Fold: FIX-2327.**

*Total spend, 4→5* is FIX-2145's count. Its run-row overlap after FIX-2288 is already filed as FIX-2298.

## Scoring the previous cycle's claims

- **Claim 1 (event read off a state):** 5 in 2 implementation PRs, plus 1 at spec time. Baseline 13 in 7.
  - Not carried, #3795: a probe's `none` used for both "timed out" and "no credential"
    (→ `unanswered`); a run's barrier read off the record's current `signed-out` status (→
    `noSubscriptionAt`); `accountAt` advanced by a look that learned no account.
  - Carried, #4013: the interrupted settlement's written count read as "already handed on"; a
    persisted `spendHandedOnByRun` flag read as "the run is alive" after its process died. Both cured
    in 54d82e98: the count is written only where it is handed on, and liveness moved to an in-process
    registry.
  - Spec: #3771 r2 (old runs reopening a no-number status).

  Down, on a smaller batch. The carried PR still had two.
- **Claim 2 (direction artifacts past two rounds after #3806):** 0 of 1 (#3886: 2). #3771 (3) merged
  before #3806 landed.
- **Claim 3 (stale goal controls):** 0 found. FIX-2225 is still Backlog. The Codex usage goal ran
  green on #3888.
- **Claim 4 ((c) on the next closure):** not measured. This epic had no closure issue.

## Claims to test next cycle

1. **Interleaving tails named by round 4.** For each implementation PR with four or more waves, record
   whether a primitive was named or filed, and at which round. Baseline: 0 of 2 here. If the
   `epic-wake` step lands, expect it by round 4 on every chain.
2. **Event read off a state, carried.** Baseline: 2 in 1 carried PR.
3. **Stale-head merges that turn `main` red.** Baseline: 2 PRs, one red window of about 1h48m.
4. **Direction artifacts merged before their requested Codex pass.** Baseline: 1 of 3.
