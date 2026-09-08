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
gap here is that no real multi-seat application runs on FSD. This epic does not close that gap by
existing; it removes the reason it stays open — the bespoke wiring every such app has to invent
first — and then closes a first slice of it with the Lab Proof below.

**Holistic necessity.** Three issues, and the honest question is whether it is two. The
convention loader (FIX-1335) and the seat factory (FIX-1325) are one spine cut at a real seam:
the loader answers *what seats exist*, the factory answers *what one seat resolves to*. They are
two issues because the loader has to land against a settled factory contract, and specifying
them together is how the file shape starts negotiating with the instance API. Materialization
honesty (FIX-1327) is the weakest of the three alone — a backlog bug that predates this epic and
would be fixed eventually anyway. It is **kept, and kept as a bug** (no spec, straight to the
fix), because the factory's entire promise is that a seat runs what it declared, and today
`materializeAgent` overrides a declared `outputSchema` on the worker path and drops string-key
capabilities silently when no catalog is present. Ship the factory on that and we ship the
promise without the behaviour. If FIX-1327 grows past a refusal into *supporting* structured
workers, that is the signal it stopped being this epic's bug (§5).

**Proof — tiered. The gate bar and the finish line are deliberately not the same.**

| | What has to be true | Why here |
|---|---|---|
| **Gate minimum** | Two seats of **distinct** worker kinds, each with **different create-time config**, hired on the real assembled path — **one hire per kind**, and **at least one of them thin** (flow-only, no `AgentRegistry` entry). Each resolves by its exact instance id and reads its own frozen `ctx.flow.config`. The opinionated-agent seat materializes a worker that honours its declaration or fails naming what it could not honour; the thin seat never touches the Agent layer at all. **Programmatic registration is acceptable at this bar** | This is the claim the objective rests on — a seat is a configured worker and it runs what it says. Distinct kinds because **same-kind multi-hire is not this epic's bar**: the Atlas gives W2 "one hire per kind is enough" and assigns the multi-hire proof to Collab RC. One seat thin because otherwise the epic can pass without ever exercising the thin-seat path (Atlas §04 proof B: one row seats a thin coordinator *and* a thick Agent). No loader required, so the set does not serialize behind FIX-1335 |
| **Epic-complete** | The same proof bootstrapped from **conventional files only**, *plus* the **Lab Proof**: a thin pentest team — intake, recon, triage seats on the locked tree; projects as boards and resources, not a `Project` type; a finding or asset write becoming a task and a dispatch to the next seat, as package-surface proof only. Stops before OnSecurity, before MCP, before a fourth seat | Files-only is what proves the *convention*; the lab is what proves the *package*. A green gate minimum is not evidence either works |

**Gate-minimum-complete is not epic-complete**, and this epic must not be declared to have
served the objective when only the first row is green. The Lab Proof has no owning child issue
today — see §5; that is a routing question, not a licence to drop it.

**Not doing:** Team, Channel, MessageBoard or Project as Layer 1 types; a second registry; hot
addition of flow kinds after boot; a management bus, a delivery bus, or a second dispatcher; a
second Agent type in the package; member-memory depth; the MCP client door (held by #1655 until
the package and the lab both exist); ordered multi-reply and who-may-reply policy (Collab RC).

## 2. Themes & long-horizon direction

*Four decisions that sit above any single issue. Anything that constrains only one child is that
child's spec, not a theme — the loader's scan mechanics belong to FIX-1335 and the factory's API
shape to FIX-1325.*

1. **One file shape, one registry.** The locked shape is `teams/<teamId>/workers/<name>/`
   ([Atlas §06](../../docs/atlas/workforce.html)) — team folders are `teams/`, seats nest under
   the team they seat, and there is **no `agents/` or `personas/` sibling**: FIX-912's older
   sketch is superseded as a delivery stream and no issue in this set may re-open it. The scan
   feeds **today's** registries — `defineFlow` for every seat, a `createAgentRegistry` entry only
   when that seat is an opinionated agent; thin seats skip the registry entirely. *Why no second
   registry:* the scan's whole value is that files and hand-written definitions produce the same
   entries, so a second source of truth gives "what seats exist?" two answers and turns the
   TypeScript escape hatch into a fork.

