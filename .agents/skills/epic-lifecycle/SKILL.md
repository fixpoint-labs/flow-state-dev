---
name: epic-lifecycle
description: Drive a related Linear epic through retained spec authoring, human direction approval, checked spec merge, parallel isolated issue lifecycles, and wrap. Hold compact live status from Linear and implementation PRs; meaningful post-merge spec amendments use new PRs. Implementation merges remain human-controlled. Finish with lessons and docs polish.
argument-hint: "<epic issue ID, or the related issue IDs to run under one epic, e.g. FIX-1 FIX-2 FIX-3>"
---

# Epic Lifecycle

Run a set of **related** issues at once — each getting the full `issue-lifecycle` (spec →
direction approval → checked spec merge → implement → PR feedback) — from a single session, without their branches
colliding and without the coordinator's token count exploding.

The unit of work here is the **epic**, not the batch. An epic is a Linear parent issue
carrying the `Epic` label; the work items are its sub-issues, and its **epic-spec** is where
the set's shared objective and cross-cutting decisions live. That is what makes these issues
a set rather than a pile, and it is why this skill is a *lifecycle* like `issue-lifecycle`,
one altitude up: an epic has phases, a gate, and a wrap.

**No epic, no run.** If the issues handed to this skill share no outcome worth writing down,
they aren't a set — say so and point the user at independent `issue-lifecycle` sessions.
Don't invent an epic to wrap an unrelated batch; a coordination artifact nobody needs is
bloat (tenets 2/3).

> **Read [`docs/contributing/orchestration.md`](../../../docs/contributing/orchestration.md)
> first.** The epic-spec, its conventions, the gates, the coordination stores, worktree
> branching, and the spec-review bar are defined there. This file is the coordinator's
> *operating procedure* and does not restate them.

## The epic's phases

Like `issue-lifecycle`, one invocation advances the epic to its next external wait and then
ends the turn:

| Phase | What happens | Ends when |
|---|---|---|
| **EPIC_SETUP** | Discover/create the epic issue; `epic-agent` authors the retained set and opens its review PR; `project-agent` creates/refreshes the unchanged standing project spec | Epic review PR ready → AWAITING_OBJECTIVE |
| **AWAITING_OBJECTIVE** | Human approves the reviewed direction; preserve the two-round budget, then dispatch `epic-agent` **MERGE-ONLY** under the canonical merge contract. If the owner merges the epic PR themselves, that merge is the approval and nothing is dispatched | Confirmed epic spec merge, not approval alone |
| **RUNNING** | Advance children through `issue-lifecycle`; derive live status from Linear and implementation PRs. The **closure issue** runs last: its QA runs file bugs as children that block it, and it closes only on a clean run. Meaningful epic amendments use follow-up PRs from `main` | Every child merged, closed, or dropped, the closure issue included |
| **EPIC_WRAP** | Record terminal epic status in Linear; retain the already-merged original review PR. Retire the mailbox handle; dispatch lessons and docs-polish, then the project wrap update. Only meaningful spec amendments get a new PR | Lessons draft PR surfaced (rows-only if no proposal); docs-polish surfaced or justified skip; completion and amendment links reported |

## How it stays safe and cheap

- **One worktree per issue.** Each issue's work runs in a worker sub-agent declared
  `isolation: worktree`, so it lives on its own branch in its own git worktree.
  Parallel commits/pushes never collide — the whole reason worktrees exist here.
- **Thin coordinator, isolated workers.** The coordinator holds only a compact **status
  table** — one row per issue: `issue · route · phase · spec PR# · impl PR# · spec-review
  rounds · settling · gate-pending? · worktree`. It never holds a worker's context. Each worker advances its
  issue by **one bounded step** (via `issue-lifecycle`) in its own context and returns
  **≤ a couple of lines** of status, then exits. Token cost at the coordinator level is a
  small table across wakes, regardless of how much work the issues involve.
- **Blind by design — so check, don't infer.** **A worker is finished when its completion
  arrives — its task notification, or the status line it returns. Never re-dispatch on less.**
  Not silence, not an unanswered message, and not a worktree or `origin` probe: a worker that
  has not committed yet looks exactly like a dead one. **And never turn a reviewer's
  restructuring ask into an instruction before the number behind it exists** (BP-003) —
  measuring costs one call, building it twice costs a run.
- **Event-driven, like the single-issue loop.** The coordinator is the event loop. It ends
  its turn while issues are idle and re-enters on PR events, a workflow completion, or a
  scheduled check-in; on re-entry it refreshes each row from Linear + PR state (cheap
  fetches) and acts only where there's a pending action.
- **The fan-out is a script, not a procedure.** Refresh → advance → collect is pure
  mechanism: an epic gate that holds every issue, a two-round review budget with one
  conditional third round, a cap shared between workers and POCs, a claim dedupe. That runs
  as the **`epic-wake` workflow** (`.agents/workflows/epic-wake.js`) so it can't drift wake
  to wake. See [Each wake is a workflow](#each-wake-is-a-workflow-and-what-it-cant-do).

## Each wake is a workflow (and what it can't do)

The **`epic-wake`** workflow is this loop's steps 2–4. Everything it does is deterministic
control flow the coordinator used to re-derive from prose every wake, so the rules now live
as `if` statements with a verification harness
(`node .agents/workflows/verify.mjs`) instead of as instructions to follow correctly.

**The split is not a style choice — a workflow script structurally cannot wait.** It has no
`AskUserQuestion`, it cannot receive a PR webhook, it cannot sleep or schedule, and it has no
filesystem. So the division is fixed:

| The `epic-wake` script owns | The coordinator (this session) owns |
|---|---|
| Scanning the epic PR for its objective sign-off, and holding every sub-issue if it's unmet (the epic-spec's own review still folds) | **Surfacing every gate** to you (epic objective, per-issue spec approval, merge) |
| Per-issue refresh via `scout` (Linear parent→children in one query; PR comments/reviews/checks/meta) | **Resolving the set** and confirming it with you (loop step 1) |
| Deciding each issue's pending action, and the **review round budget** for issue specs *and* the epic PR | **`.orchestration/` reads and writes** — the script gets the table via `args`, returns the new one |
| Dispatching `issue-worker` / `epic-agent` / `poc-agent`, capped and prioritized; after epic merge, status refresh is derived data, not a commit to the original PR | **PR and mailbox subscriptions** (`subscribe_pr_activity` / local `Monitor`) — a sub-agent can't hold one |
| **Deduping claims** so one claim argued on two issues is one settlement fanned to both | **The Linear status mirror** (the approval labels are the owner's — never written here) |
| Routing a POC verdict to its issues the moment that POC finishes | **Ending the turn**, the heartbeat, and re-entry |

**A workflow runs in the background**, so a wake is: call `epic-wake` → end the turn → the
completion notification re-enters this loop with the updated table → surface gates, write the
mirrors, re-subscribe → end the turn. The extra hop is cheap (the turn was ending anyway) and
it is what makes the fan-out auditable in `/workflows` while it runs.

**Never re-implement a rule the script owns.** If the budget or the cap needs to change, change
`.agents/workflows/epic-wake.js` and its harness — not this file's prose.

## Sizing to the VM (read this before picking N)

A Cloud session is **4 vCPU / 16 GB RAM / 30 GB disk**, and **each worktree is a full
checkout**. Full lifecycles also run installs/builds/tests. So keep concurrency
modest — **~3–4 active issues** is a sane default; go higher only for light issues.
If disk or memory gets tight, cap the number of *simultaneously implementing* issues
even if more are queued. State the chosen N and the cap to the user.

> **The workflow harness caps concurrency below that, and you should say so.** A workflow's
> own limit is `min(16, cores − 2)` — **2** on a 4-vCPU box, under the 3–4 this section
> recommends. Queued agents still all complete (nothing is dropped), so this is a latency
> ceiling, not a correctness one: pass the cap you actually want as `args.cap` and let the
> script's own accounting log what it deferred. If wall-clock matters more than determinism
> for a given epic, dispatching the workers directly with the Agent tool (one message,
> parallel calls) is still a legitimate fallback — you lose the encoded budget/cap/dedupe
> rules, so prefer the workflow and accept the queueing. This ceiling has not been measured
> against a real epic run yet; treat the number as read from the harness contract, not proven.

> **Working memory is session-only — never commit it.** The epic board and the
> per-issue handle caches live in the **gitignored `.orchestration/`** directory.
> Never `git add`, commit, or open a PR for these files. Commit only real issue work,
> and only inside each issue's own worktree/branch. A PR whose diff is a board /
> status / scratch file is a bug — do not open it.

## PR events are wake signals, not work items

**Canonical: [`orchestration.md`](../../../docs/contributing/orchestration.md) → "PR events are
wake signals, not work items".** Read it, don't re-derive it here. It is a *correctness* rule —
and the harness's own posture on PRs you opened (they're yours to drive green, so diagnose the
failure, push the fix, answer the reviewer) is louder than this heading and wins if you let it.

