---
name: epic-lifecycle
description: Drive ONE epic — a set of related Linear issues under a shared objective — through its full lifecycle in a single session. Stands up the epic-spec, gates on its objective, then runs each sub-issue's issue-lifecycle in parallel, each on its own branch in its own git worktree so parallel commits never collide. A thin, event-driven coordinator that holds only a compact per-issue status table (never the workers' transcripts), surfaces each issue's spec-approval gate as it arrives while the others keep moving, stops each before merge, and wraps the epic with a lessons and docs-polish pass. Sizes concurrency to the session VM.
argument-hint: "<epic issue ID, or the related issue IDs to run under one epic, e.g. FIX-1 FIX-2 FIX-3>"
---

# Epic Lifecycle

Run a set of **related** issues at once — each getting the full `issue-lifecycle` (spec →
approval → implement → PR feedback) — from a single session, without their branches
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
> first.** The epic-spec, its conventions, the gates, the two coordination stores, worktree
> branching, and the spec-review bar are defined there. This file is the coordinator's
> *operating procedure* and does not restate them.

## The epic's phases

Like `issue-lifecycle`, one invocation advances the epic to its next external wait and then
ends the turn:

| Phase | What happens | Ends when |
|---|---|---|
| **EPIC_SETUP** | Resolve the set; discover or create the epic issue; `epic-agent` writes the epic-spec and opens the never-merged epic PR | Epic PR is open → AWAITING_OBJECTIVE |
| **AWAITING_OBJECTIVE** | The epic's purpose/outcome is up for sign-off; sub-issues hold before their first action. Epic-PR review runs on the same two-round budget as a spec PR | An approving human comment or review lands on the epic PR |
| **RUNNING** | Each sub-issue advances through its own `issue-lifecycle` in its own worktree, in parallel up to the cap. Per-issue spec-approval gates surface as they arrive; epic feedback fans down | Every sub-issue is merged, closed, or dropped |
| **EPIC_WRAP** | Close the epic PR unmerged (branch kept); dispatch `distill-lessons` and `polish-docs` as draft PRs | **Each** wrap pass is either surfaced as a draft PR **or explicitly skipped** — both passes have documented skip conditions (no rework worth measuring · no docs touched), so "skipped, and why" is a terminal outcome exactly like "surfaced". Record the disposition of each in the epic record and report it; never wait on a PR a skip condition means will never exist |

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
| Dispatching `issue-worker` / `epic-agent` / `poc-agent`, capped and prioritized | **PR subscriptions** (`subscribe_pr_activity` / local `Monitor`) — a sub-agent can't hold one |
| **Deduping claims** so one claim argued on two issues is one settlement fanned to both | **The Linear status mirror**, and the `spec approved` / `epic approved` labels |
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
  Don't relay comment text into `args` either — the refresh scouts re-read each PR off the
  activity cursor themselves, so a pasted copy is only a staler one.
- **The PR you have to recognize includes the epic PR, which has no row.** It lives in the
  `epic` handle beside them; its events are the objective sign-off and the epic-spec's own
  feedback. Drop one as "not mine" and the whole set sits at AWAITING_OBJECTIVE until a
  heartbeat catches it — the epic gate is a barrier, so a missed approval parks every issue,
  not one.
- **The write rule's instance here:** posting an alignment the user just decided
  ("Cross-spec coherence" → step 4, *Route the alignment*) carries a human's decision, so it is
  allowed. Answering a reviewer is a technical judgment about a diff you haven't read, so it is
  not.

## The loop (each invocation)

