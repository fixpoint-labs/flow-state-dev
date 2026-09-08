# FIX-1332 — W2: Workforce foundation L2

*Conventions, seat factory, thin Agent. The direction is locked by
[`docs/atlas/workforce.html`](../../docs/atlas/workforce.html) — §03 build-out, §04 the fence,
§06 file conventions, §08 room helpers, §17 what exists today, §19 L1 gaps — as re-ordered by
[#1655](https://github.com/fixpoint-labs/flow-state-dev/pull/1655). This epic-spec reflects that
lock rather than re-deriving it; where the lock and the code disagree, §5 says so instead of
picking a winner quietly.*

## 1. Purpose & objective *(the gated sign-off surface)*

**Objective.** Make a multi-seat workforce an ordinary FSD application shape. Today an author
who wants three collaborating workers hand-wires every one of them: a `defineFlow` per seat, a
`defineAgent` and a persona per opinionated seat, one `createAgentRegistry` call listing them
all, and their own convention for where any of it lives. There is no file layer on `main` and no
seat concept — `packages/workforce` is a name-a-participant registry (382 lines, eight files)
with one caller, `examples/guides/research-team`. When this epic lands, an author adds a folder
and gets a seat: the tree is scanned into today's registries, each seat resolves to one exact
flow instance carrying its own create-time configuration, and — **where that seat is an
opinionated agent** — the worker it materializes either honours what it declared or refuses
loudly. A thin seat (intake, coordinator) is a `defineFlow` and stops there; being a seat never
requires being an Agent.

**Which objective, and how much of the gap.** [`docs/objectives.md`](../../docs/objectives.md)
**Goal 1 — validate through real usage**, and **Goal 4 — keep the foundation honest**. Goal 1's
gap here is that no real multi-seat application runs on FSD. This epic does not close that gap;
it removes the reason it stays open — the bespoke wiring every such app has to invent first. The
first real application on top of it is the **Lab Proof, which is the next stage after W2, not
part of it** (theme 4).

**Holistic necessity.** Three issues, and the honest question is whether it is two. The
convention loader (FIX-1335) and the seat factory (FIX-1325) are one spine cut at a real seam:
the loader answers *what seats exist*, the factory answers *what one seat resolves to*. They are
two issues because the loader has to land against a settled factory contract, and specifying
them together is how the file shape starts negotiating with the instance API. Materialization
honesty (FIX-1327) is the weakest of the three alone — a backlog bug that predates this epic and
would be fixed eventually anyway. It is **kept, and kept as a bug** (no spec, straight to the
fix), because the factory's entire promise is that a seat runs what it declared, and today
`materializeAgent` **silently skips a string-key capability when no catalog is present**
(`if (!catalog) continue`): a seat declares a capability and runs without it, with no error and
no warning. That is the whole of FIX-1327. **What is *not* the bug:** a worker's `z.string()`
output, which core and `apps/docs` both document as deliberate and which FIX-1327 **preserves**
(theme 3). Narrowed that way the fix reverses no documented contract, which is why it stays on
the direct route; if it ever grows into *changing* that contract it has stopped being this
epic's bug and must be re-routed to a spec
([`orchestration.md`](../../docs/contributing/orchestration.md) → "Which issues get a spec").

**Proof — tiered. The gate bar and the finish line are deliberately not the same.**

| | What has to be true | Why here |
|---|---|---|
| **Gate minimum** | Two seats of **distinct** worker kinds, each with **different create-time config**, hired on the real assembled path — **one hire per kind**, and **at least one of them thin** (flow-only, no `AgentRegistry` entry). Each resolves by its exact instance id and reads its own frozen `ctx.flow.config`. The opinionated-agent seat materializes a worker that honours its declaration or fails naming what it could not honour; the thin seat never touches the Agent layer at all. **Programmatic registration is acceptable at this bar** | This is the claim the objective rests on — a seat is a configured worker and it runs what it says. Distinct kinds because **same-kind multi-hire is not this epic's bar**: the Atlas gives W2 "one hire per kind is enough" and assigns the multi-hire proof to Collab RC. One seat thin because otherwise the epic can pass without ever exercising the thin-seat path (Atlas §04 proof B: one row seats a thin coordinator *and* a thick Agent). No loader required, so the set does not serialize behind FIX-1335 |
| **Epic-complete** | The same proof bootstrapped from **conventional files only** — seat folders on the locked tree produce the seats, with no programmatic registration anywhere in the path. **That is the whole finish line** | Files-only is what proves the *convention*, which is the objective. A green gate minimum with hand-registration proves the factory and says nothing about the file layer |

**Gate-minimum-complete is not epic-complete:** without the files-only bootstrap the convention
itself is unproven, and this epic must not be declared to have served the objective on the first
row alone. **And epic-complete stops there.** The pentest Lab Proof is the *next stage* after
W2, not a criterion of it — theme 4, and the Atlas names nesting it under W2 among the things
that would fake this epic.

**Not doing:** Team, Channel, MessageBoard or Project as Layer 1 types; a second registry; hot
addition of flow kinds after boot; a management bus, a delivery bus, or a second dispatcher; a
second Agent type in the package; member-memory depth; **the Lab Proof itself** (its own stage —
theme 4); the MCP client door (held by #1655 until the package and the lab both exist); ordered
multi-reply and who-may-reply policy (Collab RC).

## 2. Themes & long-horizon direction

*Four decisions that sit above any single issue. Anything that constrains only one child is that
child's spec, not a theme — the loader's scan mechanics belong to FIX-1335, and the factory's API
shape, the helper names and their transport caveats to FIX-1325.*

1. **One file shape, one registry.** The locked shape is `teams/<teamId>/workers/<name>/`
   ([Atlas §06](../../docs/atlas/workforce.html)) — seats nest under the team they seat, with
   **no `agents/` or `personas/` sibling**: FIX-912's older sketch is superseded as a delivery
   stream and no issue in this set may re-open it. The scan feeds **today's** registries and adds
   none. *Why no second registry:* the scan's whole value is that files and hand-written
   definitions produce the same entries, so a second source of truth gives "what seats exist?"
   two answers and turns the TypeScript escape hatch into a fork.

2. **A seat is one exact flow instance carrying its own create-time config** — configuration and
   identity, not a new execution primitive. **No kind-only address for a collection member and no
   first-registered fallback**: that is what makes a seat addressable as itself rather than as
   its kind, and it is the contract FIX-1335 targets and FIX-1327 materializes against. **The
   compile boundary between the two children:** the loader registers kinds — one blueprint per
   seat folder — and the factory mints instances; a seat folder supplies config and a stable id,
   never a new action tree. Harness, model and persona references are instance config when they
   vary without changing the block graph; a difference that changes the action tree is a
   different flow kind, not another config key. How many seats per kind is the gate bar's
   question, not a second decision here.

3. **Don't silently drop what a seat declared — and being a seat never requires being an Agent.**
   Where an *Agent* materialization path cannot honour a declared capability, tool, persona or
   model, it says so and names what it could not honour; it does not fail quietly (BP-030 —
   refuse, don't drop). *Why:* a seat that runs something other than what its files declare makes
   the convention worse than hand-wiring, because the drift is invisible. **Two silent-looking
   behaviours are documented, deliberate contracts and stay out of scope — this theme is not a
   licence to reverse them:** worker `z.string()` output (`packages/core/src/types/agent.ts`:
   *"Honored only for the STANDALONE shape — workers always emit `z.string()`"*, published in
   `apps/docs`), and additive-not-restrictive tool resolution (`resolveCatalogTools` warns and
   drops an unknown key by design, and its own doc names the policy). What remains in scope is
   the **undocumented** silent drop — the capability skip when no catalog is present — which is
   exactly FIX-1327, so this theme's contract is satisfiable by the children the index carries.
   **Scoped to opinionated-agent seats**, per the gate bar's thin-seat row: no issue may route a
   thin seat through the Agent layer to make it a seat. Served by deepening `defineAgent` / `createAgentRegistry` / `materializeAgent` **in
   place**. *Why no second Agent type and no growth of the core type:* skills and orchestration
   materialize against `packages/core/src/types/agent.ts` without importing Workforce, and engine
   has no `AgentRegistry` import — a parallel Worker/Member type, or a `resources` / `memory` /
   `sessions` field on the core type, breaks that seam and folds one product's knowledge into the
   substrate (tenet 4). Demote means do not grow these types; it does not mean delete them.

4. **The fence, with its reasons — and where this epic stops.**
   - **The four thin L2 helpers are IN scope as veneer over *declared* dispatchers** — keyed
     team, intake seat DM, room subscribe, board notify — riding FIX-1325, because each is *seat
     addressing* over the roster row that issue produces. Names come from
     [Atlas §08](../../docs/atlas/workforce.html); FIX-1325's spec takes them from there rather
     than inventing alternatives. **They land with, or just ahead of, their first real caller** —
     four APIs against no consumer is speculative surface — and if the surface grows, FIX-1325
     **phases** it: the factory to the gate minimum, the helpers to epic-complete.
   - **A helper that needs a missing Layer 1 door names the gap; it does not ship a pretend
     argument.** Refuse by name and raise it here; do not route around it locally. *Why:* a
     hidden argument is how a foundation acquires a bus.
   - **No Team / Channel / MessageBoard L1 type**, *because* such a type's only job would be to
     hold the seat→worker→session bind, and that bind is a keyed row — minting a type for it
     makes a second team a new type instead of a new key. **No hot-dynamic kinds after boot**,
     *because* a runtime seat-join API is a second registration path that skips the file, which
     is the convention. **Deferred to Collab RC:** ordered multi-reply, who-may-reply policy,
     real cross-team addresses, multi-hire fan-out.
   - **Sequencing, and the stages after — neither of them a child.** The Layer 1 floor has
     landed, so W2 is the kick. FIX-1327 is independent and may land first; FIX-1325 settles the
     seat contract; FIX-1335 lands against it. **Then, in order:** the **Lab Proof** — a thin
     pentest team (intake · recon · triage) on the file conventions alone, its own stage at
     *"proposed · after W2"* — then **W1 MCP (FIX-1333)**, held by #1655 until the package and
     the lab both exist, then Collab RC. The lab is a stage after W2, **not a criterion of it and
     not a child**: the Atlas W2 row names *"Nesting the lab or Collab RC under W2 as extra
     package surface"* among the things that would fake this epic.

## 4. Running index

| Issue | What it owns | Route | Spec PR | Impl PR | State |
|---|---|---|---|---|---|
| [FIX-1335](https://linear.app/fixpoint-labs/issue/FIX-1335) | Convention loader: scan `teams/<id>/workers/<name>/` into today's workforce registries | spec | — | — | Backlog |
| [FIX-1325](https://linear.app/fixpoint-labs/issue/FIX-1325) | The seat factory — INST-5 hire/mint as collection kinds; a seat binds one exact flow-instance id + immutable create-time config. Carries the four thin helpers (theme 4) | spec | — | — | Backlog |
| [FIX-1327](https://linear.app/fixpoint-labs/issue/FIX-1327) | Materialization honesty, **narrowed**: the silent capability skip when no catalog is present — **honour or loudly refuse**. The documented worker `z.string()` contract is preserved, not reversed (theme 3) | **bug** | — | — | Backlog |

*A bug carries no spec PR and no spec-approval gate by design — it routes straight to the fix,
with its PR as the review surface
([`orchestration.md`](../../docs/contributing/orchestration.md) → "Which issues get a spec"). The
empty Spec PR cell on the FIX-1327 row is correct, not a gap; as narrowed it reverses no
documented contract, which is what keeps it on the direct route.*

**Related, deliberately not children.**

| Issue | Why it is not a child |
|---|---|
| [FIX-1310](https://linear.app/fixpoint-labs/issue/FIX-1310) — Teams roster | The later **Team-level consumer** of this convention. Folding it in would make this epic ship a partial Team under a foundation label |
| [FIX-912](https://linear.app/fixpoint-labs/issue/FIX-912) — Layer 2 delivery model | The older charter that named this work. **Superseded as a delivery stream** by FIX-1335; kept for provenance. Its `agents/` + `personas/` sketch does not survive theme 1 |
| [FIX-1311](https://linear.app/fixpoint-labs/issue/FIX-1311) — Message board | Layer 2 assembly over collections, subscriptions and `reactTo`. Board *addressing* is Collab RC's question, not the seat spine's |
| [FIX-1333](https://linear.app/fixpoint-labs/issue/FIX-1333) — W1 Workforce MCP | A **sibling epic**, held by #1655 until this package and the Lab Proof both exist. Sequencing note only — its Linear "unblocked now" is stale against that hold |
| [FIX-1320](https://linear.app/fixpoint-labs/issue/FIX-1320) · [FIX-1331](https://linear.app/fixpoint-labs/issue/FIX-1331) | **Satisfied prerequisites**, not work. The instances floor and the create-time config bag are on `main`; W2 is unblocked because of them |

## 5. Open cross-cutting questions

**Genuinely open.** None today.

**Closed — recorded with where the answer lives, so nobody re-opens them.**

- **Who owns the Lab Proof?** *Dissolved, round 3:* nobody in this epic, because it is not this
  epic's to own. The Atlas W2 row names *"Nesting the lab or Collab RC under W2 as extra package
  surface"* among the things that would fake W2, and the Lab Proof is its own row at *"proposed ·
  after W2."* W2 completes on the gate minimum plus the files-only bootstrap; the lab is the next
  stage (theme 4). An earlier draft of this document made it an epic-complete criterion and
  raised a fourth-child routing question — both are withdrawn.
- **Does the worker path *support* declared structured output, or *refuse* it?** *Dissolved,
  round 3:* neither — it **preserves** `z.string()`, which `packages/core/src/types/agent.ts` and
  `apps/docs` both document as deliberate. FIX-1327 is narrowed to the undocumented silent
  capability skip (theme 3, §1), and so reverses no contract and stays on the direct route.
- **Do the four thin helpers ride FIX-1325, or earn their own issue?** *Settled per theme 4:*
  they ride FIX-1325. Reopen only if FIX-1325's spec finds the helper surface larger than the
  factory it wraps — and the answer then is to phase them, not to split the issue.
- **FIX-1310 stays related, not a child** — §4's related table.
- **One hire per kind; the gate is two distinct kinds, differently configured** — §1's gate table.
- **The honesty contract is scoped to opinionated-agent seats; a thin seat stops at `defineFlow`**
  — theme 3, exercised by §1's gate table.
- **The proof is tiered, and programmatic registration satisfies the gate** — §1. Requiring
  files-only at the gate would serialize the whole epic behind FIX-1335 for no product gain.

---

*Footnote — Atlas-vs-code drift, flagged for the Atlas owner, not a cross-cutting question for
this epic. The Atlas is pinned at `15c814251`, where §03 tags FIX-1331 "about to land · not
exists" and §19 gap 1 says `get(kind)` still falls to the first registered instance. Neither
holds on `main` today: `configSchema` / `config` and `ctx.flow.config` exist in
`packages/core/src/flow/defineFlow.ts`, and the registry resolves by global id with no kind
fallback. The direction is unaffected — both make W2 more buildable — but the pin needs a refresh
so a later reader does not treat those rows as live holds.*

## Epic evolution

- **Epic drafted** — reduced Workforce foundation L2 to one convention-to-registry path, one
  seat-to-flow-instance factory, and honest Agent materialization; Team, MessageBoard, chat and
  collaboration stay outside the set.
- **After round-1 epic review (#1657)** — named the locked `teams/<id>/workers/<name>/` path so
  FIX-912's `agents/` sketch could not win by default; made FIX-1310 related-only with FIX-1335
  as the loader child; put the four Atlas-named helpers in scope, riding FIX-1325; separated the
  gate bar from the finish line.
- **After the coordinator steer and Codex's findings (#1657)** — tiered the proof so programmatic
  registration satisfies the gate, because the original bar serialized the set behind FIX-1335
  for no product gain; collapsed §2 from seven themes to four; scoped the honesty contract to
  opinionated-agent seats and required one thin seat at the gate, because requiring every seat to
  be an Agent contradicts the lock; corrected the gate to two *distinct* kinds, since same-kind
  multi-hire is Collab RC's proof.
- **Moved to `epic/workforce-foundation-l2` (PR #1664)** — `Process guards` exempts `spec/`
  content only on a `spec/*` or `epic/*` branch. Same content; #1657 closed unmerged.
- **After round-2 epic review (#1664)** — trimmed §2 and §5 to coordination altitude, pushing
  per-child constraints, helper names and the transport caveat to FIX-1325's spec; closed the
  helpers-routing question and required helpers to land with their first real caller, phased if
  the surface grows.
- **After round-3 epic review (#1664)** — **removed the Lab Proof from the finish line**: the
  Atlas names nesting it under W2 as a way to fake this epic and gives it its own "after W2"
  stage, so epic-complete is the files-only bootstrap and the lab is the next stage, not a
  criterion or a child. **Narrowed FIX-1327 and theme 3** to the *undocumented* silent drop,
  because worker `z.string()` and additive-not-restrictive tool resolution are documented
  contracts — as written the theme promised a refusal no child could deliver, and reversing
  `z.string()` would have made the bug a contract change needing a spec.
