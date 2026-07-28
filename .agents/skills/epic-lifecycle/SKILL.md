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
| **AWAITING_OBJECTIVE** | The epic's purpose/outcome is up for sign-off; sub-issues hold at NEEDS_SPEC. Epic-PR review runs on the same two-round budget as a spec PR | An approving human comment or review lands on the epic PR |
| **RUNNING** | Each sub-issue advances through its own `issue-lifecycle` in its own worktree, in parallel up to the cap. Per-issue spec-approval gates surface as they arrive; epic feedback fans down | Every sub-issue is merged, closed, or dropped |
| **EPIC_WRAP** | Close the epic PR unmerged (branch kept); dispatch `distill-lessons` and `polish-docs` as draft PRs | **Each** wrap pass is either surfaced as a draft PR **or explicitly skipped** — both passes have documented skip conditions (no rework worth measuring · no docs touched), so "skipped, and why" is a terminal outcome exactly like "surfaced". Record the disposition of each in the epic record and report it; never wait on a PR a skip condition means will never exist |

## How it stays safe and cheap

- **One worktree per issue.** Each issue's work runs in a worker sub-agent declared
  `isolation: worktree`, so it lives on its own branch in its own git worktree.
  Parallel commits/pushes never collide — the whole reason worktrees exist here.
- **Thin coordinator, isolated workers.** The coordinator holds only a compact **status
  table** — one row per issue: `issue · phase · spec PR# · impl PR# · spec-review rounds ·
  settling · gate-pending? · worktree`. It never holds a worker's context. Each worker advances its
  issue by **one bounded step** (via `issue-lifecycle`) in its own context and returns
  **≤ a couple of lines** of status, then exits. Token cost at the coordinator level is a
  small table across wakes, regardless of how much work the issues involve.
- **Event-driven, like the single-issue loop.** The coordinator is the event loop. It ends
  its turn while issues are idle and re-enters on PR events or a scheduled check-in;
  on re-entry it refreshes each row from Linear + PR state (cheap fetches) and acts
  only where there's a pending action.

## Sizing to the VM (read this before picking N)

A Cloud session is **4 vCPU / 16 GB RAM / 30 GB disk**, and **each worktree is a full
checkout**. Full lifecycles also run installs/builds/tests. So keep concurrency
modest — **~3–4 active issues** is a sane default; go higher only for light issues.
If disk or memory gets tight, cap the number of *simultaneously implementing* issues
even if more are queued. State the chosen N and the cap to the user.

> **Working memory is session-only — never commit it.** The epic board and the
> per-issue handle caches live in the **gitignored `.orchestration/`** directory.
> Never `git add`, commit, or open a PR for these files. Commit only real issue work,
> and only inside each issue's own worktree/branch. A PR whose diff is a board /
> status / scratch file is a bug — do not open it.

## The loop (each invocation)

