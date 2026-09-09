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
and gets a seat: each seat's `WORKER.md` scans into a neutral manifest, each manifest resolves to one
exact flow instance carrying its own create-time configuration, and — **where that seat is an
opinionated agent** — the block it resolves to either honours what it declared or refuses
loudly. Every seat is a `defineFlow` instance; a thin seat (intake, coordinator) stops there,
being a seat never requires being an Agent, and **no registry — new or existing — sits in the
resolve path** (theme 2).

**Which objective, and how much of the gap.** [`docs/objectives.md`](../../docs/objectives.md)
**Goal 1 — validate through real usage**, and **Goal 4 — keep the foundation honest**. Goal 1's
gap here is that no real multi-seat application runs on FSD. This epic does not close that gap;
it removes the reason it stays open — the bespoke wiring every such app has to invent first. The
first real application on top of it is the **Lab Proof, which is the next stage after W2, not
part of it** (theme 4).

**Holistic necessity.** Four issues, cut at two real seams. **The spine:** the loader (FIX-1335)
answers *what seats exist* — files to neutral per-worker manifests; the factory (FIX-1325)
answers *what one seat resolves to* — a flow per seat, and nothing beside it (theme 2). Two issues because those are two jobs, not because one has to land
first: a walker producing neutral manifests depends on no seat contract at all (theme 4).

**The honesty half straddles the spec line, so it is also two.** FIX-1327 is the *undocumented*
drop — `materializeAgent` **silently skips a string-key capability when no catalog is present**
(`if (!catalog) continue`): a seat declares a capability and runs without it, no error, no
warning. Nothing documents that, so it stays a bug — no spec, straight to the fix. FIX-1337 is
the *documented* one: a delegated agent drops a declared `outputSchema` and returns prose, which
`packages/core/src/types/agent.ts` and `apps/docs` both publish as deliberate. Reversing a
published contract takes the spec route, and that spec owns the migration path. **This is the
FIX-1327 tripwire firing as designed** — this document warned that if the bug ever grew into
*changing* the worker output contract it had to be re-routed to a spec
([`orchestration.md`](../../docs/contributing/orchestration.md) → "Which issues get a spec"). It
did; FIX-1337 is the re-route, and FIX-1327 stays narrow.

**Proof — tiered. The gate bar and the finish line are deliberately not the same.**

| | What has to be true | Why here |
|---|---|---|
| **Gate minimum** | Two seats of **distinct** worker kinds, each with **different create-time config**, hired on the real assembled path — **one hire per kind**, and **at least one of them thin** — a plain `defineFlow` worker that never goes through `defineAgent`. Each resolves by its exact instance id and reads its own frozen `ctx.flow.config`. The opinionated-agent seat resolves to a block that honours its declaration or fails naming what it could not honour; the thin seat never goes through `defineAgent` at all. **Programmatic registration is acceptable at this bar** | This is the claim the objective rests on — a seat is a configured worker and it runs what it says. Distinct kinds because **same-kind multi-hire is not this epic's bar**: the Atlas gives W2 "one hire per kind is enough" and assigns the multi-hire proof to Collab RC. One seat thin because otherwise the epic can pass without ever exercising the thin-seat path (Atlas §04 proof B: one row seats a thin coordinator *and* a thick Agent) — and the **discriminator moved with theme 2**: every seat is a flow instance now, so "no `AgentRegistry` entry" is true of both and proves nothing, which is why the thin row reads *never went through `defineAgent`*. No loader required, so the set does not serialize behind FIX-1335 |
| **Epic-complete** | The same proof bootstrapped from **conventional files only** — seat folders on the locked tree produce the seats, with no programmatic registration anywhere in the path — **and the opinionated seat's declared `outputSchema` survives delegation or fails by name** (FIX-1337). **That is the whole finish line** | Files-only is what proves the *convention*, which is the objective; a green gate minimum with hand-registration proves the factory and says nothing about the file layer. The `outputSchema` clause is here because honesty that covers capabilities but not output shape leaves the same invisible drift one field over |

**Gate-minimum-complete is not epic-complete:** without the files-only bootstrap the convention
itself is unproven. **And epic-complete stops there** — the pentest Lab Proof is the next stage
after W2, not a criterion of it (theme 4).