2. **A seat is one exact flow instance carrying its own create-time config.** A seat is
   configuration and identity, not a new execution primitive: one already-defined collection
   flow, an instance under the seat's stable id, an immutable config bag, registered through the
   canonical flow registry. **No kind-only address for a collection member and no
   first-registered fallback** — that is what makes a seat addressable as itself rather than as
   its kind, and it is the contract FIX-1335 targets and FIX-1327 materializes against.
   **One hire per kind is enough for this epic**; same-kind multi-hire is Collab RC's proof, not
   W2's, and no issue here should build toward it. Harness,
   model and persona references are instance config when they vary without changing the block
   graph; a difference that changes the action tree is a different flow kind, not another config
   key.

3. **Honour it, or refuse it — never quietly downgrade. And being a seat never requires being an
   Agent.** Every *Agent* materialization path either honours the declared structured output,
   tools, capabilities, persona and model, or fails with an error naming the unsupported
   combination (BP-030 — refuse, don't drop). This is the epic's honesty promise and it binds the
   factory as much as the bug: a seat that runs something other than what its files declare makes
   the convention worse than hand-wiring, because the drift is invisible. **The promise is scoped
   to opinionated-agent seats by design** — a thin seat is a `defineFlow` and no more, and no
   issue in this set may route one through the Agent layer to make it a seat. *Why:* Atlas §04
   proof B names "requiring every seat to be an Agent" as one of the things growing the seam would
   fake, and §06 has thin seats stop at `defineFlow` and skip `AgentRegistry`; a factory that
   quietly Agent-ifies an intake sequencer has invented the second Agent type the fence exists to
   prevent. Served by deepening `defineAgent` / `createAgentRegistry` / `materializeAgent` **in
   place**. *Why no second Agent type and no growth of the core type:*
   skills and orchestration type `agent-ref` and materialize against
   `packages/core/src/types/agent.ts` without importing Workforce, and engine has no
   `AgentRegistry` import — a parallel Worker/Member type, or a `resources`/`memory`/`sessions`
   field on the core type, breaks that seam and folds one product's knowledge into the substrate
   (tenet 4). Demote means do not grow these types; it does not mean delete them.

4. **The fence, with its reasons — and where this epic stops.**
   - **The four thin L2 helpers are IN scope as veneer over *declared* dispatchers**, and they
     ride FIX-1325 because all four are *seat addressing* over the roster row that issue produces.
     The Atlas W2 row names them: **keyed team · intake seat DM · room subscribe · board notify**
     — the shapes already drawn in [Atlas §08 (room helpers)](../../docs/atlas/workforce.html) as
     `openDm` / `openTeamInbox`, `openProjectRoom` and `fanOutBoardPost`. They are **helpers, not
     TeamFlow, not MessageBoard L1, not Collab RC**. Each wraps a Layer 1 call that exists; each
     takes a **team key**, so a second team is another key and not a new argument. Do not invent
     alternative names — no `subscribeRoom`, `notifyBoard`, `fanOutAcrossTeams`, or
     `loadWorkforce()`. **Deferred to Collab RC, explicitly:** ordered multi-reply
     (`fileOrderedReplies`), who-may-reply policy, real cross-team addresses, and multi-hire
     fan-out.
   - **A helper that needs a missing Layer 1 door names the gap; it does not ship a pretend
     argument.** The one this set will hit: existing-session delivery by `{ id }` past an external
     queue refuses by name in `create-request-host.ts`, so `openDm`'s wake and `fanOutBoardPost`
     refuse on BullMQ. Surface it; do not silently retry as `{ key }`. Any other missing door is
     raised here, not routed around locally. *Why:* a hidden argument is how a foundation acquires
     a bus.
   - **No Team / Channel / MessageBoard L1 type**, *because* such a type's only job would be to
     hold the seat→worker→session bind, and that bind is a keyed row — minting a type for it makes
     a second team a new type instead of a new key. **No hot-dynamic kinds after boot**, *because*
     kinds register at load and a runtime seat-join API is a second registration path that skips
     the file, which is the convention.
   - **Sequencing.** The Layer 1 floor has landed, so W2 is unblocked and is the kick. Within the
     set FIX-1327 is independent and may land first; FIX-1325 settles the seat contract; FIX-1335
     lands against it. After this epic: **W1 MCP (FIX-1333), which #1655 holds until the package
     and the lab both exist — it is not the next child** — and then Collab RC.

## 4. Running index

| Issue | What it owns | Route | Spec PR | Impl PR | State |
|---|---|---|---|---|---|
| [FIX-1335](https://linear.app/fixpoint-labs/issue/FIX-1335) | Convention loader: scan `teams/<id>/workers/<name>/` into today's workforce registries | spec | — | — | Backlog |
| [FIX-1325](https://linear.app/fixpoint-labs/issue/FIX-1325) | The seat factory — INST-5 hire/mint as collection kinds; a seat binds one exact flow-instance id + immutable create-time config (**one hire per kind at this epic's bar** — theme 2). Carries the four thin helpers (theme 4) | spec | — | — | Backlog |
| [FIX-1327](https://linear.app/fixpoint-labs/issue/FIX-1327) | Materialization honesty — `materializeAgent` honours or loudly refuses a worker's declared structured output and capabilities | **bug** | — | — | Backlog |

*A bug carries no spec PR and no spec-approval gate by design — it routes straight to the fix,
with its PR as the review surface
([`orchestration.md`](../../docs/contributing/orchestration.md) → "Which issues get a spec"). The
empty Spec PR cell on the FIX-1327 row is correct, not a gap. The Lab Proof named in §1 as an
epic-complete criterion has no row here yet — §5.*

**Related, deliberately not children.**

| Issue | Why it is not a child |
|---|---|
| [FIX-1310](https://linear.app/fixpoint-labs/issue/FIX-1310) — Teams roster | The later **Team-level consumer** of this convention. Folding it in would make this epic ship a partial Team under a foundation label |
| [FIX-912](https://linear.app/fixpoint-labs/issue/FIX-912) — Layer 2 delivery model | The older charter that named this work. **Superseded as a delivery stream** by FIX-1335; kept for provenance. Its `agents/` + `personas/` sketch does not survive theme 1 |
| [FIX-1311](https://linear.app/fixpoint-labs/issue/FIX-1311) — Message board | Layer 2 assembly over collections, subscriptions and `reactTo`. Board *addressing* is Collab RC's question, not the seat spine's |
| [FIX-1333](https://linear.app/fixpoint-labs/issue/FIX-1333) — W1 Workforce MCP | A **sibling epic**, held by #1655 until this package and the Lab Proof both exist. Sequencing note only — its Linear "unblocked now" is stale against that hold |
| [FIX-1320](https://linear.app/fixpoint-labs/issue/FIX-1320) · [FIX-1331](https://linear.app/fixpoint-labs/issue/FIX-1331) | **Satisfied prerequisites**, not work. The instances floor and the create-time config bag are on `main`; W2 is unblocked because of them |

## 5. Open cross-cutting questions

**Genuinely open.**

- **Who owns the Lab Proof?** Raised by tiering the proof (see §1): the lab is an epic-complete
  criterion with no child issue and no row in §4. Either a fourth child is filed under this epic,
  or this epic wraps only on evidence produced by the follow-on lab epic. **Recommendation: file
  it as a fourth child once FIX-1325's spec settles the seat contract** — the lab's value is that
  it consumes the package as an author would, and an issue that cannot start until the package
  exists is still better tracked here than assumed. Blocks nothing today; it blocks *declaring
  the epic done*, which is exactly when an unowned criterion gets dropped.

- **Do the four thin helpers ride FIX-1325, or earn their own issue?** Theme 4 says they ride it,
  because each is seat addressing over the roster row FIX-1325 produces and a separate issue would
  spec the same contract twice. What would change it: FIX-1325's own spec finding the helper
  surface larger than the factory it wraps. Blocks nothing — both children can be specced against
  theme 4 as written. A coordinator-level call, not an owner-level one.

- **Does the worker path *support* declared structured output, or *refuse* it?** Recorded here
  because FIX-1327 is a bug with no spec, so this is the only place the decision exists before it
  is made in code. Supporting structured workers changes the skills adapter in
  `packages/orchestration`, not just this package. **Recommendation: refuse loudly, don't
  support** — a clear error satisfies theme 3 and BP-030; making it work is a separate
  cross-package feature and not this spine. FIX-1327 proceeds on "refuse" and comments up if the
  refusal proves unusable.

**Already settled — recorded so nobody re-opens them.** These came from the Atlas and #1655 or
from the coordinator; they are decisions, not questions.

- **FIX-1310 stays related, not a child.** FIX-1335 is the focused convention-loader child. Raised
  by the epic-spec draft, settled by the coordinator on round-1 review; the draft had left both
  stories live in §4 and §5.
- **One hire per kind; same-kind multi-hire is Collab RC's.** The Atlas W2 row says "One hire per
  kind is enough" and the Collab RC row carries the "multi-hire Proof … INST as needed for
  hire-id / dynamic / multi-hire". An earlier draft of this spec set the gate at *two seats from
  one collection kind*, which is exactly that multi-hire proof; corrected to **two distinct kinds,
  differently configured**. What the original wording was protecting — that create-time config
  genuinely varies per seat — survives intact, and no issue in this set should build toward
  same-kind hiring.
- **The materialization-honesty contract is scoped to opinionated-agent seats.** A thin seat that
  stops at `defineFlow` with no registry entry is correct behaviour, not a contract violation —
  Atlas §04 proof B names "requiring every seat to be an Agent" as a failure mode and the W2 row
  names "scanning every seat into `AgentRegistry`" as one of the things that would fake this epic.
- **The proof is tiered, and programmatic registration satisfies the gate.** Coordinator's call.
  Requiring files-only at the gate would serialize the whole epic behind FIX-1335 for no product
  gain.
- **The branch name is a recorded deviation.** This epic runs on
  `codex/create-spec-for-epic-fix-1332`, not `epic/<name>`. Discovery is native — the Linear
  parent plus the `Epic` label — and `epic-wake` receives `epic.branch` as a passed field rather
  than deriving it from a prefix, so nothing automated depends on the name. Not renamed; the PR
  thread is worth keeping.

**Atlas-vs-code drift, recorded not papered over.** The Atlas is pinned at `15c814251`, where §03
tags FIX-1331 "about to land · not exists" and §19 gap 1 says `get(kind) still falls to the first
registered instance / INST-1..3 todo, not started`. Neither holds on `main` today: `configSchema`
/ `config` and `ctx.flow.config` exist in `packages/core/src/flow/defineFlow.ts`, and the
registry resolves by global id with no kind fallback. The direction is unaffected — both make W2
*more* buildable — but the pin needs a refresh so a later reader does not treat those rows as
live holds. Flagged for the Atlas owner; not this epic's edit.

## Epic evolution

- **Epic drafted** — reduced Workforce foundation L2 to one convention-to-registry path, one
  seat-to-flow-instance factory, and honest Agent materialization; kept Team, MessageBoard, chat
  and collaboration outside the set.
- **After round-1 epic review (Architect, #1657)** — folded five findings. FIX-1310 is
  related-only and FIX-1335 is the loader child, in one voice across §4 and §5, because the draft
  left both stories live. Named the locked `teams/<id>/workers/<name>/` path in theme 1 and the
  index so FIX-912's `agents/` sketch cannot win by default. Split the proof into a spine proof
  and the Lab Proof and said plainly they are different finish lines, because approving the
  objective against the spine alone would let this epic wrap with the product proof unbuilt.
  Resolved the helper fence: the four Atlas-named helpers are in-scope veneer riding FIX-1325,
  with a pointer to Atlas §08 so an implementer does not chase helpers they think were ruled out;
  `fileOrderedReplies` and ordered multi-reply defer to Collab RC. Added the sequencing line so
  nothing reads as if W1 MCP is the next child.
- **After coordinator steer (same pass)** — **tiered the proof**: the gate minimum is two
  configured seats on the real assembled path with programmatic registration allowed, and
  files-only plus the Lab Proof is epic-complete. Requiring files-only at the gate serialized the
  set behind FIX-1335 for no product gain. Surfaced the consequence in §5 rather than hiding it —
  the Lab Proof is now an epic-complete criterion with no owning child. **Collapsed §2 from seven
  themes to four**, moving per-issue API detail to the child specs: a theme that constrains one
  child is that child's spec. The depth moved into §1's objective and proof bar, the fence's
  reasons, and a §5 that now separates settled decisions from genuinely open questions.
- **After the Codex inline findings on this file (#1657, 22:31Z)** — corrected the third pillar
  and the proof bar, both against the Atlas text rather than against the draft's own logic.
  **The Agent contract is Layer-2 opinion, not a property of every seat:** the objective and theme
  3 required each seat to materialize as an honest Agent, which contradicted this spec's own theme
  1 and the lock (Atlas §06: thin seats stop at `defineFlow` and skip `AgentRegistry`; §04 proof B
  names "requiring every seat to be an Agent" as a failure mode). Honesty is now scoped to
  opinionated-agent seats, and the gate minimum must seat **at least one thin worker** so that path
  is exercised rather than assumed. **The gate is two distinct kinds, not two hires of one kind:**
  the Atlas gives W2 "one hire per kind is enough" and assigns the multi-hire proof to Collab RC,
  so the earlier wording had pulled a later epic's proof into this gate. Config-varies-per-seat —
  what that wording was protecting — is unchanged. Also stated the four thin L2 helpers as in-scope
  veneer under the Atlas W2 row's own names, over *declared* dispatchers.
