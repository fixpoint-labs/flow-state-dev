---
name: fsd:issue-fleet
description: Coordinate MULTIPLE Linear issues through their full lifecycle in parallel within one session — each issue on its own branch in its own git worktree so parallel commits never collide. A thin, event-driven fleet coordinator that composes fsd:issue-lifecycle per issue via worktree-isolated sub-agents, holds only a compact per-issue status table (never the workers' transcripts), surfaces each issue's spec-approval gate as it arrives while the others keep moving, and stops each before merge. Sizes concurrency to the session VM.
argument-hint: "<issue IDs, e.g. FIX-1 FIX-2 FIX-3 — or a selection to confirm>"
---

# Issue Fleet

Run several issues at once — each getting the full `fsd:issue-lifecycle` (spec →
approval → implement → PR feedback) — from a single session, without their branches
colliding and without the coordinator's token count exploding.

## How it stays safe and cheap

- **One worktree per issue.** Each issue's work runs in a worker sub-agent declared
  `isolation: worktree`, so it lives on its own branch in its own git worktree.
  Parallel commits/pushes never collide — the whole reason worktrees exist here.
- **Thin coordinator, isolated workers.** The fleet holds only a compact **status
  table** — one row per issue: `issue · phase · spec PR# · impl PR# · gate-pending?
  · worktree`. It never holds a worker's context. Each worker advances its issue by
  **one bounded step** (via `fsd:issue-lifecycle`) in its own context and returns
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
   propose a set (you may compose `fsd:plan-dispatch` / `fsd:linear-triage` for selection)
   and confirm with the user. Record the set + chosen N in `.orchestration/fleet.md`
   (compact: the issue list and per-issue handle-cache pointers). If the set shares a
   Linear project with **cross-cutting concerns**, discover or create its **epic** now —
   see [Epic coordination](#epic-coordination-optional--when-the-set-shares-cross-cutting-concerns) —
   and **record the epic handle (name · `epic/<name>` branch · epic PR# · project doc) in
   `.orchestration/fleet.md` alongside the set**, so it survives across wakes (the next
   refresh needs it to re-read `epic approved`, keep the epic PR subscribed, and pass the
   branch/SHA to workers).
2. **Refresh the table.** For each issue, cheaply fetch its Linear state + PR
   status to derive its phase (reuse each issue's `.orchestration/<ISSUE>.md`
   handle cache) — **including each open spec PR's `draft` flag and its labels**: a flip
   from `draft` to ready signals building Part II, and the **`spec approved` label**
   signals moving to implementation. **If an epic is active,** also read the epic PR's
   **`epic approved` label** and resolve the epic branch handle (branch + head SHA) **once
   here** — pass it to workers in step 3 so they don't each re-fetch it. These read-only
   status/handle fetches are the mechanical tier — use the **`scout`** agent (Haiku), not a
   full worker. Do **not** re-dispatch the worktree workers just to read state.
3. **Advance where there's a pending action.** For each issue that has a next bounded
   action (needs spec, has unhandled PR events, spec just approved, …) and is within
   the concurrency cap, dispatch an **`issue-worker`** — the custom agent at
   `.claude/agents/issue-worker.md`, which declares `isolation: worktree` (its own
   worktree/branch) and has no `AskUserQuestion` (it never prompts; it returns
   blockers for the fleet to surface). **Epic gate:** if the issue is under an epic whose
   **`epic approved`** label is not yet applied, hold it at NEEDS_SPEC — do **not** dispatch
   a worker to advance it (that's the objective gate; see Epic coordination). When you do
   dispatch, pass the resolved **epic handle** (branch + SHA) from step 2 so `fsd:create-spec`
   can align without re-fetching:

   ```
   Agent tool (agentType: issue-worker):
     description: "Advance <ISSUE>"
     prompt: Advance <ISSUE> by its one next bounded step (its current phase), in your
             worktree. Return the compact status line. One step, then exit.
   ```

   Dispatch independent issues' workers **in parallel** (one message, multiple calls),
   up to the cap. (Where the harness lacks custom agents, fall back to the Agent tool
   with `isolation: worktree` and the same prompt.)
4. **Collect compact status** and update the table. Never fold a worker's full output
   in — one status line per issue.
5. **Surface gates.** If an **epic** is awaiting its objective sign-off, surface the epic
   PR (its purpose/objective) and note that applying **`epic approved`** releases the epic's
   issues to start — until then they hold at NEEDS_SPEC. Then, per issue: for any issue
   **awaiting Case approval** (its spec PR is a
   **draft**, Part I only), surface the **draft spec PR link** for a first-pass review and
   note that **marking it ready-for-review triggers the Build Plan (Part II)** — the
   fleet holds the *link*, not the spec text. For any issue **awaiting spec approval**
   (spec PR now **ready**, Part I + II), surface it for the second-pass review and note
   that **applying the `spec approved` label** is the go-ahead to implement. The *other*
   issues keep moving. For any issue **ready to merge**, surface it and stop there (merge
   is the user's).
6. **End the turn.** Subscribe to **all live PRs — spec, impl, and the epic PR (when
   active)** (`subscribe_pr_activity`): a spec PR's review activity during Case/spec review
   must wake the fleet, not wait for the heartbeat, and epic PR activity must too (so
   feedback can fan down and the `epic approved` label is caught). Two spec-PR transitions are also waking signals: a **draft→ready-for-review
   promotion** (advances Case review → Part II build) and the **`spec approved` label**
   (advances → implementation). Since neither a `ready_for_review` nor a `labeled` webhook is
   guaranteed to arrive, the scout's table refresh (step 2) re-reads each open spec PR's
   `draft` flag and labels so both are caught on the next wake. Schedule one fleet check-in
   (`send_later`, ~30–60 min) as the backstop and re-arm while any issue is live. Re-enter
   on PR events or the check-in. Stop the fleet once every issue is merged, closed, or dropped.

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

- **Discover, then create.** List the Linear **project's documents** for an existing
  epic-spec; reuse it if one covers this set. Otherwise dispatch `epic-agent` to author it
  (`epic/<name>` branch + never-merged epic PR + attached project document) and return the
  handles. The fleet holds only handles (epic name, branch, epic PR#), never the spec text.
- **Enforce the objective gate.** Surface the epic-spec's purpose/objective for the
  **`epic approved`** sign-off and hold the epic's issues at NEEDS_SPEC until it lands
  (loop step 3). It's the *only* epic-level gate; direction stays ungated.
- **Own the subscription; fan feedback down.** Route epic PR review/human feedback **down**
  to the aligned issue workers (sub-agents can't subscribe; the fleet does, same as a
  spec-PR event). When an epic comment is **heavy or its fan-out target is unclear** ("which
  issues does this touch?"), offload the *read* to **`scout`** — it returns the target
  issues; you route — rather than pulling the content into the coordinator's context. Then
  re-dispatch `epic-agent` to **fold** the feedback into the epic-spec **and** refresh its
  running index from the PR handles in your table — one update pass, not a separate mode.
- **Wrap.** When the epic finishes, the epic PR closes **unmerged**; the **branch is never
  deleted** and stays discoverable via the project document. Closing needs no sign-off.

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
  starts a *spec*, not unreviewed code. Surface each addition to the user.
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

1. **Dispatch `fsd:cross-spec-review`** over the spec set (it forks into its own sub-agent,
   reads every spec in *its* context, and returns a compact ranked **conflict report** —
   the fleet holds the report, never the spec texts). Read-only.
2. **Walk you through the decisions.** For each conflict the report marks *decision-needed*,
   surface it with the trade-off (`AskUserQuestion`) — the fleet owns all user interaction;
   the review sub-agent never prompts. Conflicts the docs already settle are applied without
   a prompt (noted, not asked).
3. **Route the alignment.** For each spec that must change to land a decision, pick the
   cheaper channel:
   - **Direct** — dispatch that issue's `issue-worker` to update its spec (repo doc +
     Linear in sync, per `fsd:create-spec`) with the agreed change.
   - **PR comment** — when a direct update isn't warranted yet, leave a comment on that
     spec PR describing the required alignment, to be picked up in its review rounds.
4. **Re-review the aligned specs** (an alignment edit is a spec change like any other) and
   keep the **stop-before-implement** gate on every issue. An issue whose spec changed
   returns to spec review before it implements.

Run this once per batch when the set stabilizes; re-run only if a later approved spec joins
the set or an alignment edit could ripple.

## Gates & autonomy

- **Spec-approval gate is per issue.** Each issue independently waits for the user's
  sign-off — the **`spec approved` label** on its spec PR — before implementing;
  approvals are independent, so issue B isn't blocked by issue A's pending spec.
- **Stop before merge**, per issue. The fleet never merges.
- A worker that reports a **blocker** (dependency not landed, ambiguous spec review,
  a challenger-surfaced spec blind spot) surfaces to the user for that issue; the
  rest continue.

## Token & depth discipline

- The fleet's context is the status table + the fleet record. Nothing else persists
  across wakes. Workers are the token sink, and they're isolated and discarded.
- Depth stays within Claude Code's 5-level cap: fleet (main) → worktree worker
  running issue-lifecycle (1) → the phase skill it dispatches, e.g. implement-issue
  (2) → that skill's implementer / `fsd:review` sub-agents (3) → review lenses (4).
  Comfortable. If you ever approach the cap, have the worker run the phase skill
  in-context rather than dispatching a further sub-agent.
- Never read specs/diffs at the fleet level. Handles and status only.

## Boundaries

- Parallel *coordination* of independent issues. Issues with hard dependencies on
  each other should be sequenced (run the blocker to merge-ready first, or use
  `fsd:issue-lifecycle` one at a time) rather than run concurrently.
- Composes `fsd:issue-lifecycle` (one lifecycle definition, reused per issue). It does
  not reimplement the lifecycle.