**Not doing:** Team, Channel, MessageBoard or Project as Layer 1 types; any registry in the seat
resolve path — theme 2 removes the one that exists rather than adding a second; hot
addition of flow kinds after boot; a management bus, a delivery bus, or a second dispatcher; a
second Agent type in the package; member-memory depth; **the Lab Proof itself** (its own stage —
theme 4); **the four thin L2 helpers** (filed against that stage, which is their first real
caller — theme 4); the MCP client door (held by #1655 until the package and the lab both exist); ordered
multi-reply and who-may-reply policy (Collab RC).

## 2. Themes & long-horizon direction

*Four decisions that sit above any single issue. Anything that constrains only one child is that
child's spec, not a theme — the loader's scan mechanics belong to FIX-1335, and the factory's API
shape to FIX-1325. The helper names and their transport caveats belong to whichever issue
eventually carries them, which is no longer a child of this epic (theme 4).*

1. **One file shape, one registry — a seat is declared by one document.** The seat path is
   `teams/<teamId>/workers/<name>/` ([Atlas §06](../../docs/atlas/workforce.html)), seats nesting
   under the team they seat; inside the folder, a seat is declared by **one `WORKER.md`** — or
   **`worker.ts`** where the seat's shape is custom code on the same contract. Two doors, one
   contract, neither privileged, and the Atlas seat row agrees in the singular: *"THE SEAT. ADD A
   FILE TO ADD A SEAT."* **`WORKER.md`, not `AGENT.md`:** seat = roster slot, worker = any flow on
   the one contract (thin intake and coordinator seats included), agent = the opinionated worker
   case. A markdown document has the same breadth as the `.ts` door, so naming it for the narrow
   case would teach that every worker is an agent — the collapse theme 3 exists to prevent.
   FIX-1335 §6 decision 1 locks the name.

   **This supersedes a proposal; it does not conform to a lock — and the difference matters.** The
   Atlas's five per-worker files — `role.md` / `personality.md` / `tools.md` / `skills/` /
   `resources/` (`:845-849`) — carry the tag **`FACTORY INPUTS · PROPOSED`** (`:850`) and are the
   argument names of `createWorkerFlow`, itself marked *"PROPOSED V1 — thin factory helper. Not an
   export on main"* (`:803`). None of it shipped, and the scan that would read it is still a named
   gap (*"NO LOADER ON MAIN"*, `:874`). One document per seat is this epic's call **over** that
   proposal, which is why **the Atlas owes an update** — an action this epic carries, recorded at
   the end of this document, not a flag left for someone to notice.

   **One declaration source, not two** — the scan's whole value is that files and hand-written
   definitions produce the same entries, so a second source of truth gives "what seats exist?"
   two answers and turns the TypeScript escape hatch into a fork. (This was written as "no
   second registry" when a registry was still in the picture; theme 2 removes the first one, so
   the rule is about *declaration sources*, which is what it always meant.) **No `agents/` or `personas/` sibling** either:
   FIX-912's sketch is superseded as a delivery stream and no issue may re-open it.

2. **A seat is one exact flow instance carrying its own create-time config** — configuration and
   identity, not a new execution primitive. **No kind-only address for a collection member and no
   first-registered fallback**: that is what makes a seat addressable as itself rather than as
   its kind, and it is the contract FIX-1325 owns and FIX-1327 / FIX-1337 materialize against.
   **The compile boundary between the two spine children.** The Atlas states its surviving half
   and its superseded half in one breath — *"defineFlow EVERY SEAT · AgentRegistry ONLY IF
   AGENT"* ([Atlas](../../docs/atlas/workforce.html) `:876-877`). The first clause holds; the
   second is struck by the substrate fence below. **FIX-1335 stops at neutral manifests** — no
   flow, no block, no registry construction. **FIX-1325 turns a manifest into a flow per seat,
   full stop**: no conditional registry entry on either side of the seam, and thin seats
   (intake, coordinator) are expressible stopping at `defineFlow`. A seat folder supplies config and a
   stable id, never a new action tree. Harness, model and persona references are instance config when they
   vary without changing the block graph; a difference that changes the action tree is a
   different flow kind, not another config key. How many seats per kind is the gate bar's
   question, not a second decision here.

   **The substrate registers blocks, not Agents — owner-locked, and it is a Layer 1 change.**
   A name resolves to a `BlockDefinition`, and to nothing else. `agentRegistry` /
   `createAgentRegistry` and `agent-ref` **are not a runtime resolve path** — not in this epic
   and not after it. A skills board and a task board assign the same way, name →
   `BlockDefinition`, so the substrate carries one lookup shape instead of two. **`defineAgent`
   is a block factory**: it builds a sequencer or generator configured to act agent-like
   (persona, model, tools, capabilities), and its output is a `BlockDefinition`. A block
   *pattern*, not a registrable species. **`materializeAgent` and `agentBlock` collapse into
   that factory** — aliased, then deleted. *Why:* an Agent catalog standing beside the block
   registry gives "what can this name run?" two answers, and the second answer carries a species
   only one product knows about — the substrate fold tenet 4 refuses.

   **The mechanism is Layer 1, and it lands in `@flow-state-dev/orchestration`.** This is not
   Workforce deciding to stop using a registry; it is the substrate settling how a named worker
   resolves, with Workforce (Layer 2) consuming it like any other caller — the same Layer 1
   floor / Layer 2 product split this epic already rests on, sharpened. Orchestration already
   resolves workers this way (`TaskWorkerRegistry` is `Record<string, BlockDefinition>`, and
   `worker-step` connects those blocks directly), and `materializeAgent` / `agentBlock` already
   return `BlockDefinition`, so the fence **removes the `agent-ref` detour rather than building
   new machinery**. **No child of this epic delivers that mechanism** — theme 4 says when it
   lands and who owns it.

   **And a seat is not a board worker.** Workforce seats stay flow instances — dispatch targets
   — and in-process board workers stay their own list. Same idea, different mechanism; no issue
   may merge the two lists, and none may treat an Agent catalog as the roster.

   **The identity is `team.name`, dot-joined — and a path is not an id.** A seat mints one
   identity string, `engineering.lead`, and that string is what every later reference uses: the
   flow instance id, a board key, a worker key on a task board. **No folder is renamed.** The seat path
   stays `teams/<teamId>/workers/<name>/`, slashes and all, exactly as theme 1 locks it. Only
   the minted string joins with a dot.

   *Why a slash cannot be the joiner:* a slash-joined id **registers, resolves, and is then
   unreachable**. `defineFlow` accepts it, the registry admits and resolves it, and every HTTP
   address for that seat 404s — `packages/engine/src/routes/parseFlowRoute.ts` rejoins the
   incoming segments into one pathname before matching, so an escaped `/` and a real separator
   are the same string by then. It boots clean and breaks the first time anybody talks to the
   worker: invisible drift arriving through the front door, which is the failure shape theme 3
   exists to refuse. Evidence is the run on `spec/FIX-1325`
   (`spec-poc/FIX-1325-seat-addressing/NOTES.md`), corroborated by an independent read of
   `parseFlowRoute` and `defineFlow`'s `resolveInstanceId`.

   **Minted once, by FIX-1335.** The loader joins team and name in one helper; FIX-1325 uses
   `manifest.id` verbatim and remints nothing. A `/`→`.` translation layer at the factory was
   weighed and rejected — it would give every worker two names forever, and every later feature
   would have to know which one it was holding. FIX-1335 §6 decision 2 (rewritten) and
   [#1676](https://github.com/fixpoint-labs/flow-state-dev/pull/1676) decision 1 carry the
   ruling.

   **This supersedes a decision this epic already carried** — the same treatment theme 1 gives
   the `WORKER.md` supersession, and said here rather than edited in quietly. The identity
   entered this epic through FIX-1335's *approved* decision 2 as `engineering/lead`. Only the
   joiner is corrected, on run evidence; the team-qualified half that decision was protecting is
   unchanged.

3. **Don't silently drop what a seat declared — and being a seat never requires being an Agent.**
   Where an *Agent* materialization path cannot honour a declared capability, tool, persona or
   model, it says so and names what it could not honour; it does not fail quietly (BP-030 —
   refuse, don't drop). *Why:* a seat that runs something other than what its files declare makes
   the convention worse than hand-wiring, because the drift is invisible. **One documented
   contract stays out of scope — this theme is not a licence to reverse it:**
   additive-not-restrictive tool resolution
   (`packages/orchestration/src/shared/resolve-catalog-tools.ts` warns and drops an unknown key
   by design, and its own doc names the policy). That is the whole carve-out. **The other
   documented contract — worker `z.string()` — this epic now deliberately changes:** owned by
   **FIX-1337** on the spec route, which decides the migration path for anyone who built on the
   published text-only behaviour. So the theme covers the undocumented drop (the capability skip,
   FIX-1327) *and* one documented one (output shape, FIX-1337), and stays satisfiable by the
   children the index carries.
   **Scoped to opinionated-agent seats**, per the gate bar's thin-seat row: no issue may route a
   thin seat through `defineAgent` to make it a seat.

   **The contract binds to the behaviour, not to the symbol carrying it.** What this theme
   requires is that *a block built from a declaration runs what it declared, or refuses by
   name*. FIX-1327 landed that on `materializeAgent` and FIX-1337 changes the same path; when
   `materializeAgent` collapses into the `defineAgent` factory (theme 2), the contract travels
   with the behaviour. **The collapse must not quietly drop it** — that would be this theme's
   own failure shape, arriving through a refactor.

   **The carve-out survives the fence, because it is a different catalog.**
   Additive-not-restrictive tool resolution lives in
   `packages/orchestration/src/shared/resolve-catalog-tools.ts` and concerns a *tool* catalog,
   not an agent one; theme 2 touches neither it nor its policy.

   **What the fence supersedes here.** An earlier draft justified this theme by *preserving* the
   core `Agent` / `AgentRegistry` seam — "skills and orchestration materialize against
   `packages/core/src/types/agent.ts` without importing Workforce", closing with the Atlas's
   *"demote means do not grow these types; it does not mean delete them"*
   ([Atlas §04](../../docs/atlas/workforce.html) proof C). **The owner's fence goes further:**
   `agentRegistry` / `createAgentRegistry` / `agent-ref` do die as a runtime resolve path, and
   the Atlas line is superseded with them (recorded as an obligation at the end of this
   document). The half that survives is the refusal itself — no parallel Worker/Member type, no
   `resources` / `memory` / `sessions` field folded into a substrate type, no product registry
   taught to engine (tenet 4). There is no second species now precisely because there is no
   first one.

4. **The fence, with its reasons — and where this epic stops.**
   - **The four thin L2 helpers are seat addressing — and they are out of W2.** Keyed team,
     intake seat DM, room subscribe, board notify; names from
     [Atlas §08](../../docs/atlas/workforce.html), not invented. Each is a veneer over a
     *declared* dispatcher riding the roster row FIX-1325 produces, which is why they were
     scoped onto that issue. **The reopen fired, and the answer is to phase them, not to split
     the issue:** nothing in this epic starts a conversation with a worker, so four APIs against
     no consumer is exactly the speculative surface this fence forbids. **FIX-1325 done = the
     seat factory.** The helpers come out of its delivery *and* out of W2's done bar, filed
     against the **lab stage** below — their first real caller. Two of the four also need
     addressing doors that are still named L1 gaps, so building them now means shipping them
     incomplete or inventing an argument to hide the gap, which the next bullet refuses. This is
     the fence applied as written: *a helper lands with, or just ahead of, its first real
     caller.*
   - **A helper that needs a missing Layer 1 door names the gap; it does not ship a pretend
     argument.** Refuse by name and raise it here; do not route around it locally. *Why:* a
     hidden argument is how a foundation acquires a bus.
   - **No Team / Channel / MessageBoard L1 type**, *because* such a type's only job would be to
     hold the seat→worker→session bind, and that bind is a keyed row — minting a type for it
     makes a second team a new type instead of a new key. **No hot-dynamic kinds after boot**,
     *because* a runtime seat-join API is a second registration path that skips the file, which
     is the convention. **Deferred to Collab RC:** ordered multi-reply, who-may-reply policy,
     real cross-team addresses, multi-hire fan-out.
   - **The substrate fence moves as documents now; the code kill is its own issue, after the
     W2 factory lands.** Theme 2 is settled as *direction* from today: no epic-spec, no child
     spec, and no new code may teach `agentRegistry` / `createAgentRegistry` / `agent-ref` as a
     resolve path, or `materializeAgent` as the Workforce spine. **The deletion is not this
     epic's.** Removing the `AgentRegistry` types, cutting the skills injection
     (`materializeWorker`'s `agent-ref` branch and its `agentRegistry` dep) and rewiring
     `examples/guides/research-team` is a **separate Linear issue, filed and taken after
     FIX-1325's seat factory lands** — deliberately after, so the factory is not thrashed
     mid-stream. **That issue is an `@flow-state-dev/orchestration` change, not a Workforce
     cleanup** (theme 2: the mechanism is Layer 1), which is what decides who owns it and what
     it touches. Until it lands the symbols still exist and still compile, and **FIX-1337 ships
     against `materializeAgent` as it stands today**. What the interval forbids is *growth*: no
     new `agentRegistry` call site, no new `agent-ref` consumer, no new path that resolves a
     name through an Agent catalog. **Stopped teaching it is not deleted it** — read the fence
     as a completed removal and you go hunting for symbols that are still on `main`; read the
     survival as a reprieve and you grow the thing being killed.

     **One constraint that issue inherits, because it is invisible from where it will be
     written.** A `cardinality: "collection"` flow has **one block graph shared by every copy**;
     only the config bag differs. `materializeAgent` resolves the model at *definition* time
     (`packages/workforce/src/materialize-agent.ts:59-60`), and tools the same way through
     `resolveCatalogTools` just below — so a collapsed factory that carries that resolution
     across unchanged gives **every copy of a worker kind one shared model, whatever each
     seat's file declared**. That is theme 3's failure shape exactly (declare it, lose it, no
     error) and theme 2's guarantee broken (a seat is one exact instance carrying *its own*
     config). **The collapsed factory must resolve persona, model and tools per copy, from
     `ctx.flow.config`, not at definition time** — the substrate already allows it,
     `ResolvableModel` accepting `(input, ctx) => …`
     (`packages/core/src/blocks/generator.ts:194`). Recorded here as a constraint to inherit,
     not a design: this epic does not write that Layer 1 API. It is written down at this
     altitude because it is discoverable from the Layer 2 side and invisible from the Layer 1
     one — nobody writing an orchestration cleanup has a reason to go looking for it.
   - **Sequencing, and the stages after — neither of them a child.** The Layer 1 floor has
     landed, so W2 is the kick. **FIX-1327 is independent. FIX-1335 and FIX-1325 may land in
     either order, or in parallel** — a manifest walker commits to nothing about seats, so the
     "loader must land against a settled factory contract" hazard is dissolved, and parallel
     reaches the files-only bar earlier. FIX-1337 follows FIX-1327 on the same materialization
     path and gates on its own spec. **Then, in order:** the **Lab Proof** — a thin
     pentest team (intake · recon · triage) on the file conventions alone, its own stage at
     *"proposed · after W2"*, and where the four helpers are now filed — then
     **W1 MCP (FIX-1333)**, held by #1655 until the package and
     the lab both exist, then Collab RC. The lab is a stage after W2, **not a criterion of it and
     not a child**: the Atlas W2 row names *"Nesting the lab or Collab RC under W2 as extra
     package surface"* among the things that would fake this epic.

## 4. Running index

| Issue | What it owns | Route | Spec PR | Impl PR | State |
|---|---|---|---|---|---|
| [FIX-1335](https://linear.app/fixpoint-labs/issue/FIX-1335) | Convention loader: scan `teams/<id>/workers/<name>/`, reading each seat's one `WORKER.md` (or `worker.ts`) into a **neutral per-worker manifest** — no `Agent`, no flow, no registry construction. **Mints each worker's identity, `team.name`, once** (themes 1–2). Manifest record is `{ id, declared, body, codePath? }` | spec | [#1665](https://github.com/fixpoint-labs/flow-state-dev/pull/1665) | — | Spec Approved |
| [FIX-1325](https://linear.app/fixpoint-labs/issue/FIX-1325) | The seat factory — a manifest becomes **one flow per seat, full stop**; INST-5 hire/mint as collection kinds, binding one exact flow-instance id + immutable create-time config. Uses `manifest.id` verbatim; remints no identity. **The four thin helpers are not in this issue** (theme 4) | spec | [#1676](https://github.com/fixpoint-labs/flow-state-dev/pull/1676) | — | In Spec Review — **being rewritten to theme 2's fence** (no conditional registry entry) |
| [FIX-1327](https://linear.app/fixpoint-labs/issue/FIX-1327) | Materialization honesty, **undocumented half**: the silent capability skip when no catalog is present — **honour or loudly refuse** | **bug** | — | [#1666](https://github.com/fixpoint-labs/flow-state-dev/pull/1666) (merged) | Done |
| [FIX-1337](https://linear.app/fixpoint-labs/issue/FIX-1337) | Materialization honesty, **documented half** and the other side of FIX-1327: a delegated agent drops a declared `outputSchema` and returns prose. Reverses a published contract, so it takes the spec route and its spec owns the migration path (theme 3). **The owner answered its contract question: both changes flip outright** — a delegated agent honours its declared shape, and a transform-bearing shape is refused uniformly — **with no deprecation cycle**. Ships against `materializeAgent` as it stands (theme 4) | spec | [#1674](https://github.com/fixpoint-labs/flow-state-dev/pull/1674) | — | In Spec Review |

*A bug carries no spec PR and no spec-approval gate by design — it routes straight to the fix,
with its PR as the review surface
([`orchestration.md`](../../docs/contributing/orchestration.md) → "Which issues get a spec"). The
empty Spec PR cell on the FIX-1327 row is correct, not a gap; as narrowed it reverses no
documented contract, which is what keeps it on the direct route. The documented contract it
excludes is FIX-1337's, which is exactly why that row is on the spec route instead.*

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

- **Who owns the Lab Proof?** *Dissolved, round 3:* nobody in this epic — the Atlas gives it its
  own *"proposed · after W2"* row and names nesting it under W2 as a way to fake W2 (theme 4). An
  earlier draft made it an epic-complete criterion; withdrawn.
- **Does the worker path *support* declared structured output, or *refuse* it?** *Reopened and
  owned, round 4:* the owner decided to change it. FIX-1327 stays narrowed to the undocumented
  capability skip and stays a bug; the documented `z.string()` contract is **FIX-1337's** to
  change, on the spec route, migration path included (theme 3, §1). Not open here — open in that
  spec.
- **Must the loader land against a settled factory contract?** *Dissolved, round 4:* no. A walker
  producing neutral manifests depends on no seat contract, so the two may land in parallel (theme
  4). The seam survives; only the ordering it implied is gone.
- **Do the four thin helpers ride FIX-1325, or earn their own issue?** *Reopened and phased,
  round 5:* neither. The reopen condition this line set fired on FIX-1325's spec, and the answer
  it named — phase, don't split — is the one taken. FIX-1325's done bar is the seat factory; the
  helpers leave W2's done bar entirely and are filed against the lab stage, their first real
  caller (theme 4). Ratified on
  [#1676](https://github.com/fixpoint-labs/flow-state-dev/pull/1676) decision 5. Not open here —
  open at that stage.
- **What joins a worker's team and name?** *Corrected on run evidence, round 5:* a dot —
  `engineering.lead`. A slash-joined id registers, resolves, and is then unreachable over HTTP
  (theme 2). The disk path is untouched, because a path is not an id. Minted once by FIX-1335,
  with no translation layer. Not open.
- **What does a seat's name resolve to?** *Owner-locked, round 6:* a `BlockDefinition`, and
  nothing else. `agentRegistry` / `createAgentRegistry` / `agent-ref` are not a resolve path;
  `defineAgent` is a block factory whose output is a `BlockDefinition`; `materializeAgent` and
  `agentBlock` collapse into it. The mechanism is **Layer 1, in
  `@flow-state-dev/orchestration`** (theme 2), and the code kill is a separate issue after
  FIX-1325 lands (theme 4). Settled in session — not open, and not to be re-argued on a child
  spec.
- **Settled where they are written, not re-argued here:** FIX-1310 stays related, not a child
  (§4); one hire per kind, two *distinct* kinds at the gate (§1); the honesty contract is scoped
  to opinionated-agent seats, and **every** seat stops at `defineFlow` while only an
  opinionated one goes through `defineAgent` (themes 2–3); the proof is tiered
  and programmatic registration satisfies the gate (§1) — requiring files-only there would
  serialize the epic behind FIX-1335 for no product gain.

---

## Atlas obligations

**An action this epic owes, not a footnote.** Three Atlas surfaces are superseded by decisions
this epic carries. All must be **marked superseded — not deleted** — in
`docs/atlas/workforce.html` **before this epic wraps**. The Atlas is the direction artifact for
this work, so leaving it proposing shapes we have decided against is the same drift we flag it
for below, and worse: a later reader takes the proposal for the lock, exactly as an earlier
revision of this document did. Marking rather than deleting keeps the decision legible.

| Atlas | What it proposes | Superseded by |
|---|---|---|
| **§06** file conventions | The five per-worker files — `role.md` · `personality.md` · `tools.md` · `skills/` · `resources/` (`:845-849`), tagged `FACTORY INPUTS · PROPOSED` | **Theme 1** — one `WORKER.md` (or `worker.ts`) per seat |
| **§05** the worker contract | The `createWorkerFlow({ name, role, personality, tools, skills })` sketch (`:803-820`), itself marked *"PROPOSED V1 — thin factory helper. Not an export on main"* | **FIX-1325 decision 2** — a seat folder says *which* flow and *how it is configured*; it never describes what the flow does. Role, personality, tools and skills are not factory arguments |
| **§04** the fence (proof C, `:552` · `:565` · `:671`), **§05**'s `createAgentRegistry([engMgr])` sketch (`:790-801`), **§06**'s *"AgentRegistry ONLY IF AGENT"* (`:876-877`, figcaption `:886`), and **§17**'s rows for the thin core types and `defineAgent` / registry impl | `agentRegistry` / `createAgentRegistry` / `materializeAgent` / `agent-ref` as the Workforce runtime spine and the way a named worker resolves — closing with *"demote means do not grow these types; it does not mean delete them"* | **Theme 2** — the substrate registers blocks, not Agents. Wrong on two counts: the mechanism is replaced, **and it was never Workforce's to own** — it is Layer 1, in `@flow-state-dev/orchestration` |

The first two are one supersession seen twice: §06 is those five inputs on disk, §05 is the same
five as a function's parameter list. **The third is different in kind and needs saying plainly:**
it is not a proposal the epic outgrew but a *fence the Atlas states as settled*, and this epic
now contradicts it outright. Leaving it standing is worse than leaving a stale sketch — a reader
weighing the two would reasonably take the Atlas's fence over an epic-spec's theme.

*And a flag, for the Atlas owner — not a cross-cutting question for this epic. The Atlas is
pinned at `15c814251`, where §03 tags FIX-1331 "about to land · not exists" and §19 gap 1 says
`get(kind)` still falls to the first registered instance. Neither holds on `main` today:
`configSchema` / `config` and `ctx.flow.config` exist in `packages/core/src/flow/defineFlow.ts`,
and the registry resolves by global id with no kind fallback. The direction is unaffected — both
make W2 more buildable — but the pin needs a refresh so a later reader does not treat those rows
as live holds.*

## Epic evolution

- **Epic drafted** — reduced Workforce foundation L2 to one convention-to-registry path, one
  seat-to-flow-instance factory, and honest Agent materialization; Team, MessageBoard, chat and
  collaboration stay outside the set.
- **Round 1 (#1657)** — locked `teams/<id>/workers/<name>/` over FIX-912's `agents/` sketch;
  FIX-1310 related-only with FIX-1335 as the loader child; four helpers in scope on FIX-1325;
  gate bar separated from the finish line.
- **Coordinator steer + Codex (#1657)** — tiered the proof so programmatic registration satisfies
  the gate, un-serializing the set from FIX-1335; §2 from seven themes to four; honesty scoped to
  opinionated-agent seats with one thin seat required at the gate; gate corrected to two
  *distinct* kinds.
- **Moved to `epic/workforce-foundation-l2` (PR #1664)** — `Process guards` exempts `spec/`
  content only on a `spec/*` or `epic/*` branch. Same content; #1657 closed unmerged.
- **Round 2 (#1664)** — §2 and §5 trimmed to coordination altitude, per-child constraints pushed
  to FIX-1325's spec; helpers must land with their first real caller, phased if the surface grows.
- **Round 3 (#1664)** — Lab Proof removed from the finish line (its own stage after W2, not a
  criterion or a child). FIX-1327 and theme 3 narrowed to the *undocumented* drop, because as
  written the theme promised a refusal no child could deliver.
- **Round-4 owner decisions and coordinator call (#1664, #1665)** — added **FIX-1337** as a
  fourth child: worker `z.string()` moves from documented-exception to a contract this epic
  deliberately changes, on the spec route, which is round 3's FIX-1327 tripwire firing as
  designed. Theme 3's carve-out is now tool resolution alone. **Redrew the FIX-1335/FIX-1325
  split** against the verified Atlas — *"defineFlow EVERY SEAT · AgentRegistry ONLY IF AGENT"*
  (`:876-877`, figcaption `:886`) — so the loader stops at neutral manifests and the factory owns
  flow-per-seat plus the conditional registry entry. **Dissolved the loader-after-factory
  ordering** on stronger grounds than the review argued: a manifest walker depends on no seat
  contract at all, not merely on a preserved-keys rule.
- **Round-4 correction, same day** — theme 1 briefly claimed the Atlas *locked* a five-file
  per-worker layout and that no author-written manifest file existed. Wrong on both counts: those
  five files are tagged `FACTORY INPUTS · PROPOSED` and are `createWorkerFlow`'s arguments, and
  that helper is *"Not an export on main"*. A seat is declared by **one `WORKER.md`** (or
  `worker.ts` for custom code on the same contract), per the Architect's ruling on #1665 and
  FIX-1335 §6 decision 1 — so theme 1 now says it **supersedes a proposal**, and the Atlas update
  that follows from it is recorded as an obligation this epic owes.
- **Round-5 corrections (#1664, #1676, #1665)** — three settled items, no new argument. **Theme 2
  gains the identity string:** a worker mints as `team.name`, dot-joined, because a slash-joined
  id registers and resolves and is then unreachable over HTTP; the disk path keeps its slashes,
  because a path is not an id. That supersedes the joiner half of FIX-1335's approved decision 2.
  **Theme 4's helpers are phased out of W2:** the reopen condition §5 wrote fired, FIX-1325's done
  bar is now the seat factory alone, and the four helpers are filed against the lab stage — their
  first real caller. **The Atlas obligation gains §05:** `createWorkerFlow`'s parameter list is
  the same supersession as §06's five files, seen from the other side.
- **Round-6 owner fence (in-session)** — **the substrate registers blocks, not Agents.**
  `agentRegistry` / `createAgentRegistry` / `agent-ref` die as a runtime resolve path;
  `defineAgent` becomes a block factory returning a `BlockDefinition`; `materializeAgent` and
  `agentBlock` collapse into it; Workforce seats stay flow instances and are *not* the same list
  as in-process board workers. **The mechanism is Layer 1 and lands in
  `@flow-state-dev/orchestration`**, with Workforce consuming it — which is why no child of this
  epic delivers it. Theme 2 carries the fence, theme 3 loses the "deepen the registry in place"
  mechanism and re-reads its carve-outs (tool resolution survives — it is a tool catalog, not an
  agent one), theme 4 carries the sequencing: **documents move now, the code kill is a separate
  orchestration issue after FIX-1325's factory lands**, and nothing may grow an `agentRegistry`
  in the interval. §1's gate bar keeps its criterion and changes its discriminator — "no
  `AgentRegistry` entry" no longer separates a thin seat from a thick one, so the thin row now
  reads *never went through `defineAgent`*. **The objective itself is untouched**: the fence
  changes mechanism, not the outcome the owner approved. The Atlas obligation gains a third row,
  and it is the first one that supersedes an Atlas *fence* rather than a proposal. **Theme 4's
  handoff also carries one constraint the kill issue inherits** — a collection flow shares one
  block graph across every copy, and `materializeAgent` resolves model and tools at definition
  time, so the collapsed factory must resolve persona, model and tools **per copy from
  `ctx.flow.config`** or every seat of a kind silently shares one model. Surfaced by FIX-1325's
  rewrite; recorded at this altitude because it is invisible from the Layer 1 side where that
  issue will be written.
