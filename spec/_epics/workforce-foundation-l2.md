# FIX-1332 — W2: Workforce foundation L2

*Conventions, seat factory, thin Agent. The direction is locked by
[`docs/atlas/workforce.html`](../../docs/atlas/workforce.html) (§03 build-out, §04 the fence,
§06 file conventions, §17 what exists today, §19 L1 gaps) as re-ordered by
[#1655](https://github.com/fixpoint-labs/flow-state-dev/pull/1655). This epic-spec reflects
that lock; where it and the code disagree, §5 says so rather than picking a winner quietly.*

## 1. Purpose & objective *(the gated sign-off surface)*

**Objective.** Make a multi-seat workforce an ordinary FSD application shape. Today an author
who wants three collaborating workers hand-wires every one of them: a `defineFlow` per seat, a
`defineAgent` and a persona per opinionated seat, a `createAgentRegistry` call listing them
all, and their own convention for where any of it lives. There is no file layer on main and no
seat concept — `packages/workforce` is a name-a-participant registry (382 lines across eight
files) with exactly one caller, `examples/guides/research-team`. When this epic lands, an
author adds a folder and gets a seat: the tree is scanned into today's registries, each seat
resolves to one exact flow instance carrying its own create-time configuration, and the worker
it materializes either honours what it declared or refuses loudly.

**Which objective, and how much of the gap.** [`docs/objectives.md`](../../docs/objectives.md)
**Goal 1 — validate through real usage**, and **Goal 4 — keep the foundation honest**. Goal 1's
gap here is that no real multi-seat application exists on FSD; this epic does not close that
gap, it *removes the reason it is open* — the bespoke wiring every such app currently has to
invent. The closing move is the Lab Proof below, and it is deliberately not in this set.

**Holistic necessity.** Three issues, and the honest question is whether it is two. The
convention loader (FIX-1335) and the seat factory (FIX-1325) are one spine cut in half at a
real seam: the loader answers *what seats exist*, the factory answers *what one seat resolves
to*. They could be one issue; they are two because the loader has to land against a stable
factory contract and specifying them together is how the file shape starts negotiating with
the instance API. Materialization honesty (FIX-1327) is the weakest of the three on its own —
it is a backlog bug that predates this epic and would eventually be fixed anyway. It is
**kept, and kept as a bug** (no spec, straight to the fix), because the factory's whole promise
is that a seat runs what it declared, and today `materializeAgent` forces `z.string()` over a
declared `outputSchema` on the worker path and drops string-key capabilities silently when no
catalog is present. Shipping the factory on top of that ships the promise and not the
behaviour. If FIX-1327 grows past a refusal into supporting structured-output workers, that is
the signal it stopped being this epic's bug (see §5).

**Proof — two proofs, one gate, and they are not the same finish line.**

1. **Spine proof (this epic's completion criterion).** A fixture workforce made only of
   conventional files under `teams/<id>/workers/<name>/` is scanned, and from *one* collection
   flow definition at least two differently-configured seats are minted. Each resolves by its
   exact instance id — not by kind — reads its own frozen `ctx.flow.config`, and materializes a
   worker whose supported Agent contract matches what it declared, or fails with an error
   naming what it could not honour. The check exercises the assembled path, not the loader,
   registry and factory separately.
2. **Lab Proof (the objective's proof, and the next epic — not this one).** The thin pentest
   team from the same lock: intake, recon and triage seats on that tree; projects as boards and
   resources, not a `Project` type; a finding or asset write becoming a task and a dispatch to
   the next seat, as package-surface proof only. It must run on file conventions alone — that
   is what proves the package. It stops before OnSecurity, before MCP, and before a fourth seat.

**Spine-complete is not Lab-Proof-complete.** Signing off this objective commits us to the lab
happening; it does not commit us to it happening here, and this epic must not be declared to
have served the objective when only proof 1 is green. That is the failure this line exists to
prevent.

**Not doing:** Team, Channel, MessageBoard or Project as Layer 1 types; a second registry; hot
addition of flow kinds after boot; a management bus, a delivery bus, or a second dispatcher; a
second Agent type in the package; member-memory depth; the MCP client door (held by #1655 until
the package and the lab exist); ordered multi-reply and who-may-reply policy (Collab RC).

## 2. Themes & long-horizon direction

1. **The locked file shape is `teams/<teamId>/workers/<name>/`, and it is decided, not
   proposed.** Team folders are `teams/`. Seats nest under the team they seat, one folder per
   seat, carrying `role.md`, `personality.md`, `tools.md`, and optional `skills/` and
   `resources/`. There is **no `agents/` or `personas/` sibling** — FIX-912's older sketch is
   superseded as a delivery stream, and no issue in this set may re-open it. There is no
   `projects/` tree (projects are resources and boards) and no `sops/` yet. Cited by FIX-1335
   and FIX-1325 as given.

2. **Files populate today's registries; they do not create a parallel runtime.** The scan calls
   `defineFlow` for every seat and adds a `createAgentRegistry` entry **only** when that seat is
   an opinionated agent — thin seats (intake, coordinator) skip the registry and member memory
   entirely. A hand-written `defineFlow` that keeps the worker contract is still a seat. *Why
   no second registry:* the scan's entire value is that files and hand-written definitions
   produce the same entries; a second source of truth gives "what seats exist?" two answers and
   turns the TypeScript escape hatch into a fork.

3. **A seat binds a worker by exact flow-instance id.** A seat is configuration and identity,
   not a new execution primitive: the factory resolves one already-defined collection flow,
   mints an instance under the seat's stable id with an immutable create-time config bag, and
   registers it through the canonical flow registry. There is **no kind-only address** for a
   collection member and no first-registered fallback — `flow-registry.ts` `get(address)` is
   `flowsById.get(address)` on main, and `resolveInstanceId` refuses a collection mint with no
   explicit id. Harness, model and persona references are instance config when they vary
   without changing the block graph; a difference that changes the action tree is a different
   flow kind, not another config key.

4. **Agent stays a thin declaration on the existing seam.** This epic deepens `defineAgent` /
   `createAgentRegistry` / `materializeAgent` in place. Every materialization path either
   honours the declared structured output, tools, capabilities, persona and model, or **refuses
   the unsupported combination with an error the author can act on** (BP-030 — refuse, don't
   quietly drop). *Why no second Agent type and no growth of the core type:* skills and
   orchestration type `agent-ref` and materialize against `packages/core/src/types/agent.ts`
   without importing Workforce, and engine has no `AgentRegistry` import. A parallel Worker or
   Member type, or a `resources`/`memory`/`sessions` field on the core type, breaks that seam
   and folds one product's knowledge into the substrate (tenet 4). Demote means do not grow
   these types — it does not mean delete them.

5. **The thin L2 helpers are in scope as veneer, and they ride the seat factory.** Four names,
   already on the Atlas, and no others: `openDm({ team, seat, … })`, `openTeamInbox({ team })`,
   `openProjectRoom({ room, subscribers })`, `fanOutBoardPost({ subscriberSessionIds, … })`.
   Each is a thin wrapper over a Layer 1 call that already exists (`createSession`,
   `dispatcher({ session })`, `dispatcher({ flowKind })`), each takes a **team key** so a second
   team is another key rather than a new argument, and none is a second session or board model.
   They belong to FIX-1325 rather than to a fourth issue because all four are *seat addressing*
   — they take `{ team, seat }` and need the roster row the factory produces (see §5, open).
   **Deferred to Collab RC, explicitly:** `fileOrderedReplies`, ordered multi-reply,
   who-may-reply policy, real cross-team addresses, and multi-hire fan-out. Do **not** invent
   `subscribeRoom`, `notifyBoard`, `fanOutAcrossTeams`, or `loadWorkforce()`.

6. **A helper that needs a missing Layer 1 door names the gap; it does not ship a pretend
   argument.** The one this set will actually hit: existing-session delivery by `{ id }` past an
   external queue refuses by name in `create-request-host.ts`, so `openDm`'s wake and
   `fanOutBoardPost` refuse on BullMQ. The helper must **surface** that, not silently retry as
   `{ key }`. Any other missing door found by an issue in this set is raised here, not routed
   around locally.

7. **Sequencing, and where this epic stops.** The Layer 1 floor has landed — cardinality
   (`singleton | collection`), address-by-global-id, and the create-time config bag reaching
   `ctx.flow.config` are all on `main` (FIX-1331 Done; FIX-1320's INST work merged). W2 is
   unblocked and is the kick. Within the set: FIX-1327 is independent and can land first;
   FIX-1325 defines the seat contract; FIX-1335 lands against that contract. **After this
   epic:** the Lab Proof, then W1 MCP (FIX-1333) which #1655 holds until the package and the lab
   both exist, then Collab RC. W1 is **not** the next child of this epic, and its Linear
   "unblocked now" reads stale against that re-order.

## 4. Running index

| Issue | What it owns | Route | Spec PR | Impl PR | State |
|---|---|---|---|---|---|
| [FIX-1335](https://linear.app/fixpoint-labs/issue/FIX-1335) | Convention loader: scan `teams/<id>/workers/<name>/` into today's workforce registries | spec | — | — | Backlog |
| [FIX-1325](https://linear.app/fixpoint-labs/issue/FIX-1325) | The seat factory — INST-5 hire/mint as collection kinds; a seat binds one exact flow-instance id + immutable create-time config. Carries the four thin helpers (theme 5) | spec | — | — | Backlog |
| [FIX-1327](https://linear.app/fixpoint-labs/issue/FIX-1327) | Materialization honesty — `materializeAgent` must honour or loudly refuse a worker's declared structured output and capabilities | **bug** | — | — | Backlog |

*A bug carries no spec PR and no spec-approval gate by design — it routes straight to the fix,
with its PR as the review surface
([`orchestration.md`](../../docs/contributing/orchestration.md) → "Which issues get a spec"). The
empty Spec PR cell on the FIX-1327 row is correct, not a gap.*

**Related, deliberately not children.** Each is a real dependency or a real neighbour; none is
work this epic owns.

| Issue | Why it is not a child |
|---|---|
| [FIX-1310](https://linear.app/fixpoint-labs/issue/FIX-1310) — Teams roster | The later **Team-level consumer** of this convention. It describes roster scoping for agents and boards on top of the file shape W2 locks; folding it in would make this epic ship a partial Team under a foundation label |
| [FIX-912](https://linear.app/fixpoint-labs/issue/FIX-912) — Layer 2 delivery model | The older charter that named this work. **Superseded as a delivery stream** by FIX-1335; kept for provenance. Its `agents/` + `personas/` file sketch does not survive theme 1 |
| [FIX-1311](https://linear.app/fixpoint-labs/issue/FIX-1311) — Message board | Layer 2 assembly over collections + subscriptions + `reactTo`. Board *addressing* is Collab RC's question, not the seat spine's |
| [FIX-1333](https://linear.app/fixpoint-labs/issue/FIX-1333) — W1 Workforce MCP | A **sibling epic**, held by #1655 until this package and the Lab Proof both exist. Sequencing note only — its Linear "unblocked now" is stale against that hold |
| [FIX-1320](https://linear.app/fixpoint-labs/issue/FIX-1320) · [FIX-1331](https://linear.app/fixpoint-labs/issue/FIX-1331) | **Satisfied prerequisites**, not work. The instances floor and the create-time config bag are on `main`; W2 is unblocked because of them |

## 5. Open cross-cutting questions

- **Do the four thin helpers ride FIX-1325, or earn a fourth issue?** Raised by this deepening
  pass. #1655's W2 card lists them inside the package; this epic's child set has no separate
  owner for them. **Recommendation: they ride FIX-1325**, because every one of the four is seat
  addressing over the roster row that issue produces, and a fourth issue would spec the same
  contract twice. What would change it: FIX-1325's own spec finding the helper surface is
  larger than the factory it wraps. Blocks nothing — both issues can be specced against theme 5
  as written. *Not an owner-level ask; the coordinator can settle it when FIX-1325 is specced.*

- **Does the worker path *support* declared structured output, or *refuse* it?** Raised here
  because FIX-1327 is a bug with no spec, so this is the only place the decision can be
  recorded before it is made in code. `materializeAgent` today forces `outputSchema` to
  `z.string()` on the worker shape, with the stated reason that the skills pattern machinery
  builds follow-on actions from text. Supporting structured workers therefore changes the
  skills adapter in `packages/orchestration`, not just this package. **Recommendation: refuse
  loudly, don't support** — a clear error naming the unsupported combination satisfies theme 4
  and BP-030; making it *work* is a separate, cross-package feature and is not this epic's
  spine. Blocks nothing; FIX-1327 proceeds on "refuse" and comments up if the refusal proves
  unusable.

- **~~Should FIX-1310 be narrowed into this epic, or stay related?~~** *Resolved:* stay
  related. FIX-1335 is the focused convention-loader child; FIX-1310 remains the later
  Team-level consumer. Raised by the epic-spec draft, settled by the coordinator on the round-1
  review. §4 and this section now tell one story — the earlier draft had it as both a child and
  a non-child.

- **~~Does W2 mint one instance per kind, or per seat?~~** *Resolved:* **per seat.** The Atlas
  teaches "one hire per kind is enough for the lab", which was written when the instances floor
  had not landed and reads as a *floor for the lab*, not a ceiling for the package. The spine
  proof (two differently-configured seats from one collection definition) is inherently
  multi-instance, and it is exactly what FIX-1325 exists to deliver. Recorded so a sibling issue
  does not re-open it from the Atlas text.

- **Atlas-vs-code discrepancy, recorded not papered over.** The Atlas is pinned at
  `15c814251` and, on that pin, §03 tags FIX-1331 "about to land · not exists" and §19 gap 1
  says `flow-registry.ts get(kind) still falls to the first registered instance / INST-1..3
  todo, not started`. Neither is true of `main` today: `configSchema` / `config` and
  `ctx.flow.config` exist in `packages/core/src/flow/defineFlow.ts`, and the registry's
  `get(address)` resolves by global id with no kind fallback. The direction is unaffected —
  both changes make W2 *more* buildable, not less — but the Atlas pin needs a refresh so a
  later reader does not treat those rows as live holds. Not this epic's edit; flagged for the
  Atlas owner.

## Epic evolution

- **Epic drafted** — reduced Workforce foundation L2 to one convention-to-registry path, one
  seat-to-flow-instance factory, and honest Agent materialization; kept Team, MessageBoard,
  chat and collaboration outside the set.
- **After round-1 epic review (Architect, #1657)** — folded five findings. FIX-1310 is now
  related-only and FIX-1335 is the loader child, in one voice across §4 and §5, because the
  draft left both stories live. Named the locked `teams/<id>/workers/<name>/` path in theme 1
  and the index so FIX-912's `agents/` sketch cannot quietly win. Split §1's proof into the
  spine proof and the Lab Proof, and said plainly that spine-complete is not Lab-Proof-complete,
  because approving the objective against the spine alone would let this epic wrap with the
  product proof unbuilt. Resolved the helper fence: the four Atlas-named helpers are in-scope
  veneer riding FIX-1325, `fileOrderedReplies` and ordered multi-reply are deferred to Collab
  RC. Added theme 7's sequencing note so nothing reads as if W1 MCP is the next child.
- **Same pass, deepening** — grounded every current-behaviour claim in `packages/workforce`
  and `packages/core` rather than in the Atlas; gave the invent kill its reasons instead of a
  bare list (themes 2, 4, 5); added theme 6, because the `{ id }`-past-a-queue refuse is a door
  both the loader's seats and the helpers will hit and neither issue can decide alone; named
  which objective in `docs/objectives.md` this serves and how much of its gap it closes; and
  recorded the Atlas-vs-code pin drift in §5 rather than restating stale holds as live.
