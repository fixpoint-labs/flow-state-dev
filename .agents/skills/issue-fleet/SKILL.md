---
name: issue-fleet
description: Coordinate MULTIPLE Linear issues through their full lifecycle in parallel within one session — each issue on its own branch in its own git worktree so parallel commits never collide. A thin, event-driven fleet coordinator that composes issue-lifecycle per issue via worktree-isolated sub-agents, holds only a compact per-issue status table (never the workers' transcripts), surfaces each issue's spec-approval gate as it arrives while the others keep moving, and stops each before merge. Sizes concurrency to the session VM.
argument-hint: "<issue IDs, e.g. FIX-1 FIX-2 FIX-3 — or a selection to confirm>"
---

# Issue Fleet

Run several issues at once — each getting the full `issue-lifecycle` (spec →
approval → implement → PR feedback) — from a single session, without their branches
colliding and without the coordinator's token count exploding.

## How it stays safe and cheap

- **One worktree per issue.** Each issue's work runs in a worker sub-agent declared
  `isolation: worktree`, so it lives on its own branch in its own git worktree.
  Parallel commits/pushes never collide — the whole reason worktrees exist here.
- **Thin coordinator, isolated workers.** The fleet holds only a compact **status
  table** — one row per issue: `issue · phase · spec PR# · impl PR# · gate-pending?
  · worktree`. It never holds a worker's context. Each worker advances its issue by
  **one bounded step** (via `issue-lifecycle`) in its own context and returns
  **≤ a couple of lines** of status, then exits. Token cost at the fleet level is a
  small table across wakes, regardless of how much work the issues involve.
- **Event-driven, like the single-issue loop.** The fleet is the event loop. It ends
  its turn while issues are idle and re-enters on PR events or a scheduled check-in;
  on re-entry it refreshes each row from Linear + PR state (cheap fetches) and acts
  only where there's a pending action.

## Sizing to the VM (read this before picking N)

A Cloud session is **4 vCPU / 16 GB RAM / 30 GB disk**, and **each worktree is a full
checkout**. Full lifecycles also run installs/builds/tests. So keep concurrency
modest — **~3–4 active issues** is a sane default; go higher only for light issues.
If disk or memory gets tight, cap the number of *simultaneously implementing* issues
even if more are queued. State the chosen N and the cap to the user.

> **Working memory is session-only — never commit it.** The fleet board and the
> per-issue handle caches live in the **gitignored `.orchestration/`** directory.
> Never `git add`, commit, or open a PR for these files. Commit only real issue work,
> and only inside each issue's own worktree/branch. A PR whose diff is a board /
> status / scratch file is a bug — do not open it.

## The loop (each invocation)

1. **Resolve the set (and the epic, if any).** Take the issue IDs from the argument, or
   propose a set (you may compose `linear-triage` for selection)
   and confirm with the user. Record the set + chosen N in `.orchestration/fleet.md`
   (compact: the issue list and per-issue handle-cache pointers). If the set shares a
   Linear project with **cross-cutting concerns**, discover or create its **epic** now —
   see [Epic coordination](#epic-coordination-optional--when-the-set-shares-cross-cutting-concerns) —
   and **record the epic handle (epic issue ID · name · `epic/<name>` branch · epic PR#) in
   `.orchestration/fleet.md` alongside the set**, so it survives across wakes (the next
   refresh needs it to re-check the epic PR for its approving comment or review, keep the epic PR
   subscribed, and pass the branch/SHA to workers).
2. **Refresh the table.** Fetch each issue's Linear state + PR status to derive its phase
   (reuse each issue's `.orchestration/<ISSUE>.md` handle cache) — **including each open spec
   PR's comments and reviews**: an **approving human comment or GitHub Review** on the spec PR (a
   "approved" comment, or a Review whose **latest state is `APPROVED` on the current head**
   — not any historical approval left stale by a later push or `CHANGES_REQUESTED` — from a
   human, not a bot, not a bot-authored comment/review body, and for a review, not the PR's own
   author; full rule in [`orchestration.md`](../../../docs/contributing/orchestration.md) →
   Gates) signals moving to implementation. **If an epic is active,** fetch the **epic issue and its sub-issues in one
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
   action (needs spec, has unhandled PR events, spec just approved, …) and is within
   the concurrency cap, dispatch an **`issue-worker`** — the custom agent at
   `.claude/agents/issue-worker.md`, which declares `isolation: worktree` (its own
   worktree/branch) and has no `AskUserQuestion` (it never prompts; it returns
   blockers for the fleet to surface). **Epic gate:** if the issue is under an epic whose
   epic PR has **no approving comment or review** (as re-derived by step 2's scan this wake —
   the gate is the fresh evidence, not the `epic approved` label, which is only the mirror the
   fleet writes), hold it at NEEDS_SPEC — do **not** dispatch a worker to advance it
   (that's the objective gate; see Epic coordination). When you do
   dispatch, pass the resolved **epic handle** (branch + SHA) from step 2 so `issue-spec`
   can align without re-fetching:

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
4. **Collect compact status** and update the table. Never fold a worker's full output
   in — one status line per issue. Then **write the Linear-status mirror** for any phase
   transition this refresh surfaced (Linear auto-status is off; the mapping + state IDs
   live in `issue-lifecycle` → "Linear status is a mirror you own"). Workers set the
   mirror for transitions they effect (they opened the PR); the fleet sets it inline for
   the spec-approval-comment and merge transitions it detects — and, for a detected approval,
   also applies the `spec approved` / `epic approved` label as the durable mirror. Idempotent —
   skip if the issue is already in the target state (and the label already present).
5. **Surface gates.** If an **epic** is awaiting its objective sign-off, surface the epic
   PR (its purpose/objective) and note that an **approving comment or review on the epic PR**
   releases the epic's issues to start — until then they hold at NEEDS_SPEC. Then, per issue:
   for any issue **awaiting spec approval** (its spec PR is open, Part I + II), surface the
   **spec PR link** for review and note that **an approving comment or review on the spec PR**
   is the go-ahead to implement (a plain "approved" comment, or an Approve-state review, from a
   human other than the PR's author — the label is applied by the fleet, not the human) — the
   fleet holds the *link*, not the spec text. The *other*
   issues keep moving. For any issue **ready to merge**, surface it and stop there (merge
   is the user's).
6. **End the turn.** **Subscribe to every currently-open PR named in the (now fully updated)
   table** — each issue's spec PR, each issue's impl PR#(s), and the epic PR (if active) —
   unconditionally, every turn, not only when a PR first opens. Do this **here, after step 4**,
   not in step 2: step 3 may have dispatched a worker that opened a brand-new PR this very
   turn, and step 4 is where that PR# lands in the table — subscribing any earlier would miss
   it, leaving it deaf to review/approval activity until the next heartbeat. `subscribe_pr_activity`
   is idempotent, so re-subscribing to a PR already subscribed costs nothing; doing it
   unconditionally off the full table (not just "PRs that changed this turn") is what makes a
   lost subscription self-heal on the very next wake — a worker opened a PR and exited before
   subscribing (sub-agents can't hold one — only the fleet can), a call was skipped, or the
   session cold-resumed. A spec PR's review activity during Case/spec review
   must wake the fleet, not wait for the heartbeat, and epic PR activity must too (so feedback
   can fan down and an approving comment or review on the epic PR is caught). **The two
   sign-off gates now ride that stream** — both a comment and a review submission are
   delivered PR-activity events, so a spec- or epic-PR approval (either form) wakes the fleet
   immediately (the reason the gates moved off labels, whose webhook never arrives). The
   transitions webhooks *don't* cover — CI success and merge/close — are caught on the scout's
   table refresh (step 2). Schedule one fleet check-in
   (`send_later`, ~30–60 min) as the backstop and re-arm while any issue is live. Re-enter
   on PR events or the check-in. Stop the fleet once every issue is merged, closed, or dropped.

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

## Epic coordination (optional — when the set shares cross-cutting concerns)

When the set belongs to one body of work (usually a Linear project) with **cross-cutting
concerns** — shared surface, naming, sequencing, common direction — stand up an
**epic-spec** so those decisions aren't made in a vacuum. A batch of unrelated issues
needs none; skip it (tenets 2/3). **The epic-spec, its conventions, the objective gate,
and the index-vs-table distinction are defined in
[`docs/contributing/orchestration.md`](../../../docs/contributing/orchestration.md)** — read
it; below is only the *fleet's* operating procedure.

The fleet coordinates; the **`epic-agent`** (`.claude/agents/epic-agent.md`, worktree, no
`AskUserQuestion`) writes:

- **Discover, then create.** An issue's epic is its **parent** — have `scout` check the set
  in one pass and return `{ epicIssueId, consistent }`. If they all share the same
  **`Epic`-labelled (Kind group)** parent, reuse it. If the set is **mixed** (some under an
  epic, some not) or carries **two different epic parents**, don't guess — surface it to the
  user before creating a second epic. Otherwise dispatch `epic-agent` to stand one up: it
  creates the **Epic issue**
  (`Epic` Kind label), **re-parents the set's issues as sub-issues**, writes the epic-spec
  (`epic/<name>` branch + never-merged epic PR + the spec attached as the Epic issue's Linear
  document), and returns the handles. The fleet holds only handles (epic issue ID, name,
  branch, epic PR#), never the spec text.
- **Enforce the objective gate.** Surface the epic-spec's purpose/objective for the
  **approving comment or review** sign-off and hold the epic's issues at NEEDS_SPEC until it
  lands (loop step 3). It's the *only* epic-level gate; direction stays ungated. When an
  approving human comment or review lands on the epic PR, **the fleet writes both mirrors**
  — it applies the `epic approved` label (durable, filterable record) *and* moves the Epic
  *issue's* Linear state to reflect "objective approved" (the comment or review is the
  trigger; the label and Linear state are human-facing mirrors, and the fleet owns keeping
  them in step so they don't drift).
- **Own the subscription; fan feedback down.** Route epic PR review/human feedback **down**
  to the aligned issue workers (sub-agents can't subscribe; the fleet does, same as a
  spec-PR event). When an epic comment is **heavy or its fan-out target is unclear** ("which
  issues does this touch?"), offload the *read* to **`scout`** — it returns the target
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
  unmerged). The fleet holds only the PR handle and surfaces it; it never reads or applies
  the lessons itself. This is also where the Fable-escalation trial is *measured* — the
  ledger's `design-off` trend is the evidence it's earning its cost. Skip for a batch with
  no epic, or one with no rework worth measuring — this is the loop-measurement payoff, not
  ceremony for every fleet.
- **Polish the docs.** Each issue edited the docs in isolation, so the corpus accretes the same
  way code does — the same concept re-explained across pages, guides swollen into walls of text,
  navigation that stopped cohering. At epic wrap, once the batch's impl PRs have merged, dispatch
  **one bounded sub-agent** (worktree, like `epic-agent`) to run **`polish-docs`** scoped to
  the docs the batch touched: it consolidates, streamlines, and re-arranges for readability, then
  opens a **draft** docs-cleanup PR against the default branch. Keep it **draft** — bold
  rearrangement is exactly what a human should eyeball before merge. The fleet holds only the PR
  handle and surfaces it; it never reads or applies the edits itself. Separate from the "lessons"
  PR (grounding) and the epic PR (which closes unmerged). Skip only for a batch that touched no
  docs.

## Intake — filing & queueing discovered issues

Work surfaces new issues: a worker (or the spec/impl phases) hits a missing piece, a
follow-up, or a blocker. Don't drop it and don't scope-creep it into the current issue
— **file it** through the **`issue-manager`** agent (related to its source issue, in
the current project; it duplicate-checks, writes it PM-shaped, wires relations, and
returns a ready/blocked verdict).

Then decide whether it joins the fleet:

- **Related and unblocked** (nothing it's blocked-by is still open/in-progress) → it
  *may be added to the active set*, up to the concurrency cap, entering at NEEDS_SPEC.
  It still hits its own **spec-approval gate** before any implementation — so this
  starts a *spec*, not unreviewed code. Surface each addition to the user. **When an epic
  is active, pass the epic issue ID to `issue-manager`** so the new issue is **parented
  under the epic** (subject to the same one-parent safety check) — otherwise it won't show
  under the epic in Linear and `issue-spec` won't discover the epic via `issue.parent`.
- **Blocked** → track it (a row in the fleet record, marked blocked-by); pull it into
  the active set when its blocker merges (a merge event re-enters the fleet).
- Over the cap → queue it; admit it when a slot frees.

This is how discovered work flows into the loop without a human re-filing it — while
the spec-approval gate keeps a human in the loop before anything is built.

## Cross-spec coherence (gated on your approval)

A fleet produces several specs at once, each authored and reviewed in isolation. Each can
be locally excellent while the *set* is incoherent — two specs claim the same surface, one
decides a shape a sibling contradicts, one assumes what another removes. Per-spec review
can't see that; a batch-level pass can. Incoherence is the failure this project guards
against first (tenet 1), so once the fleet's specs exist, the set gets one coherence pass
before any of them is built.

**The gate — never align to an unvalidated spec.** Cross-aligning specs only helps if each
is already sound; aligning a good spec to a still-wrong one spreads the flaw. So this pass
runs only when **both** hold:

1. Every spec the fleet planned to open is open **and has cleared its own spec-approval
   gate** (Part I + II signed off), and
2. **You have approved running the cross-spec pass.** The fleet surfaces "all N specs are
   open and approved — run the cross-spec coherence pass?" and waits. It does **not** run
   automatically.

Once both hold:

1. **Dispatch `cross-spec-review`** over the spec set (it forks into its own sub-agent,
   reads every spec in *its* context, and returns a compact ranked **conflict report** —
   the fleet holds the report, never the spec texts). Read-only.
2. **Walk you through the decisions.** For each conflict the report marks *decision-needed*,
   surface it with the trade-off (`AskUserQuestion`) — the fleet owns all user interaction;
   the review sub-agent never prompts. Conflicts the docs already settle are applied without
   a prompt (noted, not asked). For a conflict the report marks **`fable-candidate`**, the
   walkthrough asks two things, not one: the decision itself, **and** whether to spend a
   **Fable** adjudication on it first (`AskUserQuestion`, with the rough cost). Only on an
   explicit yes does the fleet dispatch a Fable sub-agent on the slice the report handed up;
   its recommendation comes back as that conflict's resolution (marked `adjudicated: Fable`),
   still decision-needed — Fable advises, you decide. On no, you decide it directly. Fable is
   never spawned without that yes (see `AGENTS.md` → model tiering, upward escalation).
3. **Route the alignment.** For each spec that must change to land a decision, pick the
   cheaper channel:
   - **Direct** — dispatch that issue's `issue-worker` to update its spec (repo doc +
     Linear in sync, per `issue-spec`) with the agreed change.
   - **PR comment** — when a direct update isn't warranted yet, leave a comment on that
     spec PR describing the required alignment, to be picked up in its review rounds.
4. **Re-review the aligned specs** (an alignment edit is a spec change like any other) and
   keep the **stop-before-implement** gate on every issue. An issue whose spec changed
   returns to spec review before it implements.

Run this once per batch when the set stabilizes; re-run only if a later approved spec joins
the set or an alignment edit could ripple.

## Gates & autonomy

**The gates are the only human blocks. Everything between them is the fleet's job to keep
moving.** The fleet exists to drive work *forward* — to coordinate related issues into a
cohesive, synergistic whole and keep the process advancing — not to ask permission at each
step. So:

- **A satisfied gate is a release — proceed, don't re-ask.** The moment an issue's
  spec-approval gate is met (an approving comment/review on the spec PR, **or the user saying
  "approved" in-session**), that issue advances **straight through to implementation on the
  same wake** — the worker chains approval → close spec PR → dispatch `issue-implement` without
  ending its turn (see `issue-lifecycle` → Phases). **Never** hold an approved issue waiting for
  a *second*, generic "ok to implement?" — the approval already was that go-ahead. Sitting in a
  holding pattern after approval is the failure this section exists to prevent.
- **Drain, don't stall.** End the fleet's turn only when every remaining issue is genuinely
  **waiting on an external signal** (an unmet gate, CI, a review, a dependency PR still open).
  If a refresh shows an issue whose next action needs no new input — approval just landed,
  a dependency just merged — dispatch it *this* turn; don't leave it for the heartbeat.
- **A real blocker is the agent's to resolve or sequence, not to punt.** If implementation
  can't proceed because of an open decision or an unlanded prerequisite from another issue,
  that's the fleet's problem to handle: sequence the prerequisite (run its blocker to merge
  first), or resolve the decision from the spec/codebase. Surface it to the user **only** when
  it genuinely needs a human call (a decision the spec doesn't settle) — with the specific
  question, not a vague "should I continue?". A prerequisite that simply needs to land is
  tracked and ordered by the fleet, never a reason to idle.
- **Spec-approval gate is per issue.** Approvals are independent — issue B isn't blocked by
  issue A's pending spec.
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
- **Stop before merge**, per issue. The fleet never merges — that is the one gate *out*.

## Token & depth discipline

- The fleet's context is the status table + the fleet record. Nothing else persists
  across wakes. Workers are the token sink, and they're isolated and discarded.
- Depth stays within Claude Code's 5-level cap: fleet (main) → worktree worker
  running issue-lifecycle (1) → the phase skill it dispatches, e.g. issue-implement
  (2) → that skill's implementer / `review` sub-agents (3) → review lenses (4).
  Comfortable. If you ever approach the cap, have the worker run the phase skill
  in-context rather than dispatching a further sub-agent.
- Never read specs/diffs at the fleet level. Handles and status only.

## Boundaries

- Parallel *coordination* of independent issues. Issues with hard dependencies on
  each other should be sequenced (run the blocker to merge-ready first, or use
  `issue-lifecycle` one at a time) rather than run concurrently.
- Composes `issue-lifecycle` (one lifecycle definition, reused per issue). It does
  not reimplement the lifecycle.