The epic-specific delta:

- **`epic-wake` decides the action; your job is to run the wake.** The script classifies each
  row's pending action from durable state — which worker, which budget, whether to dispatch at
  all — and that depends on the row's phase *and* the kind of activity. Don't restate those
  routes here and don't predict them from the event text; run the wake and let it classify.
  Don't relay comment text into `args` either — the wake's refresh scan re-reads each PR off its
  own activity cursor, so a pasted copy is only a staler one.
- **The PR you have to recognize includes the epic PR, which has no row.** It lives in the
  `epic` handle beside them; its events are the objective sign-off and the epic-spec's own
  feedback. Drop one as "not mine" and the whole set sits at AWAITING_OBJECTIVE until a
  heartbeat catches it — the epic gate is a barrier, so a missed approval parks every issue,
  not one.
- **The write rule's instance here:** posting an alignment the user just decided
  ("Cross-spec coherence" → step 4, *Route the alignment*) carries a human's decision, so it is
  allowed. Answering a reviewer is a technical judgment about a diff you haven't read, so it is
  not.

## Your requests are dispatched too

**Canonical: [`orchestration.md`](../../../docs/contributing/orchestration.md) → "The coordinator
dispatches; it never does the work".** Read it, don't re-derive it here. Same rule as the section
above with the disguise removed — a mid-run request from **you** says *what* should happen, not
*who* does it — and it is the case that gets through, because a direct ask doesn't look like an
event at all.

The epic-specific delta:

- **The status table is the first place to look**, and a note on a row is not a dispatch. Most
  side requests during an epic are about a file some row already owns, so that row's worker is
  where it goes — **dispatched this wake**, not parked as a note. A settled `PR_FEEDBACK` row
  matches none of `pendingAction()`'s dispatch conditions and there is no side-request field for
  one to match, so a noted request is never picked up and the row can take its merge gate
  without it. Dispatch directly, and hold that row's merge gate until the change lands.
- **A dispatch here is a worktree, always.** N workers are live on their own branches; a
  sub-agent you spawn without `isolation: worktree` shares this checkout with them.
- **A fact you write into a brief or a status line is read when you write it.** Read an issue's
  or a PR's state from Linear or GitHub at that moment; get a rule's merge state or what the code
  does from a fresh `scout` or worker lookup and cite its result — never from an earlier wake's record.

## The loop (each invocation)