1. **Resolve the epic and its set.** Take the epic issue ID, or the issue IDs, from the
   argument (you may compose `linear-triage` for selection) and confirm the set with the
   user. Then establish the epic — see [Epic setup](#epic-setup-the-coordination-layer-every-run-has).
   Record the set + chosen N in `.orchestration/epic.md` (compact: the issue list and
   per-issue handle-cache pointers), **and the epic handle alongside it** (epic issue ID ·
   name · `epic/<name>` branch · epic PR#), so it survives across wakes — the next refresh
   needs it to re-check the epic PR for its approving comment or review, keep the epic PR
   subscribed, and pass the branch/SHA to workers. Two more coordinator-owned fields live
   here because nothing else can hold them across wakes: **`epic_review_rounds`** (the epic
   PR's own review budget) and, at wrap, each pass's **disposition**
   (`lessons: <PR#|skipped: why>` · `docs_polish: <PR#|skipped: why>`).
2. **Refresh the table.** Fetch each issue's Linear state + PR status to derive its phase
   (reuse each issue's `.orchestration/<ISSUE>.md` handle cache) — **including each open spec
   PR's comments and reviews**: an **approving human comment or GitHub Review** on the spec PR (a
   "approved" comment, or a Review whose **latest state is `APPROVED` on the current head**
   — not any historical approval left stale by a later push or `CHANGES_REQUESTED` — from a
   human, not a bot, not a bot-authored comment/review body, and for a review, not the PR's own
   author; full rule in [`orchestration.md`](../../../docs/contributing/orchestration.md) →
   Gates) signals moving to implementation. Fetch the **epic issue and its sub-issues in one
   Linear query** (parent→children — the point of the parent model) rather than N independent
   fetches, and check the epic PR for an **approving human comment or review**; resolve the epic
   branch handle (branch + head SHA) **once here** and pass it to workers in step 3 so they don't
   each re-fetch it. These read-only fetches — including scanning a PR's comments and reviews for
   a human approval — are the mechanical tier: use the **`scout`** agent (Haiku), not a full
   worker. Do **not** re-dispatch the worktree workers just to read state. When scout reports an
   approving comment or review, **mirror it to the `spec approved` / `epic approved` label** so
   the sign-off stays filterable (loop step 4/5). (Subscription happens once, in step 6,
   after step 3/4 may have opened new PRs this turn — don't subscribe here, it's premature:
   any PR a worker opens in step 3 doesn't exist yet at this point in the loop.)
3. **Advance where there's a pending action.** For each issue that has a next bounded
   action (needs spec, has unhandled PR events *within its spec-review budget*, spec just
   approved, …) and is within the concurrency cap, dispatch an **`issue-worker`** — the
   custom agent at `.claude/agents/issue-worker.md`, which declares `isolation: worktree`
   (its own worktree/branch) and has no `AskUserQuestion` (it never prompts; it returns
   blockers for the coordinator to surface). **Epic gate:** if the epic PR has **no approving
   comment or review** (as re-derived by step 2's scan this wake — the gate is the fresh
   evidence, not the `epic approved` label, which is only the mirror you write), hold every
   sub-issue at NEEDS_SPEC — do **not** dispatch a worker to advance one. **Spec-review
   budget:** an issue that has spent its two spec-review rounds **and whose last worker
   reported `spec_level_found: no`** is *not* a pending action — log the event and leave it
   awaiting the human gate. If the last worker reported `spec_level_found: yes`, the
   **authorized third round** is still pending: dispatch it (once), and say in one line why
   the extra round was spent. See [Spec review](#spec-review-converge-dont-grind). When you
   do dispatch, pass the resolved
   **epic handle** (branch + SHA) from step 2 so `issue-spec` can align without re-fetching:

   ```
   Agent tool (agentType: issue-worker):
     description: "Advance <ISSUE>"
     prompt: Advance <ISSUE> to its next external wait, in your worktree — a satisfied gate
             is not a wait, so chain through it (a just-approved spec goes close-PR →
             implement → open impl PR in this run). Return the compact status line, then exit.
   ```

   Dispatch independent issues' workers **in parallel** (one message, multiple calls),
   up to the cap. (Where the harness lacks custom agents, fall back to the Agent tool
   with `isolation: worktree` and the same prompt.)

   **Also dispatch any `settle_requested` from the last round** — a `poc-agent` on the claim
   slice, in parallel with everything else, counted against the same cap. See
   [When a thread turns on a fact](#when-a-thread-turns-on-a-fact-dispatch-a-poc--dont-buy-another-round).
   And **route any verdict that came back** by dispatching that issue's worker to apply it.
4. **Collect compact status** and update the table. Never fold a worker's full output
   in — one status line per issue. Then **write the Linear-status mirror** for any phase
   transition this refresh surfaced (Linear auto-status is off; the mapping + state IDs
   live in `issue-lifecycle` → "Linear status is a mirror you own"). Workers set the
   mirror for transitions they effect (they opened the PR); the coordinator sets it inline for
   the spec-approval-comment and merge transitions it detects — and, for a detected approval,
   also applies the `spec approved` / `epic approved` label as the durable mirror. Idempotent —
   skip if the issue is already in the target state (and the label already present).
5. **Surface gates.** If the epic is awaiting its objective sign-off, surface the epic
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
   blocked on it, but the user shouldn't sign off on a contested premise unknowingly. The coordinator holds the *link*, not the spec text.
   The *other* issues keep moving. For any issue **ready to merge**, surface it and stop there
   (merge is the user's).
6. **End the turn.** **Subscribe to every currently-open PR named in the (now fully updated)
   table** — each issue's spec PR, each issue's impl PR#(s), and the epic PR —
   unconditionally, every turn, not only when a PR first opens. Do this **here, after step 4**,
   not in step 2: step 3 may have dispatched a worker that opened a brand-new PR this very
   turn, and step 4 is where that PR# lands in the table — subscribing any earlier would miss
   it, leaving it deaf to review/approval activity until the next heartbeat. `subscribe_pr_activity`
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
   transitions webhooks *don't* cover — CI success and merge/close — are caught on the scout's
   table refresh (step 2). Schedule one check-in
   (`send_later`, ~30–60 min) as the backstop and re-arm while any issue is live. Re-enter
   on PR events or the check-in. Move to EPIC_WRAP once every issue is merged, closed, or dropped.

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
spec-review round budget". The coordinator's job is only this:

- **Carry the round count in the table** (`spec-review rounds`, per issue) so the budget
  survives across wakes. **Add only the rounds the worker reports it actually spent**
  (`spec_review: <rounds spent>`), not one per event dispatched — a batch that was nothing but
  factual corrections or broken references costs no round by rule, so charging it one would
  burn the budget on typos and get later substantive feedback ignored.
- **Stop dispatching rounds at the budget — unless a third is authorized.** A spec-PR review
  event on an issue at budget whose last worker reported `spec_level_found: no` is **not** a
  pending action for step 3 — log it and leave the issue awaiting its human gate. If the last
  worker reported `spec_level_found: yes`, the conditional third round *is* authorized: run it
  once and say why. Otherwise only a *human* event on that PR (an approval, or the user asking
  for a change) reactivates it.
- **Surface convergence as convergence.** When an issue converges, say so at step 5: the
  spec is directionally settled, remaining threads are carried as implementer notes, and the
  approval gate is the next move. Don't present it as "still in review".
- **A bot `CHANGES_REQUESTED` holds nothing.** It doesn't trip the gate (only a human's
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
(POC settlement)"; the per-issue mechanics are in `issue-lifecycle` → "POC settlement". The
coordinator's job is only this:

- **Dispatch on request, no approval needed.** A worker returns `settle_requested: <claim
  slice>` (it exits before a verdict could land); you dispatch the **`poc-agent`**
  (`.claude/agents/poc-agent.md` — worktree, Sonnet, never prompts) alongside your issue
  workers. Unlike a `fable-candidate` this needs **no user yes** — cheap enough to dispatch
  without approval, not a ceremony like Fable. That's about *friction*, not frequency: the
  loop trigger still governs how often it fires.
- **It counts against the VM cap.** A POC is a full worktree — roughly an issue's worth of
  load on a box sized for ~3–4. **Dedupe first, then queue**: one claim argued on two issues is
  **one** settlement fanned to both, and at the cap a POC waits behind the issue workers rather
  than starving them. A settlement that starts a wake later still beats two more review rounds.
  Dispatching several at once means the trigger has slipped — that's the POC farm to avoid.
- **Carry it in the table, never wait on it.** Add `settling` to the issue's row
  (`<claim> · in-flight | <verdict>`). A POC never makes an *issue* pending — it makes a claim
  pending, and **sibling issues are untouched**.
- **Disclose in-flight settlements at step 5**, in one line, when you surface that spec for
  approval.
- **Route the verdict on the wake it returns** — dispatch that issue's worker to apply it per
  `issue-spec` 6.5.3, then clear `settling` to the verdict. Note the two timing rules in
  `issue-lifecycle` → "POC settlement": the spec PR stays **open** while a load-bearing
  settlement is live, and a late `REFUTED` is folded like a challenger-surfaced blind spot.
- **A cross-cutting claim is settled once for the epic.** Have `epic-agent` record the verdict
  in the epic-spec's cross-cutting decisions so a third issue doesn't reopen it.

**The epic PR gets the same treatment**, through the same request path: `epic-agent` returns
`settle_requested` for a looping factual claim a cross-cutting decision rests on, and you
dispatch the `poc-agent` — a fourth epic-review round is what that replaces. Hand the verdict
back to `epic-agent` to fold and record in the epic-spec's cross-cutting decisions, so a
sibling issue can't reopen the same claim.

### The epic PR gets the same budget

The epic-spec is a direction artifact too, so it is reviewed at the same altitude and
**carries its own two-round budget** — without one, the epic PR is the single place this
change's unbounded-review loop would survive, right at the top-level gate. The coordinator
owns the epic PR (workers can't), so the counter is the coordinator's:

- Track `epic_review_rounds` in `.orchestration/epic.md`, alongside the epic handle, so it
  survives wakes. `epic-agent` reports the rounds it spent and whether anything it folded was
  above the bar (objective- or cross-cutting-decision-level).
- **Re-dispatch `epic-agent` to fold epic-PR feedback only while the budget allows**, on the
  same terms as an issue spec: add only rounds actually spent, a third round only when round
  two found something above the bar, and never a round spent to satisfy a bot.
- At budget, the epic-spec has **converged**: surface the objective for sign-off and stop
  folding. Remaining epic-PR threads are carried the same way an issue spec carries its
  §13 notes — routed to the relevant issues' implementer notes, not held against the gate.
- **The objective gate is unaffected either way.** Only a human's approving comment or
  review trips it; a bot review on the epic PR neither holds it nor buys another round. And
  the epic's *direction* still flows continuously — the budget bounds the *folding*, not the
  epic's ability to receive and route feedback.

## Epic setup (the coordination layer every run has)

The set belongs to one body of work with **cross-cutting concerns** — shared surface,
naming, sequencing, common direction — so the epic-spec exists to keep those decisions out
of a vacuum. **The epic-spec, its conventions, the objective gate, and the index-vs-table
distinction are defined in
[`docs/contributing/orchestration.md`](../../../docs/contributing/orchestration.md)** — read
it; below is only the coordinator's *operating procedure*.

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
- **Enforce the objective gate.** Surface the epic-spec's purpose/objective for the
  **approving comment or review** sign-off and hold the epic's issues at NEEDS_SPEC until it
  lands (loop step 3). It's the *only* epic-level gate — direction stays ungated. When an
  approving human comment or review lands on the epic PR, **the coordinator writes both mirrors**
  — it applies the `epic approved` label (durable, filterable record) *and* moves the Epic
  *issue's* Linear state to reflect "objective approved" (the comment or review is the
  trigger; the label and Linear state are human-facing mirrors, and the coordinator owns keeping
  them in step so they don't drift).
- **Own the subscription; fan feedback down.** Route epic PR review/human feedback **down**
  to the aligned issue workers (sub-agents can't subscribe; the coordinator does, same as a
  spec-PR event) — **when it's above the bar.** An epic comment that changes a cross-cutting
  decision fans down; one about a single issue's internals goes to that issue's implementer
  notes, not into its spec. When an epic comment is **heavy or its fan-out target is unclear**
  ("which issues does this touch?"), offload the *read* to **`scout`** — it returns the target
  issues; you route — rather than pulling the content into the coordinator's context. Then
  re-dispatch `epic-agent` to **fold** the feedback into the epic-spec **and** refresh its
  running index from the PR handles in your table — one update pass, not a separate mode.
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

- **Belongs under the epic and unblocked** (nothing it's blocked-by is still open/in-progress)
  → it *may be added to the active set*, up to the concurrency cap, entering at NEEDS_SPEC.
  It still hits its own **spec-approval gate** before any implementation — so this
  starts a *spec*, not unreviewed code. Surface each addition to the user. **Pass the epic
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

   **Dedupe and cap before dispatching.** Several conflicts often reduce to *one* claim — settle
   it once and fan the verdict out. Expect zero or one settlement per review; if the report
   hands you three, batch them behind the issue workers rather than dispatching a fleet into a
   VM sized for ~3–4 (each POC is a full worktree). Cross-spec is the weakest firing bar in the
   system — two specs disagreeing is cheaper to trigger than a two-round review loop — so the
   coordinator is where that gets bounded.
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
  first), or resolve the decision from the spec/codebase. Surface it to the user **only** when
  it genuinely needs a human call (a decision the spec doesn't settle) — with the specific
  question, not a vague "should I continue?". A prerequisite that simply needs to land is
  tracked and ordered by the coordinator, never a reason to idle.
- **Spec-approval gate is per issue.** Approvals are independent — issue B isn't blocked by
  issue A's pending spec.
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
- Depth stays within Claude Code's 5-level cap: coordinator (main) → worktree worker
  running issue-lifecycle (1) → the phase skill it dispatches, e.g. issue-implement
  (2) → that skill's implementer / `review` sub-agents (3) → review lenses (4).
  Comfortable. If you ever approach the cap, have the worker run the phase skill
  in-context rather than dispatching a further sub-agent.
- Never read specs/diffs at the coordinator level. Handles and status only.

## Boundaries

- **One epic.** Parallel *coordination* of the related issues under it. Issues with hard
  dependencies on each other should be sequenced (run the blocker to merge-ready first)
  rather than run concurrently.
- **Unrelated issues are not an epic.** Don't wrap a convenience batch in a fabricated
  epic to get parallelism — run those as independent `issue-lifecycle` sessions.
- Composes `issue-lifecycle` (one lifecycle definition, reused per issue). It does
  not reimplement the lifecycle.