1. **Resolve the epic and its set.** Take the epic issue ID, or the issue IDs, from the
   argument (you may compose `linear-triage` for selection) and confirm the set with the
   user. Then establish the epic — see [Epic setup](#epic-setup-the-coordination-layer-every-run-has).
   Record the set + chosen N in `.orchestration/epic.md` (compact: the issue list and
   per-issue handle-cache pointers), **and the epic handle alongside it** (epic issue ID ·
   name · `epic/<name>` branch · epic PR#), so it survives across wakes — the next refresh
   needs it to re-check the epic PR for its approving comment or review, keep the epic PR
   subscribed, and pass the branch/SHA to workers. Two more coordinator-owned fields live
   here because nothing else can hold them across wakes: the epic PR's own review budget
   (**`reviewRounds`** + **`aboveBarFound`**, passed to and returned by each wake) and, at
   wrap, each pass's **disposition**
   (`lessons: <PR#|skipped: why>` · `docs_polish: <PR#|skipped: why>`).
2. **Run the wake.** Dispatch the **`epic-wake` workflow** with the table from
   `.orchestration/`. It does the refresh, the epic-gate check, the capped worker fan-out, the
   review budgets, the claim dedupe and the verdict routing — see
   [Each wake is a workflow](#each-wake-is-a-workflow-and-what-it-cant-do) for the split and
   the reasons. Pass:

   ```
   Workflow tool:
     name: epic-wake
     args: {
       epic:  { issueId, name, branch, headSha, prNumber, approved, headUnconfirmed,
                reviewRounds, aboveBarFound, lastSeenActivityAt, lastSeenSha,
                verdicts, unsettled, openQuestions, answers },
       cap:   <the N you chose and stated>,
       issues: [ { id, route, phase, specPr, implPr, specReviewRounds, specLevelFound,
                   prFeedbackRounds, verdicts,
                   lastSeenActivityAt, lastSeenSha, blocker, blockerResolutions,
                   approvedInSession, subPrs, assembledGoal, unsettled, blockerFor,
                   multiPrPending } ],
       settleRequests: [ { claim, load, falsify, threads, issueId } ]
     }
   ```

   Everything in `args` comes straight out of `.orchestration/` — the script has no
   filesystem, so **you are its memory**. Four groups of fields are load-bearing for exactly
   that reason, and each fails in its own way if you drop it:

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
   mayWrap }` — persist `epic` and `issues` verbatim.

   **Pass `crossSpecCleared` in the args, and persist it.** It is a durable coordinator field, `false`
   until the cross-spec coherence pass has completed. While it is false, a multi-issue epic holds every
   approved spec short of implementation — so a coordinator that never sends it holds the epic forever.
   Set it to `true` once the pass has finished in the sense step 5 of the walkthrough means: every required
   alignment edit has **landed in its spec** and every spec it changed has **cleared approval again**. Not
   when the edits are *routed* — the PR-comment channel only queues an alignment for a later review round,
   and the spec it targets keeps the approval it already had, so clearing the flag there releases
   implementation against the unaligned version and the conflict is built before it is fixed. Routing is
   the cheaper channel, not a shorter path through the gate. Set it back to `false` whenever the spec SET
   changes afterwards: a newly discovered child, or a spec reopened for revision, means the set that was
   checked is not the set you have. `crossSpecGate` in the return is
   the wake telling you the set is now open-and-approved and the pass is ready to be surfaced — the user
   approves running it, so it is a question, not an instruction.

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
   deadlock the gate it's waiting on. An issue in **`blocked`** was skipped on purpose: it has an
   open blocked-by relation, so it's tracked until its blocker merges rather than run
   concurrently with its prerequisite ([Intake](#intake--filing--queueing-discovered-issues)).
   And a row whose worker **died** looks untouched by design: the script treats a null agent
   result as *nothing happened*, so the cursor doesn't advance, no verdict is consumed, and no
   claim is marked settled — the next wake retries instead of inventing an outcome.
3. **Write the mirrors.** Persist the returned `issues` table and `epic` to
   `.orchestration/`, then **write the Linear-status mirror** for every phase transition the
   wake surfaced (Linear auto-status is off; the mapping + state IDs live in `issue-lifecycle`
   → "Linear status is a mirror you own"). Workers set the mirror for transitions they effect
   (they opened the PR); you set it for the ones the wake *detected* — a spec/epic approval, a
   merge — and for a detected approval also apply the `spec approved` / `epic approved` label
   as the durable, filterable record. Idempotent: skip if the issue is already in the target
   state and the label is already present. **The gate is the fresh approval the wake
   re-derived, never the label** — the label can go stale behind a later push.

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
4. **Surface gates.** If the epic is awaiting its objective sign-off, surface the epic
   PR (its purpose/objective) and note that an **approving comment or review on the epic PR**
   releases the epic's issues to start — until then they hold at NEEDS_SPEC. Then, per issue:
   for any issue **awaiting spec approval** (its spec PR is open, Part I + II), surface the
   **spec PR link** for review and note that **an approving comment or review on the spec PR**
   is the go-ahead to implement (a plain "approved" comment, or an Approve-state review, from a
   human other than the PR's author — the label is applied by the coordinator, not the human).
   **Say what they're signing off: the direction** — the problem framing, the approach, and the
   numbered Decisions — and, for a converged spec, that remaining open threads are carried as
   implementer notes rather than blockers. **If a POC settlement is in flight on that issue,
   say so in one line** (the claim, and that the verdict will land on the PR) — approval isn't
   blocked on it, but the user shouldn't sign off on a contested premise unknowingly. The
   returned `gates` array carries this for you: each `spec-approval` entry names the PR and its
   `settlingInFlight` claim, if any. The coordinator holds the *link*, not the spec text.
   The *other* issues keep moving. For any issue **ready to merge**, surface it and stop there
   (merge is the user's).
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
   delivered PR-activity events, so a spec- or epic-PR approval (either form) wakes the coordinator
   immediately (the reason the gates moved off labels, whose webhook never arrives). The
   transitions webhooks *don't* cover — CI success and merge/close — are caught on the wake's
   scout refresh (step 2). Schedule one check-in
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
carried the way an issue spec carries its §13 notes, routed to the relevant issues' implementer
notes (`epicFold.fanOut`) rather than held against the gate.

**The objective gate is unaffected either way.** Only a human's approving comment or review
trips it; a bot review on the epic PR neither holds it nor buys another round. And the epic's
*direction* still flows continuously — the budget bounds the *folding*, not the epic's ability
to receive and route feedback.

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

- **Discover, then create.** An issue's epic is its **parent** — have `scout` check the set
  in one pass and return `{ epicIssueId, consistent }`. If they all share the same
  **`Epic`-labelled (Kind group)** parent, reuse it. If the set is **mixed** (some under an
  epic, some not) or carries **two different epic parents**, don't guess — surface it to the
  user before creating a second epic. Otherwise dispatch `epic-agent` to stand one up: it
  creates the **Epic issue**
  (`Epic` Kind label), **re-parents the set's issues as sub-issues**, writes the epic-spec
  (`epic/<name>` branch + never-merged epic PR + the spec attached as the Epic issue's Linear
  document), and returns the handles. The coordinator holds only handles (epic issue ID, name,
  branch, epic PR#), never the spec text.
- **Consider an end-state POC — before the objective gate, not after.** The objective gate is the
  **last moment the division into issues is cheap to change**, and whether the assembled surface
  is right is the one question only this altitude can ask. When that's genuinely unclear, dispatch
  `epic-agent` to build a rough [`spec-poc`](../spec-poc/SKILL.md) end-state on the epic branch,
  recorded in the epic-spec's **§3 Shape of the whole**. Triggered, not default; blocks nothing;
  **disclose an in-flight one when you surface the gate**, so nobody approves on an unchecked
  premise. Why and when, canonically:
  [`orchestration.md`](../../../docs/contributing/orchestration.md) → "Spec-branch POCs".

  **Two mechanics are yours, because `epic-wake` has no slot for this.** The script's cap is shared
  by the issue workers, the epic fold and settlements, and it knows nothing about a POC dispatch:
  1. **It takes the fold's slot — never run it concurrently with a fold or a settlement.** One
     `epic-agent` worktree at a time on the epic branch, or two dispatches race the same branch.
     A wake that has a fold to do does the fold; the POC waits for the next one.
  2. **Record it in the epic record, or it re-dispatches every wake.** `AWAITING_OBJECTIVE` wakes
     on every bot review and CI event, and the trigger is judgment — so it re-fires unless the
     answer is written down. Write `spec_poc: <path> · showed: <one line>` — or
     `spec_poc: skipped: <why>` — the same way `lessons: skipped:` makes a wrap terminate. **A
     skip is a recorded outcome, not a silent one.**
- **Enforce the objective gate.** Surface the epic-spec's purpose/objective for the
  **approving comment or review** sign-off; the wake holds the epic's issues at NEEDS_SPEC
  until it lands (it returns `epicApproved: false` and dispatches nothing). It's the *only*
  epic-level gate — direction stays ungated. When an
  approving human comment or review lands on the epic PR, **the coordinator writes both mirrors**
  — it applies the `epic approved` label (durable, filterable record) *and* moves the Epic
  *issue's* Linear state to reflect "objective approved" (the comment or review is the
  trigger; the label and Linear state are human-facing mirrors, and the coordinator owns keeping
  them in step so they don't drift).
- **Own the subscription; fan feedback down.** Only the coordinator can subscribe to the epic
  PR (sub-agents can't), so epic-PR feedback arrives here. The **folding** is the wake's:
  it dispatches `epic-agent` to triage against the bar, fold above-the-bar items into the
  epic-spec, refresh the running index from your table's PR handles (one update pass, not a
  separate mode), and return `fanOut` — the issues an above-the-bar item touches. You route
  those `fanOut` issues as **implementer notes**; a comment about a single issue's internals
  never goes into that issue's spec. A fold that changes a decision must satisfy tenet 5 —
  every surface of the epic-spec restating that decision moves with it — and `epic-agent` owns
  that check at edit time, so don't re-derive it here.
  Nothing here pulls epic-comment *content* into the coordinator's context.
- **Wrap.** When the epic finishes, the epic PR closes **unmerged**; the **branch is never
  deleted** and stays discoverable via the Epic issue (its attached document + `Epic` label).
  Closing needs no sign-off.
- **Distill the batch.** An epic is a *set of related PRs that just finished* — the sample
  size where a recurring rework class becomes visible (three of five issues carrying the
  same `design-off` feedback is a signal one issue alone can't show). At epic wrap, dispatch
  **one bounded sub-agent** (worktree, like `epic-agent`) to run **`distill-lessons` in
  loop mode** over the epic's spec + impl PRs: append the cycle-ledger rows and open a
  **draft** "lessons" PR carrying the ledger rows (factual) plus any *proposed* tenet/BP
  sharpening. Keep it **draft** — `distill-lessons` writes to the grounding only after your
  review, so the PR is a proposal you approve, not auto-landed lessons. It's a fresh PR
  against the default branch touching `docs/`, separate from the epic PR (which closes
  unmerged). The coordinator holds only the PR handle and surfaces it; it never reads or applies
  the lessons itself. **Spec-review rounds are ledger signal too** — an epic whose specs each
  needed a third round is telling you something about the spec-authoring altitude, and the
  ledger is where that becomes visible. This is also where the Fable-escalation trial is
  *measured* — the ledger's `design-off` trend is the evidence it's earning its cost. Skip for
  an epic with no rework worth measuring — this is the loop-measurement payoff, not
  ceremony for every run. **A skip is a recorded outcome, not a silent one:** write
  `lessons: skipped: <why>` to the epic record and report it, so EPIC_WRAP can complete
  instead of waiting forever on a PR that will never open.
- **Polish the docs.** Each issue edited the docs in isolation, so the corpus accretes the same
  way code does — the same concept re-explained across pages, guides swollen into walls of text,
  navigation that stopped cohering. At epic wrap, once the batch's impl PRs have merged, dispatch
  **one bounded sub-agent** (worktree, like `epic-agent`) to run **`polish-docs`** scoped to
  the docs the batch touched: it consolidates, streamlines, and re-arranges for readability, then
  opens a **draft** docs-cleanup PR against the default branch. Keep it **draft** — bold
  rearrangement is exactly what a human should eyeball before merge. The coordinator holds only the PR
  handle and surfaces it; it never reads or applies the edits itself. Separate from the "lessons"
  PR (grounding) and the epic PR (which closes unmerged). Skip only for an epic that touched no
  docs — and record it as `docs_polish: skipped: <why>` in the epic record, same as above, so
  the wrap terminates.

## Intake — filing & queueing discovered issues

Work surfaces new issues: a worker (or the spec/impl phases) hits a missing piece, a
follow-up, or a blocker. Don't drop it and don't scope-creep it into the current issue
— **file it** through the **`issue-manager`** agent (related to its source issue, in
the current project; it duplicate-checks, writes it PM-shaped, wires relations, and
returns a ready/blocked verdict).

Then decide whether it joins the epic:

- **Belongs under the epic and unblocked** (nothing it's blocked-by is still open/in-progress
  — the wake enforces this from Linear each refresh and reports anything blocked in `blocked`)
  → it *may be added to the active set*, up to the concurrency cap, entering at its
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
- **Blocked** → track it (a row in the epic record, marked blocked-by); pull it into
  the active set when its blocker merges (a merge event re-enters the loop).
- Over the cap → queue it; admit it when a slot frees.

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

1. Every spec the epic planned to open is open **and has cleared its own spec-approval
   gate** (Part I + II signed off), and
2. **You have approved running the cross-spec pass.** The coordinator surfaces "all N specs are
   open and approved — run the cross-spec coherence pass?" and waits. It does **not** run
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
   surface it with the trade-off (`AskUserQuestion`) — the coordinator owns all user interaction;
   the review sub-agent never prompts. Conflicts the docs already settle are applied without
   a prompt (noted, not asked). For a conflict the report marks **`fable-candidate`**, the
   walkthrough asks two things, not one: the decision itself, **and** whether to spend a
   **Fable** adjudication on it first (`AskUserQuestion`, with the rough cost). Only on an
   explicit yes does the coordinator dispatch a Fable sub-agent on the slice the report handed up;
   its recommendation comes back as that conflict's resolution (marked `adjudicated: Fable`),
   still decision-needed — Fable advises, you decide. On no, you decide it directly. Fable is
   never spawned without that yes (see `AGENTS.md` → model tiering, upward escalation).
4. **Route the alignment.** For each spec that must change to land a decision (or a POC
   verdict), pick the cheaper channel:
   - **Direct** — dispatch that issue's `issue-worker` to update its spec (repo doc +
     Linear in sync, per `issue-spec`) with the agreed change.
   - **PR comment** — when a direct update isn't warranted yet, leave a comment on that
     spec PR describing the required alignment, to be picked up in its review rounds.
5. **Re-review the aligned specs** and keep the **stop-before-implement** gate on every
   issue. An alignment edit is a *spec-level* change by construction — a cross-spec conflict
   is never below the bar — so it earns a fresh round outside the two-round budget, and the
   issue returns to spec review before it implements.

Run this once per epic when the set stabilizes; re-run only if a later approved spec joins
the set or an alignment edit could ripple.

## Gates & autonomy

**The gates are the only human blocks. Everything between them is the coordinator's job to keep
moving.** This skill exists to drive work *forward* — to coordinate related issues into a
cohesive, synergistic whole and keep the process advancing — not to ask permission at each
step. So:

- **A satisfied gate is a release — proceed, don't re-ask.** The moment an issue's
  spec-approval gate is met (an approving comment/review on the spec PR, **or the user saying
  "approved" in-session**), that issue advances **straight through to implementation on the
  same wake** — the worker chains approval → close spec PR → dispatch `issue-implement` without
  ending its turn (see `issue-lifecycle` → Phases). **Never** hold an approved issue waiting for
  a *second*, generic "ok to implement?" — the approval already was that go-ahead. Sitting in a
  holding pattern after approval is the failure this section exists to prevent.
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
- **Spec-approval gate is per issue, and only on the spec route.** Approvals are
  independent — issue B isn't blocked by issue A's pending spec, and a **bug** has no such
  gate at all. Never manufacture one: asking the user to approve a spec for an issue that
  will never have a spec parks the row on an answer nobody can give.
- **Spec review converges; it doesn't wait for silence.** A spec that has spent its round
  budget goes to the gate. Open review threads are not an external signal to wait on — the
  spec PR is never merged, so they gate nothing.
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
- **Stop before merge**, per issue. The coordinator never merges — that is the one gate *out*.

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
- Never read specs/diffs at the coordinator level. Handles and status only.

## Boundaries

- **One epic.** Parallel *coordination* of the related issues under it. Issues with hard
  dependencies on each other should be sequenced (run the blocker to merge-ready first)
  rather than run concurrently.
- **Unrelated issues are not an epic.** Don't wrap a convenience batch in a fabricated
  epic to get parallelism — run those as independent `issue-lifecycle` sessions.
- Composes `issue-lifecycle` (one lifecycle definition, reused per issue). It does
  not reimplement the lifecycle.