1. **Resolve the epic and its set.** Take the epic issue ID, or the issue IDs, from the
   argument (you may compose `linear-triage` for selection) and confirm the set with the
   user. Then establish the epic — see [Epic setup](#epic-setup-the-coordination-layer-every-run-has).
   Record the set + chosen N in `.orchestration/epic.md` (compact: the issue list and
   per-issue handle-cache pointers), **and the epic handle alongside it** (epic issue ID ·
   name · `epic/<name>` branch · epic PR#), so it survives across wakes — the next refresh
   needs it to re-check the epic PR for its approving comment or review, keep the epic PR
   subscribed, and pass the branch/SHA to workers.

   **Establish the `owner` login here too** — the GitHub account whose approval *label* passes a gate. It is the product owner you are
   reporting to, so ask them once if you don't already know it, and persist it beside the epic
   handle; a login you inferred from a PR author or a commit trailer is a guess, and this one
   authorizes work.    If you cannot establish it, say so and carry on without it: the wake turns
   the label channel off rather than trusting an unattributable label. A GitHub review or
   comment under the shared owner login is not the gate — agents post as that login. An
   unmarked owner-looking approval is suspect (`suspectOwnerApprovals` on the wake result);
   escalate it and do not implement. The sign-off that releases a gate is the owner merging
   the spec PR (no label or comment needed), a message from
   the user in this conversation (`approvedInSession` on the reviewed head), a non-owner
   human review the wake's authorship check accepts, or, when `owner` is set, an
   owner-applied label with provenance. What you must not do is leave the field out silently —
   an owner who signs off by label alone would then wait forever on a channel nothing reads.

   Two more coordinator-owned fields live here for the same reason — nothing else holds them
   across wakes: the epic PR's own review budget
   (**`reviewRounds`** + **`aboveBarFound`**, passed to and returned by each wake) and, at
   wrap, each pass's **disposition**
   (`lessons: <PR#> [proposal skipped: why]` — lessons **always** has a PR number, since a
   clean epic still lands its rows as a rows-only PR; only the proposal inside it is skippable
   · `docs_polish: <PR#|skipped: why>`, which *can* be skipped outright).

   **The retained epic set describes approved intent.** Link it at gates alongside live
   status derived from Linear and implementation PRs. Phase transitions update that status,
   not the original merged PR's body or branch. Only meaningful design amendments need
   a follow-up spec PR.
2. **Run the wake.** Dispatch the **`epic-wake` workflow** with the table from
   `.orchestration/`. It does the refresh, the epic-gate check, the capped worker fan-out, the
   review budgets, the claim dedupe, the verdict routing and the epic-spec status refresh — see
   [Each wake is a workflow](#each-wake-is-a-workflow-and-what-it-cant-do) for the split and
   the reasons. Pass:

   ```
   Workflow tool:
     name: epic-wake
     args: {
       epic:  { issueId, name, branch, headSha, prNumber, approved, approvedHeadSha, specMerged, headUnconfirmed,
                reviewRounds, aboveBarFound, lastSeenActivityAt, lastSeenSha,
                verdicts, unsettled, openQuestions, answers },
       cap:   <the N you chose and stated>,
       owner: <the GitHub login authorized to sign off by LABEL>,
       issues: [ { id, route, phase, specPr, implPr, specReviewRounds, specLevelFound,
                   specApproved, approvedHeadSha, specMerged, prFeedbackRounds, verdicts,
                   lastSeenActivityAt, lastSeenSha, blocker, blockerResolutions,
                   approvedInSession, subPrs, assembledGoal, unsettled, blockerFor,
                   multiPrPending } ],
       settleRequests: [ { claim, load, falsify, threads, issueId } ]
     }
   ```

   Everything in `args` comes straight out of `.orchestration/` — the script has no
   filesystem, so **you are its memory**. Four groups of fields are load-bearing for exactly
   that reason, and each fails in its own way if you drop it:

   - **`owner`** — the GitHub login whose `spec approved` / `epic approved` label passes a gate.
     Labels are writable by every collaborator and every bot with write access, so the scan
     verifies **who applied it** against this login before the label counts; "a human applied
     it" is not the test, because an agent with write access is not a human and a passing
     collaborator is not the owner. Omit it and the **label channel is simply off** — the
     scouts report it false whatever labels a PR carries, and only comment/review approval
     works. That is fail-closed by design: a label nobody can be held to is not a sign-off.
     Also bind the approval to the reviewed head: the application event alone cannot
     approve a later push. Unknown revision binding fails closed.

   - **`issues[].route`** (`spec | direct`) — which route the issue takes into
     implementation ([`orchestration.md`](../../../docs/contributing/orchestration.md) →
     "Which issues get a spec"). The wake re-derives it from the Linear category each
     refresh and hands it back, so persisting it verbatim is all you owe; what you must
     not do is invent one. A **bug** is `direct`: it never enters NEEDS_SPEC, never opens
     a spec PR, and is **never offered a spec-approval gate** — its only gate is merge.
     The default when nothing is known is `spec`, which fails closed (an unnecessary
     document beats ungated code).
   - **The counters** (`specReviewRounds`, `specLevelFound`, `epic.reviewRounds`,
     `epic.aboveBarFound`) — drop them and every review budget silently restarts at zero.
     A `direct` row spends none of them; a bug row whose spec-review counter is climbing
     is a routing bug, not a chatty reviewer.
   - **The activity cursors** (`issues[].lastSeenActivityAt` / `lastSeenSha`, and
     `epic.lastSeenActivityAt` / `lastSeenSha`) — these are how a scout tells new feedback from
     feedback already handled. Carry a stale one and the *same* review comment reads as new
     every wake: it burns a round per wake and dispatches duplicate PR-feedback workers. The
     **timestamp is the real cursor** — a comment never moves a head SHA. The wake returns them
     advanced *only for rows it actually handled*, so persist them verbatim rather than
     recomputing.
   - **`issues[].verdicts` and `epic.verdicts`** — **arrays** (two claims on one issue can settle
     in the same wake), each entry the full POC settlement (claim, verdict, evidence, threads) and
     not just the enum, because the folding worker has to reply with the evidence. `epic.verdicts`
     exists because a cross-cutting claim has no issue row to land on. Persist them under those
     plural names — a coordinator writing a singular `verdict` drops every carried settlement.
   - **`issues[].approvedInSession`** — when the user approves a spec **in-session** rather than on
     the PR (a channel [Gates & autonomy](#gates--autonomy) explicitly supports), there is no
     comment or review for a scout to find, so record the **head SHA they approved** in this field.
     The wake treats it as approval while that head is still current, and ignores it once a push has
     moved on — the same staleness rule the scan channel gets. Omit it and the in-session
     go-ahead is silently discarded, and the issue waits for an approval that already happened.
   - **`issues[].subPrs` and `issues[].assembledGoal`** — for a **multi-PR** issue, the two halves of
     the state its worker returned from `issue-multi-pr`. `subPrs` (`id · status · pr · branch ·
     stackedOn`) are the handles you subscribe to, and they are also what the next wake's refresh
     scout is given to read — drop them and every sub-PR's review, CI and merge event goes unseen.
     `assembledGoal` is the assemble phase's position in its own state machine (goal → gap → fix →
     re-verify); drop it and the machine restarts, re-running the goal and filing a duplicate gap
     issue every wake. Carry both verbatim — including `assembledGoal.fixPr`, the repair PR, which
     is **not** in `subPrs` and whose merge is the only thing that re-arms the goal.

     These rows get **one merge gate per handle**, not one per issue: each `merge` entry names the
     `pr` and, for a sub-PR, which `subPr` it is (or `repair: true` for the repair PR). An issue with
     a DAG has no single impl PR, so "merge FIX-2" would not tell you what to merge.
   - **`issues[].unsettled`** — the same thing at issue level: the claim, the evidence the POC *did*
     produce, and the thread to reply on. The row's `blocker` carries the question; this carries what
     to show the user when you ask it, and where their answer gets posted. Drop it and you can only
     relay the claim text. Cleared with the row's `blocker`, in the same breath.
   - **`epic.openQuestions`** — cross-cutting decisions the fold raised that need *you*. Surfaced in
     `blockers` every wake. `epic-agent`'s return contract produces these; the schema accepts them
     under this name, so the two agree.
   - **`epic.unsettled`** — cross-cutting claims a POC came back `INCONCLUSIVE` on. These are
     decisions **you owe the user**, not work in flight, so they deliberately do *not* sit in
     `epic.verdicts` (a verdict no fold can consume would spend an `epic-agent` worktree every
     wake, forever). Also re-surfaced in `blockers` every wake.
   - **`epic.answers`** — **how both of those get resolved, and the only way they do.** When the user
     answers a question from either list, add `{ question, answer }` to this array — `question` matching
     the `openQuestions` string or the `unsettled` claim verbatim, so the wake can pair them — and
     **leave the original entry where it is.** Do not drop it yourself. An answer here triggers an
     `epic-agent` fold on its own (no review activity or verdict needed), outside the review budget,
     which records the decision in the epic-spec; the wake then removes the question from
     `openQuestions`/`unsettled` for you, and only once that fold actually returned.

     Getting this backwards is a silent loss, and it's why the field exists: dropping the question when
     the user answers leaves the epic-spec unchanged and the answer nowhere, so every child issue keeps
     working against the unresolved version and the decision has to be made again — with no record that
     it ever was. You can't clear the question yourself because you can't know the fold succeeded.

   It returns
   `{ epicApproved, epic, epicFold, epicNotes, issues, gates, blockers, blocked, held, heldForFold,
   unsettled, verdicts, settleRequests, dispatched, deferred, converged, crossSpecGate, moreWorkNow,
   mayWrap, suspectOwnerApprovals }` — persist `epic` and `issues` verbatim.

   **`suspectOwnerApprovals`** is an owner-login GitHub review or approving comment with no
   agent-mailbox header. It is not sign-off. Tell the user which PR, and that the gate is still
   their message in this conversation. Do not dispatch implementation because of it. A separate
   accepted signal (in-session go-ahead, non-owner human review, owner label) can still satisfy
   the gate in the same wake. When you post a review or PR comment yourself, start the body with
   the header in [Gates](../../../docs/contributing/orchestration.md#gates-direction-approval-then-confirmed-merge).

   Preserve `approvedHeadSha` and `specMerged` independently on epic and issue records.
   A `spec-merge` gate names the `pr` (and `issueId` for an issue). It is an execution/checks
   wait, not a new human sign-off or implementation-merge authorization. Dispatch the
   existing `epic-agent` or `issue-worker` with **MERGE-ONLY**, passing that PR and its
   `approvedHeadSha`, under the [canonical merge contract](../../../docs/contributing/orchestration.md#merging-and-amending-a-spec).
   Do not invent a workflow action or mechanically merge in the coordinator.
   The authorized `implement` backstop may continue in the same wake with its matching
   `specMerge: { pr, headSha, mergeCommitSha }` receipt; preserve that merge provenance.
   A material post-merge amendment uses existing `openQuestions` / `blocker` state,
   not a new amendment lifecycle field. Keep its follow-up PR and reviewed head in the
   durable question; hold child dispatch and implementation merge gates until the
   coordinator verifies that head's human approval and confirmed merge, then provides
   the existing explicit answer/resolution. A successful generic fold cannot clear an
   unanswered amendment question. Preserve the original merged spec's provenance.

   **Pass `crossSpecCleared` in the args, and persist it.** It is a durable coordinator field, `false`
   until the cross-spec coherence pass has completed. While it is false, a multi-issue epic holds every
   approved spec short of implementation — so a coordinator that never sends it holds the epic forever.
   Set it to `true` once the pass has finished in the sense step 5 of the walkthrough means: every required
   alignment amendment has **confirmed merge** and any changed direction has renewed
   human approval for that revision. Routed edits or comments are not completed alignment.
   Reset the flag when the spec set changes or a new amendment could alter conformance.
   `crossSpecGate` reports an approved set ready for the user to authorize the pass;
   merged originals remain eligible and are never reopened for it.

   **`moreWorkNow: true` means run another wake now, not end the turn.** The wake computes it, so the list
   of sources cannot drift out of this skill: fold-held rows, cap-deferred rows, queued settlement claims,
   and verdicts that landed in the Settle phase — which runs after Advance, so a verdict it produces can
   only be folded on a later wake. What follows is why each belongs, not a condition to re-derive.

   **`heldForFold` OR `deferred` non-empty means run another wake now, not end the turn.**
   `heldForFold` rows were deferred for exactly one wake because they author against an objective the
   fold was revising — and the fold has now completed, so nothing external separates them from being
   dispatched. Ending the turn there would make the "one wake" depend on unrelated PR activity or the
   heartbeat, which is the wait the hold was not supposed to create.

   Ordinary `deferred` rows — the ones the concurrency cap pushed to the next wake — need the same
   treatment, and for a sharper reason: a row deferred at `NEEDS_SPEC` has no PR at all, so it *cannot*
   generate the activity that would wake this session. With a cap of 2 and three specs to write, the
   third would sit until the heartbeat, which is precisely the stall "Drain, don't stall" forbids. The
   cap is a concurrency limit, not a scheduling delay.

   **A returned `settleRequests` counts too**, for exactly that reason. A claim the cap queued comes back
   only in `settleRequests`, never in `deferred` — so checking only the two lists above left a runnable
   POC waiting on unrelated PR activity. Nothing external separates a queued settlement from being
   dispatched; it is waiting on a slot, and the next wake has one.

   The workflow runs in the background: **end the turn** and continue at step 3 when its
   completion notification arrives.

   Three things it does that are easy to misread as bugs. **`epicApproved: false` does not mean
   it did nothing** — it held every sub-issue (`held`) but still folded epic-PR review if the
   budget allowed, because folding is how the objective becomes approvable; blocking it would
   deadlock the gate it's waiting on. An issue in **`blocked`** has an open blocked-by relation:
   its **implementation** waits until its blocker merges rather than being built concurrently with
   its prerequisite, but all its spec-phase work still runs (authoring, review, verdict folds,
   answered decisions, the approval gate) — `blocked` is not "idle"
   ([Intake](#intake--filing--queueing-discovered-issues)).
   And a row whose worker **died** looks untouched by design: the script treats a null agent
   result as *nothing happened*, so the cursor doesn't advance, no verdict is consumed, and no
   claim is marked settled — the next wake retries instead of inventing an outcome.
3. **Write the mirrors.** Persist the returned `issues` table and `epic` to
   `.orchestration/`, then **write the Linear-status mirror** for every phase transition the
   wake surfaced (Linear auto-status is off; the mapping + state IDs live in `issue-lifecycle`
   → "Linear status is a mirror you own"). Workers set the mirror for transitions they effect
   (they opened the PR); you set it for the ones the wake *detected* — a spec/epic approval, a
   merge. **Do not apply the `spec approved` / `epic approved` label** — it is the owner's
   signal, not a record you write. Idempotent: skip if the issue is already in the target
   state. Attribute the owner's label and bind it to the reviewed head; a changed head
   needs renewed sign-off, not merely the label still being present. Persist direction
   approval separately from observed spec merge and never map spec merge to Done.

   **Route the epic-PR feedback the wake handed you — both channels, or it is lost.** Neither
   is optional, because the coordinator never reads epic-PR content itself and nothing else will
   pick these up:

   - **`epicFold.fanOut`** — issue-local items the fold triaged *out* of the epic-spec. Each
     entry carries `{ summary, issues }`: record the summary as an implementer note on each named
     issue (never into its spec).
   - **`epicNotes`** — the same shape, from a *converged* epic-spec that stopped folding. Route
     each `{ summary, fanOut }` identically. The wake advanced the cursor on the assumption you
     did, so skipping this drops the feedback permanently.

   **Record the answer, then clear a resolved `blocker` on the row — both, before the next wake.**
   A row carrying `blocker` is parked by design: the wake won't dispatch it again, because a worker
   that escalated a decision is waiting on *you*, not on an event. Once you've answered (in-session
   or on the PR), do two things in the same breath:

   - **append** `{ for, answer }` to **`blockerResolutions`** on the row — never overwrite it. `answer`
     in enough words that someone who wasn't there could act on it (the option chosen, and why if the
     why constrains the work); `for` naming the sub-PR if the blocker was prefixed with one
     (`a: which shape?` → `for: "a"`), otherwise omitted. It is a **list** because two slices can
     escalate in the same wake and only one gets lifted onto the row at a time: answering the first
     parks the row behind the second, so that answer has to survive un-dispatched until the second is
     answered too. A single slot loses it, and the slice resumes and re-asks;
   - remove `blocker`, so the issue resumes.

   Both, because the next worker is a **fresh sub-agent in a fresh worktree** — it never saw the
   escalation and cannot read this session. Clearing `blocker` alone releases it to walk back to the
   identical architectural fork, where it must either escalate again (the same question, forever) or
   invent the answer the gate existed to supply. The wake hands the whole list to that worker's prompt
   (and forwards it into `issue-multi-pr` for a multi-PR row, whose build and fix workers are the ones
   that escalated), then clears it once a dispatch has carried it — a one-shot handoff, not durable
   state. Leave `blocker` set and the issue never moves at all. `blockers` are surfaced at step 4 —
   see [Gates & autonomy](#gates--autonomy).

   **A row parked on an unresolved `blocker` is offered no gate at all** — not spec approval, not
   merge. That is deliberate: the answer changes the artifact, so approving the spec or merging the
   work first signs off something the decision is about to alter. The question itself still appears in
   `blockers` every wake, so nothing is hidden; the gate returns once you have answered and the wake
   has dispatched the answer.

   A blocker reading **"PR-feedback cap reached"** is the same contract with a different
   clearing rule. It is **derived from `prFeedbackRounds`**, not stored, so there is no field to
   remove: the issue's review loop ran twelve auto-handled rounds and stopped
   ([`orchestration.md`](../../../docs/contributing/orchestration.md) → "PR feedback: the round
   cap"). Put the question to the user — keep going, take a position on the thread that keeps
   coming back, re-examine the approach, split the rest into a follow-up, or merge as-is — then
   record the answer in `blockerResolutions` **and set `prFeedbackRounds: 0`**. The reset is what
   un-parks the row and removes the blocker; recording the answer alone leaves it capped, and
   resetting alone sends a fresh worker back into the same loop with no direction.

   A `blocker` reading **"POC returned INCONCLUSIVE"** is the same contract from a different
   source: the evidence run couldn't settle the claim, so `orchestration.md` hands it back to the
   human. Put the question to the user with what the POC *did* find, then clear the field. Until you do,
   that issue is parked.

   For a **cross-cutting** claim, do NOT simply drop the `epic.unsettled` entry: that is the only durable
   record of the question, and deleting it without a fold means the epic-spec and every child aligned to it
   never receive the decision. Append the answer to `epic.answers` as `{ question, answer }` — the same
   contract every other epic-level answer uses — and leave the `unsettled` entry in place. `epic-agent`
   folds it into the epic-spec and the entry retires with the fold, which is what makes the record and the
   decision move together.
4. **Handle gates.** A `spec-merge` entry is an execution/checks wait: dispatch the
   canonical **MERGE-ONLY** assignment above, or await the unmet checks/thread policy,
   then continue on the next wake after observed merge. Do not render it as a second
   approval ask. **Write human decision gates and blockers as decisions put to a product
   owner** — all six parts, per
   [`asking-for-decisions.md`](../../../docs/contributing/asking-for-decisions.md) (canonical).
   Batch those asks under one `Need your sign-off` heading, numbered, hardest first. "The
   spec PR is open, please approve" is not a gate surfaced — it pushes the framing job onto the
   person least able to do it. You hold links and status lines, not the code, so build the ask
   from what the workers returned (a row's `blocker` carries its parts) rather than re-deriving
   it; where a worker gave you a bare phrase, say what you have and name what's missing instead
   of inventing the substance.

   If the epic awaits objective approval, link its review PR and explain what direction
   the human signs off, and say that merging the PR is the sign-off. Approval binds to that reviewed head; after required checks and
   repository thread policy, the epic spec merges before children start.
   For each issue awaiting approval, link its full required set, documentation draft,
   and applicable evolution. Approval authorizes its spec merge, not implementation
   before that merge, and not the later implementation PR merge.
   Attribute label signals to the owner and reviewed revision; never treat a standing
   label as approval for a changed head. Preserve the convergence budget without
   presenting required unresolved threads or failed checks as waived.
   **If a POC settlement is in flight on that issue,
   say so in one line** (the claim, and that the verdict will land on the PR) — approval isn't
   blocked on it, but the user shouldn't sign off on a contested premise unknowingly. The
   returned `gates` array carries this for you: each `spec-approval` entry names the PR and its
   `settlingInFlight` claim, if any. The coordinator holds the *link*, not the spec text.
   The *other* issues keep moving. For any issue **ready to merge** — its current head
   reviewed and checked, per [Gates](../../../docs/contributing/orchestration.md#gates-direction-approval-then-confirmed-merge)
   — surface it and stop there (merge is the user's).
5. **End the turn.** **Subscribe to every currently-open PR named in the (now fully updated)
   table** — each issue's spec PR, each issue's impl PR#(s), and the epic PR —
   unconditionally, every turn, not only when a PR first opens. Do this **here, after the
   wake's table has landed** — the workflow may have dispatched a worker that opened a
   brand-new PR, and step 3 is where that PR# lands in the table; subscribing any earlier
   would miss it, leaving it deaf to review/approval activity until the next heartbeat.
   `subscribe_pr_activity`
   is idempotent, so re-subscribing to a PR already subscribed costs nothing; doing it
   unconditionally off the full table (not just "PRs that changed this turn") is what makes a
   lost subscription self-heal on the very next wake — a worker opened a PR and exited before
   subscribing (sub-agents can't hold one — only the coordinator can), a call was skipped, or the
   session cold-resumed. A spec PR's review activity during Case/spec review
   must wake the coordinator, not wait for the heartbeat, and epic PR activity must too (so feedback
   can fan down and an approving comment or review on the epic PR is caught). **The two
   sign-off gates now ride that stream** — both a comment and a review submission are
   delivered PR-activity events, so a spec- or epic-PR approval in either of those forms wakes
   the coordinator immediately. Waking is not acceptance: an owner-login review or comment is
   classified by the wake (agent header, or suspect if unmarked) and does not satisfy the gate
   by itself. The owner's **label** is the third channel and the slow one: a
   `labeled` webhook never arrives, so it is found only by the wake's scout refresh. The
   transitions webhooks *don't* cover — CI success and merge/close — are caught on that same
   refresh (step 2). Schedule one check-in
   (`send_later`, ~30–60 min) as the backstop and re-arm while any issue is live. Re-enter
   on PR events or the check-in. **Move to EPIC_WRAP only when the wake returns `mayWrap: true`.**

   Do not re-derive that condition. "Every issue is merged, closed, or dropped" is necessary and not
   sufficient: wrap closes the epic surface and stops the wakes, so wrapping over an unanswered question
   destroys it — and a late POC returning INCONCLUSIVE on an already-merged issue is exactly that state,
   every row terminal with one open question. `mayWrap` also requires no row blocker, no unsettled claim,
   no unfolded verdict, and no queued settlement.

   **Both `subscribe_pr_activity` and `send_later` are cloud-only.** Neither works in a local
   Claude Code session — no reachable webhook endpoint, no server-side scheduler. Check
   whether you're in a cloud session before relying on either; if local, arm a **`Monitor`
   poll loop (the `watch-pr` skill)** per live PR as the primary wake signal — it wakes only
   on real activity and covers comments, reviews (incl. approvals), CI, and PR-meta.
   **`watch-pr` is for spec / epic / impl PRs only** — never a mailbox handle, which has no CI,
   no reviews and no diff. The mailbox is cloud-only: a local epic simply runs without it.
   **Arming a Monitor is *not* idempotent** (unlike `subscribe_pr_activity`) — re-arming one
   every wake would stack duplicate pollers, notifications, and API traffic. So **store each
   PR's Monitor handle in the `.orchestration` cache and re-arm only when it's missing or
   dead** (one Monitor per PR); the unconditional re-assert discipline above applies to the
   *cloud* `subscribe_pr_activity` call, not to local Monitors. See
   [`orchestration.md`](../../../docs/contributing/orchestration.md) → "Environment: cloud
   vs. local" for how to detect the environment and the full fallback design.

## Spec review: converge, don't grind

Each sub-issue's spec gets its own spec PR and its own review, and each of those draws
**automated reviewers we don't control** — tuned for code, pointed at a deliberately
directional document. Left unbounded that's N parallel grinding loops instead of one, which
is how an epic of five directionally-sound specs turns into fifty review rounds.

The bar, the three dispositions, and the **two-round convergence budget** are canonical in
[`orchestration.md`](../../../docs/contributing/orchestration.md) → "Spec review: the bar
and the convergence rule"; the per-issue mechanics live in `issue-lifecycle` → "The
spec-review round budget".

**The budget arithmetic is the `epic-wake` script's, not yours** — one `atReviewBudget()`
covering issue specs and the epic PR alike, so the three things that make it misfire (counting
events instead of reported rounds, swallowing the authorized third round, resetting on a wake)
can't come back as a slip. Two jobs remain the coordinator's:

- **Carry the counters** (`specReviewRounds` / `specLevelFound` per issue,
  `epic.reviewRounds` / `epic.aboveBarFound` for the epic PR) in `.orchestration/` and pass
  them in `args` every wake. The script has no memory; you are it. Drop them and every budget
  silently restarts at zero.
- **Surface convergence as convergence.** The wake returns `converged: [issueIds]`. Say at
  step 4 that the spec is directionally settled, that remaining threads are carried as
  implementer notes, and that the approval gate is the next move. Don't present it as "still
  in review".

**A bot `CHANGES_REQUESTED` holds nothing** — it doesn't trip the gate (only a human's
approval does) and doesn't extend the budget. Never re-request review from a bot.
Convergence is per issue and independent — issue B doesn't wait on issue A's spec.

### When a thread turns on a fact, dispatch a POC — don't buy another round

A budget bounds *how many* rounds an issue spends; it doesn't help when the rounds keep
flipping because the thread turns on a **factual claim about how the system behaves**. Running
N specs in parallel makes this worse, not better: N threads each capable of an unbounded
flip-flop. Once such a claim has been asserted and counter-asserted **twice**, it gets **run**
instead of argued — the trigger is that loop, not a single assertion, so expect this to fire on
a minority of issues rather than routinely. The rules are canonical in
[`orchestration.md`](../../../docs/contributing/orchestration.md) → "Settling a disputed claim
(POC settlement)"; the per-issue mechanics are in `issue-lifecycle` → "POC settlement".

**The dispatch mechanics are the `epic-wake` script's:** it dedupes the claims (one claim
argued on two issues is **one** settlement, fanned to both), draws them from the same cap as
the issue workers so they queue rather than starve one, dispatches the `poc-agent` in its own
worktree, and routes each verdict to its issues the moment that POC finishes — no human yes
needed, unlike a `fable-candidate`. It never makes an *issue* pending: a POC makes a *claim*
pending, and sibling issues are untouched.

Three things remain the coordinator's:

- **Carry `settleRequests` across wakes.** The wake returns the ones it queued plus any new
  ones workers raised; pass them straight back in next wake's `args`.
- **Disclose in-flight settlements at step 4** — the `gates` array's `settlingInFlight` field
  is there for exactly this.
- **Apply the two timing rules** in `issue-lifecycle` → "POC settlement": the spec PR stays
  **open** while a load-bearing settlement is live, and a late `REFUTED` is folded like a
  challenger-surfaced blind spot.

**A cross-cutting claim is settled once for the epic** — have `epic-agent` record the verdict
in the epic-spec's cross-cutting decisions so a third issue can't reopen it. The epic PR raises
settlements through the same path (`epic-agent` returns `settle_requested`, the script
dispatches), replacing what would have been a fourth epic-review round.

### The epic PR gets the same budget

The epic-spec is a direction artifact too, so it is reviewed at the same altitude and
**carries its own two-round budget** — without one, the epic PR is the single place an
unbounded review loop would survive, right at the top-level gate.

The `epic-wake` script applies **the same `atReviewBudget()`** to it that it applies to an
issue spec, dispatches `epic-agent` to fold while the budget allows, and returns the updated
`epic.reviewRounds` / `epic.aboveBarFound` for you to persist. At budget it stops folding, logs
that the epic-spec converged, and sets `epic.converged` — remaining epic-PR threads are then
carried the way an issue spec carries its review notes, routed to the relevant issues' implementer
notes (`epicFold.fanOut`) rather than held against the gate.

**The design budget never waives merge policy.** Human direction approval is distinct
from required checks, required review/thread resolution, and observed spec merge. A bot
review does not extend design rounds; a blocked merge remains a real wait. Post-merge
feedback continues through meaningful amendment PRs, not edits to the historical original.

**The budget bounds design rounds, not meaningful corrections.** Dispatch `epic-agent`
for a correction on the current unmerged review PR, or after merge on a follow-up PR from
`main`. Material direction changes need renewed approval; never rewrite the original PR.
[`orchestration.md`](../../../docs/contributing/orchestration.md) → "The convergence rule".

## Epic setup (the coordination layer every run has)

The set belongs to one body of work with **cross-cutting concerns** — shared surface,
naming, sequencing, common direction — so the epic-spec exists to keep those decisions out
of a vacuum. **The epic-spec, its conventions, the objective gate, and the index-vs-table
distinction are defined in
[`docs/contributing/orchestration.md`](../../../docs/contributing/orchestration.md)**, and
its sections and shape in
[`epic-spec-template.md`](../../../docs/contributing/epic-spec-template.md) (each one a
worked example) — read those; below is only the coordinator's *operating procedure*.

The coordinator coordinates; the **`epic-agent`** (`.claude/agents/epic-agent.md`, worktree, no
`AskUserQuestion`) writes:

**Discover → cap → create/resume, in that order.** Reasoning and cost:
[`orchestration.md`](../../../docs/contributing/orchestration.md) → "How many epics run at once".
- **1 — Discover only.** Have `scout` return the consistent Epic parent, original review
  PR and merge state, Linear lifecycle status, and child implementation PR outcomes.
  Mixed parents need a decision. A merged epic spec normally means an active epic, not
  a wrapped one. Resume active work; for terminal work, surface whether a new epic or
  explicit resumption is intended. Never reopen the merged original PR.
- **2 — Cap (skip for a reuse).** At most two active epics, counted from nonterminal
  Linear epic status and child implementation work, not open spec PR count. At the cap,
  ask whether to hold this outcome or wrap another, with a recommendation and the cost
  of delay. Held means nothing created; name held work at the next wrap.
- **3 — Resume or create — never the wrong one.**
  - **Resume:** recover the Epic issue, retained set, original review PR, and amendment
    handles. Create/re-parent nothing. Dispatch `epic-agent` only for meaningful updates.
  - **Create:** dispatch `epic-agent` to author `specs/epics/<EPIC-ISSUE-ID>/` on
    `epic/<name>`, open its review PR, and link it from Linear. Required documents are
    `SPEC.md`, `DECISIONS.md`, `BUSINESS-RULES.md`, `PLAN.md`, `DOCS.md`, plus conditional
    `EVOLUTION.md` and owned authored artifacts. The set always includes the **closure
    issue**, filed by `epic-agent` and blocked by every other child
    ([`orchestration.md`](../../../docs/contributing/orchestration.md#the-closure-issue-every-epic-ends-in-qa)).
    Refuse the objective gate on a set without one. On resume, an epic that has none gets
    one filed before its next child merges.

  Either way the coordinator holds only handles, never the spec text.
- **Name which project objective this serves.** One line, in the dispatch to `epic-agent`, from
  [`docs/objectives.md`](../../../docs/objectives.md): which objective, and how much of its gap
  this closes. An epic serving none of them is worth surfacing *before* the gate — a product
  decision you should make knowingly, not one discovered at the wrap.
- **Stand up or refresh the project-spec.** The epic's Linear **project** is its epic issue's
  `project`. Dispatch [`project-agent`](../../subagents/project-agent.md) — **create** if that
  project has no `project/<slug>` PR yet, **refresh** if it does — so the project's epics table
  carries this epic from the day it exists. One line in the dispatch: the project, the action, and
  this epic's id and title. Canonically:
  [`orchestration.md`](../../../docs/contributing/orchestration.md) → "The project-spec".

  **It takes no slot from the epic branch** — `project-agent` works on `project/<slug>`, a
  different branch from `epic/<name>`, so it never races `epic-agent`. It *can* race a **second
  epic under the same project**: that collision resolves by **skipping**, never queueing, because
  project status is re-derived from Linear every dispatch.

  **A skipped refresh loses no correctness — but it is not free.** The dispatch still spends a
  sub-agent and a worktree before it discovers the branch is busy, and with the cap at two epics
  on one project that collision is routine rather than rare. Two things keep it cheap, and both
  are yours, not the agent's: **carry `project_slug` and `project_pr` in the epic record** beside
  the epic handles, so a resume never re-discovers whether the project PR exists; and **don't
  dispatch when you have nothing for it** — an epic-level transition is the trigger, so a wake
  that saw none skips the dispatch itself rather than paying for the agent to report `nothing`.
  The agent's own test for a busy branch is a non-fast-forward push: it exits `skipped: branch
  busy` rather than retrying.

- **Consider an end-state POC — before the objective gate, not after.** The objective gate is the
  **last moment the division into issues is cheap to change**, and whether the assembled surface
  is right is the one question only this altitude can ask. When that's genuinely unclear, dispatch
  `epic-agent` to build a rough [`spec-poc`](../spec-poc/SKILL.md) end-state on the epic branch,
  recorded in the epic-spec's `DECISIONS.md` → **What the end-state POC showed**. Triggered, not default; blocks nothing;
  **disclose an in-flight one when you surface the gate**, so nobody approves on an unchecked
  premise. Why and when, canonically:
  [`orchestration.md`](../../../docs/contributing/orchestration.md) → "Spec-branch POCs".

  **Two mechanics are yours, because `epic-wake` has no slot for this.** The script's cap is shared
  by the issue workers, the epic fold and settlements, and it knows nothing about a POC dispatch:
  1. **It takes the fold's slot — never run it concurrently with a fold, a status refresh, or a
     settlement.** One worktree at a time on the epic branch, or two dispatches race the same
     branch and one push is lost. A wake that has a fold or a refresh to do does that; the POC
     waits for the next one.
  2. **Record it in the epic record, or it re-dispatches every wake.** `AWAITING_OBJECTIVE` wakes
     on every bot review and CI event, and the trigger is judgment — so it re-fires unless the
     answer is written down. Write `spec_poc: <path> · showed: <one line>` — or
     `spec_poc: skipped: <why>` — the same way `lessons: … proposal skipped:` makes a wrap
     terminate. **A
     skip is a recorded outcome, not a silent one.**
- **Enforce objective approval and confirmed spec merge separately.** Use
  [`orchestration.md`](../../../docs/contributing/orchestration.md) → "Merging and amending a spec".
  Approval binds to the reviewed head, regardless of channel; an owner merge approves the
  head that merged. Never write approval labels
  or carry a standing label across changed heads. Required checks and thread policy still
  apply. The merge action must finish and its result be observed before child work starts.
  Reflect direction approval and subsequent running state in Linear; neither means Done.
  Then refresh the standing project spec, whose existing never-merged lifecycle is unchanged.
- **Own subscriptions and fan feedback down.** The wake dispatches `epic-agent` for
  above-the-bar direction feedback and routes `fanOut` to affected issues. Before merge,
  edits use the review PR; afterward, meaningful amendments need a new PR from `main`
  and material changes need renewed human approval. Refresh live status from Linear and
  implementation PRs without per-tick spec commits or rewrites of the original PR body.
  The coordinator holds handles and concise findings, never full spec text.
- **Register the epic's mailbox handle here, before fan-out.** Agents this session can't
  dispatch — Grok, Cursor, Codex, a Claude in another repo — have no way to reach a specific
  epic otherwise. Register and subscribe per
  [`agent-mailbox`](../agent-mailbox/SKILL.md) → *Open a handle* / *Look at the board*, which own
  the mechanics; it is the same discover-then-create as the epic PR above, so a resumed epic
  reuses its handle rather than opening a second.
  **What an epic writes into `handles/<slug>.md`**: the objective and its gate state, the
  per-issue rows with phase and PR, open blockers, what's next — the status table you already
  hold, refreshed when state changes. It is **orientation, not state**: agents outside this
  repo have nothing else to read, but *you* resuming this epic rebuild the table from Linear
  and the PRs first and then rewrite the brief — never the reverse, or a brief the last
  coordinator died before refreshing becomes your live state
  ([`orchestration.md`](../../../docs/contributing/orchestration.md) → "The coordination
  stores"). What you may answer on a handle with your own hands:
  [`orchestration.md`](../../../docs/contributing/orchestration.md) → "The agent mailbox".
- **Cross-spec review does not require originals to stay open.** Run it against approved
  retained revisions. Alignment after merge uses follow-up PRs from `main`; hold affected
  implementation on `crossSpecCleared` until those amendments are approved and merged.
- **Wrap** records actual completion in Linear and preserves the original review record.
  It never closes the epic spec unmerged, reopens it, or pushes a final status commit.
- **Distill the batch.** An epic is a *set of related PRs that just finished* — the sample
  size where a recurring rework class becomes visible (three of five issues carrying the
  same `design-off` feedback is a signal one issue alone can't show). At epic wrap, dispatch
  **one bounded sub-agent** (worktree, like `epic-agent`) to run **`distill-lessons` in
  loop mode** over the epic's spec + impl PRs **and the epic PR itself** — the epic PR is a
  reviewed artifact with a rework class its children don't have, and a collector handed only
  the children reports **zero** for that class, which reads as progress. Write the
  cycle-ledger rows as a new cycle file (plus its index row) and open a
  **draft** "lessons" PR carrying the ledger rows (factual) plus any *proposed* tenet/BP
  sharpening. Keep it **draft** — `distill-lessons` writes to the grounding only after your
  review, so the PR is a proposal you approve, not auto-landed lessons. It's a fresh PR
  against the default branch touching `docs/`, separate from the already-merged epic spec.
  The coordinator holds only the PR handle and surfaces it; it never applies
  the lessons itself. **Spec-review rounds are ledger signal too** — an epic whose specs each
  needed a third round is telling you something about the spec-authoring altitude, and the
  ledger is where that becomes visible. This is also where the Fable-escalation trial is
  *measured* — the ledger's `design-off` trend is the evidence it's earning its cost.

  **The skip is partial, and the split is deliberate.** An epic with no rework worth measuring
  skips the *grounding-proposal* pass — no tenet/BP sharpening, and the lessons PR carries rows
  only. It does **not** skip the PR, and it does **not** skip the ledger rows: **always append the factual rows, including for a clean epic.** A clean
  epic is the most valuable row the instrument has — dropping it leaves a ledger containing only
  epics that had findings, so `rounds-to-approval` and `design-off` measure a survivor-biased
  sample and a genuine improvement is invisible by construction. Rows are data; the proposal is
  the judgment call, and only the judgment call is skippable.

  **Rows still need a way to land.** They are written in the wrap worker's worktree, so a run
  that opens no PR leaves them there and they never reach the default branch — the epic records
  the collection as complete while the instrument gains nothing. So the skip changes the PR's
  *contents*, never its existence: when the proposal is skipped, still open the **draft
  ledger-only PR** carrying just the factual rows. It is small and boring by design, and that
  is the point — a clean epic's row is the one the trend most needs.

  **A skipped proposal is a recorded outcome, not a silent one:** write
  `lessons: <PR#> [proposal skipped: <why>]` to the epic record — the same token the coordinator
  state uses — and report it, so EPIC_WRAP completes on a PR that exists rather than waiting on
  one that never opens.
- **Polish the docs.** Each issue edited the docs in isolation, so the corpus accretes the same
  way code does — the same concept re-explained across pages, guides swollen into walls of text,
  navigation that stopped cohering. At epic wrap, once the batch's impl PRs have merged, dispatch
  **one bounded sub-agent** (worktree, like `epic-agent`) to run **`polish-docs`** scoped to
  the docs the batch touched: it consolidates, streamlines, and re-arranges for readability, then
  opens a **draft** docs-cleanup PR against the default branch. Keep it **draft** — bold
  rearrangement is exactly what a human should eyeball before merge. The coordinator holds only the PR
  handle and surfaces it; it never reads or applies the edits itself. Separate from the "lessons"
  PR (grounding) and the retained epic spec. Skip only if the epic touched no docs;
  record `docs_polish: skipped: <why>` so wrap does not wait for a nonexistent PR.

- **Wrap record.** Derive final status from Linear and implementation PRs; report the
  retained `SPEC.md` and implementation outcomes. Dispatch `epic-agent` only if findings
  merit a meaningful amendment on a new PR, not for a final status-only refresh.

  **Then dispatch [`project-agent`](../../subagents/project-agent.md) with the `update` action** —
  **not `refresh`**, which is forbidden from writing decisions and would silently drop the half
  that matters. This epic's row goes to done, its arc bar closes, the now line moves, and anything
  the epic settled that binds a *sibling* epic is recorded in the project's `DECISIONS.md` →
  *decided once* so the next epic under that project reads the answer instead of re-litigating it.
  Wrap is the one moment that reliably produces cross-epic knowledge, so it is the one dispatch
  that is **not** allowed to be dropped on a busy branch: the agent retries it, and returns
  `blocked: wrap update undelivered` if it still cannot land — **re-dispatch it on the next wake
  rather than letting the epic close over it.** The status half would self-heal (a closed epic PR
  is derivable); the decisions half is derivable from nothing, which is why this one waits. Put the project PR link in the wrap report beside `SPEC.md`'s.

## Intake — filing & queueing discovered issues

Work surfaces new issues: a worker (or the spec/impl phases) hits a missing piece, a
follow-up, or a blocker. Don't drop it and don't scope-creep it into the current issue
— **file it** through the **`issue-manager`** agent (related to its source issue, in
the current project; it duplicate-checks, writes it PM-shaped, wires relations, and
returns a ready/blocked verdict).

Then decide whether it joins the epic:

- **Belongs under the epic** — blocked or not → it *may be added to the active set*, up to
  the concurrency cap, entering at its
  route's entry phase — NEEDS_SPEC for a feature, NEEDS_IMPLEMENTATION for a bug. A
  feature still hits its own **spec-approval gate** before any implementation, so what
  this starts is a *spec*, not unreviewed code; a discovered **bug** goes straight to a
  fix and its PR, which is the point of the direct route and the thing to be deliberate
  about — surface each addition to the user, and say which route it took. **Pass the epic
  issue ID to `issue-manager`** so the new issue is **parented under the epic** (subject to
  the same one-parent safety check) — otherwise it won't show under the epic in Linear and
  `issue-spec` won't discover the epic via `issue.parent`.
- **Doesn't belong under this epic** → it isn't an addition to this run. File it and leave it
  for its own lifecycle; don't stretch the epic's objective to cover it.
- **Blocked** (something it's blocked-by is still open) → admitted all the same, as a row
  marked blocked-by; the wake reads the relation from Linear each refresh and reports it in
  `blocked`. **Blocked-by gates implementation only:** all its spec-phase work runs now, like
  any other row; only the build waits for its blocker to merge (a merge event re-enters the
  loop). A blocked **bug** enters at NEEDS_IMPLEMENTATION, so it has nothing to run until then.
  Never keep a dependent out of the active set, or park its spec, on the relation — that
  serialises the epic's spec work behind its first merge.
- Over the cap → queue it; admit it when a slot frees.

**A closure-run finding is not a choice.** A bug the closure issue's QA run finds always
belongs under the epic: the closure worker files it through `issue-manager` with the epic as
parent and a blocks relation to the closure issue, and it is admitted like any other row (over
the cap it queues, it is never left out). Its merge is what lets the next closure run start.
Canonically: [`orchestration.md`](../../../docs/contributing/orchestration.md#the-closure-issue-every-epic-ends-in-qa).

This is how discovered work flows into the loop without a human re-filing it — while
the spec-approval gate keeps a human in the loop before anything is built.

## Cross-spec coherence (gated on your approval)

An epic produces several specs at once, each authored and reviewed in isolation. Each can
be locally excellent while the *set* is incoherent — two specs claim the same surface, one
decides a shape a sibling contradicts, one assumes what another removes. Per-spec review
can't see that; a batch-level pass can. Incoherence is the failure this project guards
against first (tenet 1), so once the epic's specs exist, the set gets one coherence pass
before any of them is built.

Because the epic-spec already coordinates the set up front, this pass narrows to a
**conformance check** — do the issue specs adhere to the epic's objective, themes, and
decisions, and what did the epic *not* settle? (`cross-spec-review` handles that narrowing
itself; you just dispatch it.)

**It is a pass over specs, so `direct`-route (bug) rows are not in it.** They have no
spec to be incoherent with, they are not waited for before the pass can be asked, and they
are never held by it — a bug keeps implementing while the epic's features wait on their
coherence check. The wake computes the set on that basis; an epic of nothing but bugs
never asks for the pass at all, which is correct.

**The gate — never align to an unvalidated spec.** Cross-aligning specs only helps if each
is already sound; aligning a good spec to a still-wrong one spreads the flaw. So this pass
runs only when **both** hold:

1. Every planned spec has a human-approved revision (open or merged), with its required
   documentation draft and applicable evolution, and
2. **You have approved running the cross-spec pass.** Surface "all N specs are
   approved — run the cross-spec coherence pass?" and wait. It does not run
   automatically.

Once both hold:

1. **Dispatch `cross-spec-review`** over the spec set (it forks into its own sub-agent,
   reads every spec in *its* context, and returns a compact ranked **conflict report** —
   the coordinator holds the report, never the spec texts). Read-only.
2. **Settle the empirical conflicts before you ask about any of them.** A conflict the report
   marks **`poc-candidate`** — an assumption conflict where one spec is simply *wrong* about
   how the code behaves — goes to a `poc-agent`, not into the walkthrough. **No user prompt**:
   asking someone to decide a question a run answers is the waste this exists to remove. Then
   align every affected spec to the verdict.

   **Route them through the wake, don't hand-dispatch.** Add each `poc-candidate` to
   `settleRequests` and let the next `epic-wake` run it: that gets the dedupe (several conflicts
   often reduce to *one* claim, settled once and fanned out) and the cap accounting for free.
   Expect zero or one settlement per review; a report handing you three means the trigger has
   slipped — cross-spec is the weakest firing bar in the system, since two specs disagreeing is
   cheaper to trigger than a two-round review loop, so this is where a POC fleet would come from
   if anywhere.
3. **Walk you through the remaining decisions.** For each conflict the report marks *decision-needed*,
   surface it as a decision they can make, in full — all six parts, per
   [`asking-for-decisions.md`](../../../docs/contributing/asking-for-decisions.md) (the report
   hands up the substance, you do the framing). `AskUserQuestion` gets the crisp choice. A
   conflict relayed as "spec A and spec B disagree about X" is two specs' words, not an ask —
   the user is deciding about the product, not refereeing two documents. The coordinator owns all
   user interaction; the review sub-agent never prompts. Conflicts the docs already settle are applied without
   a prompt (noted, not asked). For a conflict the report marks **`fable-candidate`**, the
   walkthrough asks two things, not one: the decision itself, **and** whether to spend a
   **Fable** adjudication on it first (`AskUserQuestion`, with the rough cost). Only on an
   explicit yes does the coordinator dispatch a Fable sub-agent on the slice the report handed up;
   its recommendation comes back as that conflict's resolution (marked `adjudicated: Fable`),
   still decision-needed — Fable advises, you decide. On no, you decide it directly. Fable is
   never spawned without that yes (see `AGENTS.md` → model tiering, upward escalation).
4. **Route the alignment.** For each spec that must change to land a decision (or a POC
   verdict), pick the cheaper channel:
   - **Direct** — dispatch an issue worker to amend the current unmerged review PR or
     open a follow-up PR from `main` for a merged spec; Linear receives links only.
   - **PR comment** — when a direct update isn't warranted yet, leave a comment on that
     spec PR describing the required alignment, to be picked up in its review rounds.
5. **Re-review the aligned specs** and keep the **stop-before-implement** gate on every
   issue. An alignment edit is a *spec-level* change by construction — a cross-spec conflict
   is never below the bar — so it earns a fresh round outside the two-round budget, and the
   issue returns to spec review before it implements.
   **`crossSpecCleared` holds implementation during alignment.** Keep it `false` until
   every aligned spec has fresh human approval for its changed head and its amendment
   is confirmed merged after required checks/thread policy. A standing owner's label
   cannot approve the revision. Never remove the owner's label to force the gate.

Run this once per epic when the set stabilizes; re-run only if a later approved spec joins
the set or an alignment edit could ripple.

## Gates & autonomy

**The gates are the only human blocks. Everything between them is the coordinator's job to keep
moving.** This skill exists to drive work *forward* — to coordinate related issues into a
cohesive, synergistic whole and keep the process advancing — not to ask permission at each
step. So:

- **A satisfied gate is a release, not a new approval request.** Direction approval
  schedules the canonical bounded spec-merge assignment; never merge in the coordinator.
  After observed merge, continue on the next wake; the authorized implement backstop
  may continue in the same wake. Report pending checks as execution waits, never another
  generic "ok to implement?" or evidence that merge already happened.
- **Drain, don't stall.** End the turn only when every remaining issue is genuinely
  **waiting on an external signal** (an unmet gate, CI, a review, a dependency PR still open).
  If a refresh shows an issue whose next action needs no new input — approval just landed,
  a dependency just merged — dispatch it *this* turn; don't leave it for the heartbeat.
- **A real blocker is the agent's to resolve or sequence, not to punt.** If implementation
  can't proceed because of an open decision or an unlanded prerequisite from another issue,
  that's the coordinator's problem to handle: sequence the prerequisite (run its blocker to merge
  first), or **dispatch a worker to** resolve the decision from the spec/codebase — the answer is
  in artifacts you don't read (Token discipline: handles and status only), so resolving it here
  would mean pulling a spec or a diff into this context to do it. Surface it to the user **only** when
  it genuinely needs a human call (a decision the spec doesn't settle) — with the specific
  question, not a vague "should I continue?". A prerequisite that simply needs to land is
  tracked and ordered by the coordinator, never a reason to idle.
- **Every gate links both intent and current progress.** Link the retained epic/issue
  set and the current review or amendment PR; derive progress from Linear and implementation
  PRs. A retained design snapshot is not a live status dashboard.
- **Spec-approval gate is per issue, and only on the spec route.** Approvals are
  independent — issue B isn't blocked by issue A's pending spec, and a **bug** has no such
  gate at all. Never manufacture one: asking the user to approve a spec for an issue that
  will never have a spec parks the row on an answer nobody can give.
- **Spec review converges; merge still obeys repository policy.** Exhausting design
  rounds does not waive required checks, reviews, or unresolved required threads.
- **Goal verification is part of done, not a gate.** (The canonical enforcement statement;
  `issue-lifecycle` cross-references this.) An issue's implementation isn't finished until its
  goal is proven on the **real path** (`issue-implement` runs it at completion) — a real model
  when the goal declares one, but some goals are intentionally *model-free* (real path, no model
  call, e.g. a suspend/resume or CRUD-persistence goal), and a model-free PASS is a valid proof,
  not an excuse to demand credentials. A worker that reports it skipped a **model-backed** goal to
  save API credits has **not** finished — the credit spend is the point, and the inference
  credential is normally in the env. Send it back to run the goal; don't accept
  a cost-based skip. The only acceptable non-run is a stated (never silent) "no goal check
  applies" — docs, pure refactor, or config with **no observable outcome** (config-backed flow
  wiring *is* observable and must be proven through `fsdev run`) — or a genuine
  inference-credential failure.
- **The epic's goal is proven by its closure issue, and nothing else.** Every child passing its
  own goal check is not the epic passing. The closure issue's QA run on one `main` commit is,
  and it stays open until every bug it found is fixed and retested by a later run
  ([`orchestration.md`](../../../docs/contributing/orchestration.md#the-closure-issue-every-epic-ends-in-qa)).
  Never wrap over an open closure issue, and never close it on a run that filed a finding.
- **Stop before implementation merge**, per issue. Spec merge follows its separate approved-head/checks gate; implementation merges remain human-controlled.

## Token & depth discipline

- The coordinator's context is the status table + the epic record. Nothing else persists
  across wakes. Workers are the token sink, and they're isolated and discarded.
- **Depth is the one thing the workflow could cost us, and it is unverified.** The chain is
  coordinator (main) → `epic-wake`'s worktree worker running issue-lifecycle (1) → the phase
  skill it dispatches, e.g. issue-implement (2) → that skill's implementer / `review`
  sub-agents (3) → review lenses (4), against Claude Code's **5-level cap**. That fits *if*
  the workflow itself doesn't consume a level — which has not been measured. If a run dies on
  depth, the documented mitigation applies one level earlier than before: have the worker run
  its phase skill **in-context** instead of dispatching a further sub-agent. Confirm this on
  the first real epic run and record what you find here.
- Never read specs/diffs at the coordinator level. Handles and status only — and that holds
  when **you** are the one asking, not just when an event is
  ([Your requests are dispatched too](#your-requests-are-dispatched-too)).

## Boundaries

- **One epic.** Parallel *coordination* of the related issues under it. Issues with hard
  dependencies on each other should be sequenced (run the blocker to merge-ready first)
  rather than run concurrently.
- **Unrelated issues are not an epic.** Don't wrap a convenience batch in a fabricated
  epic to get parallelism — run those as independent `issue-lifecycle` sessions.
- Composes `issue-lifecycle` (one lifecycle definition, reused per issue). It does
  not reimplement the lifecycle.
- **A standing engineering-manager posture over this skill — engineering forks decided
  rather than surfaced — is [`epic-em`](../epic-em/SKILL.md).** Opt-in, and it moves no gate.
- **A product-manager posture on top of that one — the epic shaped to a provable outcome and
  its scope cut before each gate — is [`epic-pm`](../epic-pm/SKILL.md).** Opt-in, and it moves
  no gate either.
