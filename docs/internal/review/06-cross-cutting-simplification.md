# 06 — Cross-cutting first-principles review of `@flow-state-dev`

This is a sibling-level review of the framework as a whole. Other reviews are doing the per-package deep dives; this one is concerned with the shape of the surface area, the value proposition, the overlap with competitors, and whether the parts add up to something coherent.

I have tried to be honest. Where I think a thing is wrong, I say it is wrong. Where I think it is right, I say so without padding.

---

## 1. What is the framework actually for?

Reading every "what is this" sentence end to end:

- README header: "Build AI workflows with blocks. Get streaming, state, retries, and type safety for free."
- README "When this framework is for you": orchestration + streaming + state + composable primitives + multi-step tools + agent workspace + execution semantics + one stack across server/client/React/CLI/tests.
- `docs/architecture/overview.md`: "four composable block primitives — handler, generator, sequencer, router — and a runtime that handles execution, streaming, state persistence, retries, and client rendering."
- `apps/docs/docs/intro.md`: "Most agentic frameworks hold up fine for the tutorial case... flow-state.dev is built from the opposite direction. Four composable block primitives, a typed state system, and a library of production-ready implementations that are themselves built from those same primitives. Nothing is a black box."
- `packages/core/README.md`: "The building blocks. Define handlers, generators, sequencers, routers, and flows — all with end-to-end type safety."
- `packages/server/README.md`: "The runtime. Register flows, execute actions, stream results — three lines to a complete API."
- `packages/thought-fabric-core/README.md`: "Cognitive architecture primitives for AI agents. Attention, memory, identity, and more."

There is a coherent core idea hiding in here: **a typed, composable agent runtime where the primitives are small enough that the production library is built on the same primitives users get.** That is a real value proposition. It is genuinely different from Vercel AI SDK (which is a model client + tool-calling adapter) and from Mastra (which is opinionated agents + workflows with prescribed shapes).

But the framework keeps reaching for more:

- It is an orchestrator (sequencer DSL with 21 methods).
- It is an execution runtime (server, retries, rescue, durable checkpoints in `state_snapshot` items).
- It is a state-management framework (four scopes, CAS, `transientSlot`, atomic ops).
- It is a streaming protocol (item/content lifecycle, sequence cursors, two resume modes).
- It is a typed full-stack data layer (resources + clientData projections).
- It is a UI layer (React hooks, `@flow-state-dev/ui` shadcn-compatible registry, `<TaskPlan />`, `<ItemRenderer />`).
- It is a cognitive-architecture toolkit (`@thought-fabric/core` working/episodic/semantic memory, attention, identity, metacognition).
- It is a CLI + DevTool.
- It is a deployment adapter (`@flow-state-dev/vercel`).
- It is a skills system (`@flow-state-dev/skills` — SKILL.md files, run-skill tool, intent classification).
- It is a task substrate (`@flow-state-dev/tasks`, dispatchers, workers, leases — basically a small distributed work queue).
- It is a tool library (`@flow-state-dev/tools` — search providers, etc.).

Twelve answers to "what is this." A senior engineer evaluating this for adoption will close the tab somewhere around answer five.

The clearest, most defensible identity is the first one: **typed composable primitives + a runtime that does the boring stuff well.** Everything else should be optional bolt-ons that don't show up in the elevator pitch.

---

## 2. Competitive positioning (honest)

**Vercel AI SDK (`ai` v4 / v5).** This is the closest competitor and a primary dependency.

- *flow-state-dev wins:* Multi-step orchestration with rescue/retry as primitives. Server-side state scopes with CAS. Resumable SSE with sequence cursors (AI SDK's `experimental_resume` is newer and weaker). Block-as-tool composition (a sub-pipeline can be a tool). Typed clientData projections with policy. Eval and test harnesses out of the box.
- *AI SDK wins:* Cardinality-of-1 simple cases. Provider catalog (every model under one interface). Adoption (millions of weekly downloads). UIMessage / ToolCall part model is a de facto standard; flow-state's `Item` taxonomy is rich but proprietary. AI SDK 5 has Smooth Streaming, generative UI parts, transport abstraction. `useChat` hook just works.
- *Reinventing the wheel:* `BlockContext.emitMessage`/`emitComponent` parallels `streamText` parts; the item/content model overlaps with UIMessage parts. The `Items` doc is 100+ lines explaining a taxonomy that, for 80% of users, would be served by AI SDK's parts model with a thin extension. The generator block is a wrapper around `streamText` + tool loop — useful, but the wrapper has accumulated a lot of surface area.

**Mastra.** TypeScript agent framework, Workflows + Agents + Tools.

- *flow-state-dev wins:* Sequencer DSL is genuinely more expressive than Mastra Workflows (`.thenAll`, `.race`, `.thenAny`, `.work`, `.workIf`, `.forEachBackground`, `loopBack`). State scopes are richer (Mastra has working memory, no project scope). Resumable streaming with sequence cursors is better. Resource/clientData split is original.
- *Mastra wins:* Mastra ships RAG, memory, evals, deployment with a single product story. Cleaner agent abstraction (`new Agent({ instructions, model, tools })`). The Mastra Cloud / Playground story is more polished than `fsdev dev`. Documentation discoverability is better (Mastra docs are organized by task; flow-state docs are organized by primitive).
- *Reinventing the wheel:* Mastra's Workflow DSL covers ~70% of the sequencer DSL with fewer methods. The skills system (`@flow-state-dev/skills`) is partly reinventing Mastra agents/instructions. Memory in `@thought-fabric/core` overlaps with Mastra's Memory.

**LangGraph / LangChain JS.** Graph-based agent orchestration.

- *flow-state-dev wins:* Type safety. Strict block contracts. Mental model is simpler — there is no graph, only nested sequencers. SSE streaming is more polished. No prompt-template-as-string-soup tax.
- *LangGraph wins:* Cycles and arbitrary control flow are first-class. `Send` for parallel fan-out with map-reduce semantics. Persistence + threads are battle-tested. LangSmith for tracing/evals is best-in-class.
- *Reinventing the wheel:* The DevTool overlaps with LangSmith (poorly, given the resource gap). `state_snapshot` items + checkpoints overlap with LangGraph checkpointers. The pattern catalog (RLM, Plan-and-Execute, Supervisor, Blackboard) is 1:1 with LangGraph's prebuilt graphs.

**Inngest / Trigger.dev.** Durable workflow infrastructure.

- *flow-state-dev wins:* Tighter integration with LLM streaming. Local-first dev experience. No external service required.
- *Inngest/Trigger wins:* Real durability. Real retry on cold infrastructure. Time-based triggers, scheduled jobs, fan-out at scale. Cron + webhook + queue ingress with one mental model. Multi-tenant isolation, billing, observability are productized.
- *Reinventing the wheel:* The CAS-guarded state, request-scoped retry policies, `.work()` background sidechains, lease semantics in `@flow-state-dev/tasks` — these are baby versions of Inngest steps and Trigger.dev tasks. flow-state-dev should be a *consumer* of these systems, not a competitor.

**OpenAI Agents SDK.** Released late 2025.

- *flow-state-dev wins:* Model-agnostic. Richer composition primitives. Server state. Streaming that actually resumes.
- *OpenAI Agents SDK wins:* Built-in handoffs, guardrails, sessions, tracing — and these are productized into the OpenAI dashboard. Agents-as-tools is ergonomic. Tied to the platform users already pay for.
- *Reinventing the wheel:* The router block + agentType visibility model is essentially handoffs. `agentType: "primary" | "sub" | "trace"` is reinventing OpenAI's parent/child agent concept.

The pattern across all five comparisons is the same. flow-state-dev has genuinely better composition primitives. It is reinventing observability, durability, memory, and parts of the streaming/UI layer that more focused tools have already solved. **The framework's moat is the sequencer DSL and the typed end-to-end story; everything else dilutes that moat.**

---

## 3. Concept entanglement across packages

The official boundary rules (`docs/architecture/overview.md` lines 69–75): server never depends on client/react, client never depends on server/react, react has no transport logic, etc.

These rules hold structurally. They leak conceptually.

- **Items live in core but are designed for the SSE wire.** `docs/architecture/items.md` describes lifecycle states (`in_progress` → `completed | incomplete | failed`), `provenance`, `ownedBy` containers, transient/persistent rules, `BlockValue` ref/inline/structure discriminated union. This is a wire-protocol taxonomy in the "isomorphic" package. A core that did not know about SSE would have a much smaller item type.
- **`BlockValue` is a serialization optimization that leaked into the type system.** From `items.md`: "the union exists so a deeply nested pass-through pipeline persists the LLM output exactly once." This is server-side persistence concerns shaping the core item shape. Consumers who never read `block_output` items pay the union cost.
- **`clientData` is a server-runtime concept named after the client.** It is computed on the server, exposed in flow definitions in core, and consumed in react. Three packages cooperating around one feature — and the name hides where it actually runs.
- **The `agentType: "primary" | "sub" | "trace"` triple is a UI/audience-routing concept embedded at generator-config time.** Items inherit visibility from the producing generator's `agentType`. That visibility is then resolved by `resolveItemVisibility()` for client/history routing. The taxonomy serves both the LLM context selector *and* the UI renderer. One concept doing two unrelated jobs.
- **`transientSlot()` is a sequencer-state concern that requires state-machine knowledge to use correctly.** The doc says "Apply `transientSlot()` last in the schema chain — after `.optional()`, `.default()`, etc. — so the marker sits on the outermost schema instance." This is leaking implementation detail of how Zod schemas are walked into the user's API.
- **`@thought-fabric/core` depends on `@flow-state-dev/core` and re-exports types as if it were a sibling, but conceptually it is consumer code.** It is a downstream library promoted to peer status because it lives in the same monorepo.
- **The Vercel adapter knows about heartbeats** — well, it used to, until the responsibility moved to `@flow-state-dev/server` (FIX-476). That migration is the right direction. The legacy still ships as a no-op deprecated option.

The boundary rules read like a constitution. The actual entanglement is at the level of named abstractions (Item, BlockValue, agentType, clientData, transientSlot) that span layers and force consumers to understand all of them.

---

## 4. Where could complexity be offloaded?

**To the user's existing platform:**

- *State.* Most teams have a database. The four-scope model with CAS, atomic ops, no-op guards, transient slots — this is a database with extra steps. A v2 should let users plug in their own state (e.g. "session state is whatever you say it is; we just call your reads/writes") and reserve framework state for the bookkeeping the framework itself needs (request status, item log, lease tracking).
- *Persistence.* Three store adapters (in-memory, sqlite, postgres) implement five interfaces (`SessionStore`, `RequestStore`, `UserStore`, `ProjectStore`, `ActiveRequestRegistry`). Most users have one database. A unified `Store` interface with sensible defaults would cut the surface area in half.
- *Durability.* If you need real durability, use Inngest, Trigger.dev, or Temporal. Don't reinvent durable execution inside `state_snapshot` items.
- *UI registry.* `@flow-state-dev/ui` ships a shadcn registry. Most teams already have shadcn or their own design system. The framework needs only `<ItemRenderer />` and a contract for rendering arbitrary component items. The rest is example code.
- *Search tools.* `@flow-state-dev/tools` ships six search providers. A user who wants Tavily can `npm install @tavily/core` and write a five-line handler. This package is convenience, not infrastructure.

**To Vercel AI SDK / lower in the stack:**

- *UIMessage compatibility.* If items had a canonical mapping to AI SDK UIMessage parts, a flow-state user could use the AI SDK React hooks for free. Right now `@flow-state-dev/react` is a parallel implementation.
- *Tool loop.* The generator block manages its own tool loop. AI SDK's `streamText({ tools, maxSteps })` already does this with provider-specific optimizations. Doing it in-framework gives you "block-as-tool," but at the cost of staying in lockstep with whatever AI SDK does next.

**Made optional that is currently default:**

- The custom item taxonomy. A v2 default could be UIMessage parts; the rich taxonomy could be opt-in for users building a DevTool.
- `clientData` projections. Useful for some apps, overkill for chat. Make it opt-in.
- The 21-method sequencer DSL. Half the methods are conditional/aggregator variants. A core 8 methods + a `compose` escape hatch covers 95% of cases.

---

## 5. Package count audit

16 packages in `packages/`, plus 3 in `apps/`. The split is too fine.

| Package | Verdict |
|---|---|
| `core` | Keep. Necessary. |
| `server` | Keep. Could absorb `vercel` and the store adapters. |
| `client` | Keep, but consider merging into `react` if no other consumer materializes. (Today: `react` and `cli` consume `client` — but `cli` could use `server` directly.) |
| `react` | Keep. |
| `testing` | Keep. |
| `cli` | Keep. |
| `devtool` | Merge into `cli`. The only purpose is shipping pre-built assets; it's a build artifact, not a package. |
| `patterns` | Keep but slim. Pattern-as-package is good. The catalog should be smaller and curated. |
| `tools` | Move out of the framework or into `examples/`. Five search-provider wrappers is not framework code. |
| `ui` | Move out of the framework. shadcn-compatible registry is its own product story; bundling it dilutes the framework. |
| `vercel` | Merge into `server` as `@flow-state-dev/server/vercel` subpath. After heartbeats moved upstream, this is ~50 lines. |
| `store-sqlite` | Merge into a single `@flow-state-dev/stores` package with one entry per backing. Or keep at the top level but stop calling them packages — they're adapters. |
| `store-postgres` | Same as above. |
| `tasks` | This shouldn't exist as a separate package. It's a pattern. The `TaskCollection`/`Dispatcher`/`Worker` substrate is a sequencer composition. Move it into `patterns`. |
| `skills` | This shouldn't be in the framework at all. It's an application-layer concern (SKILL.md files, intent classification, slash commands). It belongs in a sibling repo or in `apps/`. |
| `thought-fabric-core` | This shouldn't be in this repo. See section 7. |

**Target: 7 packages.** core, server, client, react, testing, cli, patterns. Stores as adapters under `@flow-state-dev/server`. Vercel as a subpath. Tools, UI, skills, tasks, thought-fabric — out.

A user evaluating the framework should not need to read 16 README files to figure out what is required and what is decoration.

---

## 6. Naming audit

The framework has a vocabulary problem. Here is every non-obvious term I found, judged on whether it pays rent.

| Term | Pays rent? | Notes |
|---|---|---|
| **block** | Yes | Clean, generic. The right primitive name. |
| **handler** | Yes | Standard term. |
| **generator** | Mostly | Conflicts with JS generators. `model` or `agent` would be clearer. |
| **sequencer** | Mostly | Slightly grandiose. `pipeline` or `flow` would land faster. |
| **router** | Yes | Standard term. |
| **flow** | Conflict | Used for both the top-level definition (`defineFlow`) and informally for "any sequenced execution." Pick one. |
| **action** | Yes | Standard term. |
| **scope** | Yes | The four-scope hierarchy is well-named. |
| **resource** | Risky | Overloaded with HTTP resources, IaC resources, OS resources. The framework's "data with content + metadata" concept is real but the name is too generic. |
| **client data** | No | Server-side concept named after the client. Confusing on first encounter. Try `projection` or `view`. |
| **item** | Risky | Generic. Explains nothing. The doc has 13 item types and a 100-line taxonomy. The name hides the burden. |
| **content** (within an item) | No | Overloaded with HTML/CMS notion of content. The streaming-text vs structured-data split has no obvious name. |
| **provenance** | Yes | Real term, useful. |
| **container** (item type) | Risky | Overloaded with React containers, Docker containers. |
| **capability** | Mostly | Real word for what it does. But factory + presets + dynamic-vs-static `uses` adds enough machinery that the simple name undersells the cognitive load. |
| **pattern** | Yes | Standard term. |
| **utility** (block) | No | "Utility block" is `summarizer`/`analyzer`/`classifier`. Calling these `utilities` undersells them — they're prebuilt agents. |
| **skill** | Conflict | Now also a Claude Code concept. The package's "SKILL.md folder you store as a resource" is a *third* meaning. |
| **task** | No | The most overloaded word in software. `@flow-state-dev/tasks` ships a Task primitive, dispatchers, workers, leases. This is a job queue. Call it that. |
| **tool** | Yes | Standard. |
| **fabric** | No | "Thought Fabric" is marketing. The package contents are `working memory`, `attention`, `identity`. The fabric metaphor adds nothing. |
| **agentType** | Risky | The triple (primary, sub, trace) does work for both LLM history routing and UI rendering. The name suggests it's about agent identity; in practice it's a visibility tag. |
| **work / background / sidechain** | Risky | Three words for one concept (non-aborting concurrent execution). The doc admits `.background()` is an alias for `.work()`. |
| **clientData / projection** | No | `clientData` is the type, but it's described as a "projection" or "derived view." Pick one. |
| **target** | Risky | `getTarget(name)` is a state escape hatch. The name doesn't telegraph "named ancestor lookup." |
| **transient slot** | Risky | Two-word concept that needs a paragraph to explain. Probably necessary, but expensive. |
| **wave** | Internal | Process word, not user-facing. Fine. |
| **station** (lifecycle) | n/a | I didn't see this — good. |
| **block_value / inline / ref / structure** | Risky | Discriminated union for block output persistence. Power user only; should not be in the surface vocabulary. |

The framework's vocabulary tax is somewhere around 25 unique terms before you can read example code. The competing frameworks ask for half that.

---

## 7. The `@thought-fabric/core` question

`@thought-fabric/core` is in this repo. It depends on `@flow-state-dev/core`. It implements working memory, episodic memory, semantic memory, attention salience scoring, identity (constitution + perspective), and metacognition (bias and sycophancy detection).

This is a cognitive-architecture research project sharing CI with a framework foundation.

Honestly: it is scope creep. The README admits "Not a feature of the framework. Proof of concept" (`apps/docs/docs/intro.md`). And then ships in the same monorepo, gets called out in CLAUDE.md as a peer package, and consumes dev attention.

The case *for* keeping it: it's the dogfood that proves the primitives are expressive enough. And `workingMemoryCapability` is a great capability example.

The case *against* keeping it: it splits the framework's identity in half. A user landing on the docs site sees "blocks" → "thought fabric" → "memory/attention/identity/metacognition" and assumes the framework is opinionated about cognitive architecture. It is not. The framework is opinionated about composition. The cognitive architecture is one possible application of that composition.

**Recommendation:** Move `@thought-fabric/core` to a sibling repo, link to it from the docs as "an example application," keep the source in tree only as a `examples/thought-fabric/` reference. The package name stays. The relationship becomes "user of the framework," not "peer." This buys back the framework's identity without losing the dogfood.

---

## 8. Phase 1 locked contracts

From `docs/architecture/overview.md` and `docs/contributing/architecture-reference.md`:

| Lock | Verdict |
|---|---|
| Block kinds: exactly handler/generator/sequencer/router | **Keep locked.** This is the moat. |
| Actions are flow-level | **Keep.** Action-as-entry-point is right. |
| Required caller input: `userId` | **Unlock.** `requireUser: false` already exists since FIX-23. The "required" in the locked contract is now historical. Remove it from the locks list. |
| Stream model: item/content lifecycle, no part-envelope model | **Reconsider.** Item/content was a deliberate choice over AI SDK parts. Worth re-examining: a parts-compatible mapping (UIMessageParts ↔ Items) would unlock AI SDK ecosystem reuse. Don't break the wire format, but stop treating "part-envelope" as the bad guy. |
| Stream cursor: `${requestId}:${sequence_number}` | **Keep.** Cleanly designed. |
| Resume paths: both `Last-Event-ID` and `starting_after` | **Slim to one.** Maintaining both is a tax. `Last-Event-ID` is the SSE standard; `starting_after` is convenience. Pick `Last-Event-ID`, deprecate `starting_after`. |
| Generator provider: Vercel AI SDK in Phase 1 | **Unlock.** This was Phase 1 hedging. Either commit (and stop working around AI SDK changes) or genuinely abstract (and stop pretending you have). Right now it's worst-of-both. |
| Observational hooks: past tense | **Keep.** Cosmetic but consistent. |
| `react` wraps `client`, no transport in `react` | **Keep.** Boundary rule is right. |

The locks that hurt are the ones treating Phase 1 implementation choices (AI SDK, dual resume paths, `userId` required) as architecture-level commitments. Architectural locks should constrain the *shape*, not the *plumbing*.

---

## 9. If I were starting over

A v2 sketch. Roughly 150 lines of pseudocode. Keeps the moat; drops the rest.

```ts
// === core: 4 block kinds, generic shape ===
type Block<I, O> = {
  kind: "handler" | "generator" | "sequencer" | "router";
  name: string;
  inputSchema?: ZodType;
  outputSchema?: ZodType;
  run(input: I, ctx: Context): Promise<O>;
};

// === handler: pure function with ctx ===
function handler<I, O>(cfg: {
  name: string;
  inputSchema?: ZodType<I>;
  outputSchema?: ZodType<O>;
  execute(input: I, ctx: Context): Promise<O> | O;
  retry?: RetryPolicy;
}): Block<I, O>;

// === generator: thin wrapper over AI SDK streamText ===
function generator<I, O>(cfg: {
  name: string;
  model: string | LanguageModel; // accept any AI SDK model
  prompt?: string | ((i: I, ctx: Context) => string);
  user?: (i: I, ctx: Context) => string;
  history?: boolean | HistorySelector;
  tools?: Block<any, any>[]; // any block can be a tool
  outputSchema?: ZodType<O>;
  agentType?: "primary" | "sub";
  // No `agentType: "trace"` — trace items go through a separate emitter.
}): Block<I, O>;

// === sequencer: 8 core methods, escape hatch for the rest ===
function pipeline<I = void>(cfg: { name: string; stateSchema?: ZodType }): Pipeline<I, I>;

interface Pipeline<I, O> extends Block<I, O> {
  then<R>(b: Block<O, R>): Pipeline<I, R>;
  thenIf(cond: (o: O, ctx: Context) => boolean, b: Block<O, O>): Pipeline<I, O>;
  parallel<R>(map: Record<string, Block<O, any>>): Pipeline<I, R>;
  forEach<R>(b: Block<O extends (infer E)[] ? E : never, R>): Pipeline<I, R[]>;
  rescue(handlers: { when: ErrorClass[]; block: Block<RescueInput<O>, O> }[]): Pipeline<I, O>;
  work(b: Block<O, any>): Pipeline<I, O>;       // background, non-aborting
  loop(cond: (o: O) => boolean, b: Block<O, O>): Pipeline<I, O>;
  compose<R>(f: (acc: Pipeline<I, O>) => Pipeline<I, R>): Pipeline<I, R>; // escape hatch
}

// === router: dispatch ===
function router<I, O>(cfg: {
  name: string;
  decide(input: I, ctx: Context): Block<I, O> | string;
  routes?: Record<string, Block<I, O>>;
}): Block<I, O>;

// === flow: actions + scopes ===
function defineFlow(cfg: {
  kind: string;
  actions: Record<string, { input?: ZodType; block: Block<any, any> }>;
  state?: { request?: ZodType; session?: ZodType; user?: ZodType };
  resources?: Record<string, ResourceDef>;     // optional, no clientData split
  hooks?: { onStarted?: Block; onFinished?: Block };
  middleware?: Middleware[];
}): FlowDef;

// === context: minimal, transport-agnostic ===
interface Context {
  state: { request: StateOps; session?: StateOps; user?: StateOps };
  emit: {
    message(text: string, opts?: { role?: "primary" | "sub" }): void;
    component(name: string, data: object, opts?: { key?: string; transient?: boolean }): void;
    status(text: string): void;       // transient
    custom<T>(type: string, data: T): void;  // power user
  };
  signal: AbortSignal;
  resolveModel(name: string): LanguageModel;
  // Tools are blocks; calling a block is `block.run(input, ctx)` — no escape hatch needed.
}

// === streaming: items map 1:1 to AI SDK UIMessage parts where possible ===
type Item =
  | { type: "message"; text: string; role: "user" | "assistant" | "sub" }
  | { type: "reasoning"; text: string }
  | { type: "tool-call"; name: string; input: unknown; output?: unknown }
  | { type: "component"; name: string; data: object; key?: string }
  | { type: "status"; text: string }
  | { type: "error"; message: string; code: string };
// Lifecycle is in_progress|completed and rides on the SSE event, not in a separate field.
// No block_output, router_decision, state_snapshot, block_debug.
// Devtool gets its own event stream, not item types.

// === server: one entry, one route mounter ===
function serve(cfg: {
  flows: FlowDef[];
  store?: Store;                // unified, one interface
  models?: ModelResolver;
  middleware?: Middleware[];
  auth?: PrincipalResolver;
  heartbeatMs?: number;
}): { handler: (req: Request) => Response };

// === client: one factory ===
function createClient(cfg: { url: string; flowKind: string; userId?: string }): {
  sendAction(name: string, input: unknown): Promise<{ requestId: string }>;
  stream(requestId: string, opts?: { lastEventId?: string }): AsyncIterable<Event>;
  getState(sessionId: string): Promise<StateSnapshot>;
};

// === react: hooks that wrap client, period ===
function useFlow(opts: { autoCreateSession?: boolean }): FlowHandle;
function useSession(sessionId: string | null): SessionHandle;
// No FlowProvider with hidden state. Hooks accept config directly.
```

What's gone:
- `BlockValue` discriminated union (gone — pass-through composers don't emit `block_output`).
- `agentType: "trace"` (gone — trace items go on a separate channel).
- `clientData` separate from state (gone — projections are user code).
- Resource collections, dynamic resources, `flowIsolation`, `defineResource()` → just session/user/org-scoped state with optional content.
- Capability factories with presets (gone — `uses` is a one-line array of `{ resources, context, tools }` records).
- 21-method sequencer DSL (down to 8 + `compose`).
- 13 item types (down to 6).
- Two resume protocols (down to one).
- Project scope (gone — `user` and a custom store cover it).

What's kept:
- The four block primitives and their composability.
- Type safety end to end.
- SSE streaming with sequence cursors.
- Rescue + retry as primitives.
- Block-as-tool composition.
- Action-as-entry-point.

This is the framework's actual moat. The rest is decoration.

---

## 10. Simplification ROI ranking

Top 15, ordered by `(impact × confidence) / effort`. Each entry: action, what code goes away, risk.

1. **Move `@thought-fabric/core` out of the repo.**
   - *Action:* New repo `thought-fabric`. Remove from `pnpm-workspace.yaml`. Update CLAUDE.md.
   - *Removes:* ~7,300 lines from the framework's surface; a confusing second identity.
   - *Risk:* Low. It already builds against published `@flow-state-dev/core`.

2. **Drop `@flow-state-dev/skills` and `@flow-state-dev/tools` from the framework.**
   - *Action:* Move to a sibling repo or `examples/`. They are application-layer.
   - *Removes:* ~6,800 lines, two README pages, two READMEs of API surface.
   - *Risk:* Low. Anything depending on them is examples or kitchen-sink.

3. **Merge `@flow-state-dev/devtool` into `@flow-state-dev/cli`.**
   - *Action:* Ship the pre-built assets inside the CLI package. Drop the standalone package.
   - *Removes:* One package; one publishing step.
   - *Risk:* Trivial. The package is currently a static-asset shipper.

4. **Merge `@flow-state-dev/vercel` into `@flow-state-dev/server` as a subpath.**
   - *Action:* `@flow-state-dev/server/vercel` exports `createVercelHandler`. Drop the separate package.
   - *Removes:* One package, ~300 lines, one README, the deprecated `heartbeatMs` confusion.
   - *Risk:* Low — the package is already a thin wrapper.

5. **Collapse `store-sqlite` and `store-postgres` into `@flow-state-dev/server` with optional peer-dep imports.**
   - *Action:* `@flow-state-dev/server/stores/sqlite` and `/postgres`. Each lazy-imports its driver.
   - *Removes:* Two packages, two READMEs, two publishing pipelines.
   - *Risk:* Medium. Peer-dep loading needs care; some bundlers complain about optional native deps.

6. **Make `@flow-state-dev/tasks` an internal substrate of `@flow-state-dev/patterns`.**
   - *Action:* Move source into `patterns/src/tasks/`. Don't publish separately.
   - *Removes:* One package, ~2,200 lines of public surface.
   - *Risk:* Low. The README already says "patterns layer on top of this package; this package never imports from patterns" — they're already coupled.

7. **Cut sequencer DSL from 21 methods to 8 + `compose`.**
   - *Action:* Drop `thenIf`/`tapIf`/`workIf`/`forEachBackground`/`thenAll`/`thenAny`/`race`/`waitForWork`/`loopBack`/`background`/`exitIf`. The first eight are conditional variants that can be inline `if` inside connectors. The aggregators (`thenAll`/`thenAny`/`race`) cover what `parallel` already covers with one extra line. `loopBack` is `loop`. `background` is `work`.
   - *Removes:* ~1,500 lines of sequencer implementation, ~600 lines of doc.
   - *Risk:* Medium-high. Existing flows use these. Need a clear migration path. **Do this only at a major version.**

8. **Cut item types from 13 to 6; move `block_output`/`router_decision`/`state_snapshot`/`block_debug` to a separate devtool event stream.**
   - *Action:* DevTool-only items become trace events on a separate SSE channel. Item taxonomy gets cleaner. `BlockValue` discriminated union goes away.
   - *Removes:* The 100-line `BlockValue` ref/inline/structure machinery. ~400 lines of doc.
   - *Risk:* Medium. The DevTool needs rewiring. The persistence-deduplication trick (FIX-413) needs reimplementing on the trace channel, which is fine since the trace channel doesn't persist.

9. **Drop the `clientData` concept; replace with explicit `view` blocks at action boundaries.**
   - *Action:* Users write `view: handler({ execute: (s, ctx) => ({...}) })` if they want a derived view. Framework just exposes raw state under whitelist.
   - *Removes:* ~500 lines of clientData merging/derivation code, the "every clientData is client-visible" policy doc, the contextFn vs raw state distinction.
   - *Risk:* Medium. Some users like the projection model. Compromise: keep it but as a convention, not a framework feature.

10. **Slim `Resource` to typed key/value with optional content; drop `flowIsolation`, `dynamic`, `llmReadable`/`llmWritable`, `allowedExtensions`, `metadata`, custom `render`.**
    - *Action:* Resource is `{ scope, schema, content?, contentFile? }`. Tools that need LLM read/write are user code. flowIsolation is solved by namespacing the `ref` yourself.
    - *Removes:* ~300 lines of resource config plumbing; a dense doc page.
    - *Risk:* Medium. Existing flows use `flowIsolation`. Migration is rename your `ref` to include `flowKind` if you want isolation.

11. **Drop two resume modes; keep only `Last-Event-ID`.**
    - *Action:* Deprecate `starting_after`. SSE clients all support `Last-Event-ID`.
    - *Removes:* Some routing/parsing code; one mental model.
    - *Risk:* Low. Mechanical migration.

12. **Unlock the AI SDK lock; commit explicitly.**
    - *Action:* Remove "Vercel AI SDK in Phase 1" from the locked contracts. Document that `generator` is a thin wrapper over `streamText` and accepts any AI SDK `LanguageModel`. Drop the abstract `ModelResolver` that nobody else implements.
    - *Removes:* ~400 lines of the model-adapter abstraction.
    - *Risk:* Low — committing to AI SDK is already de facto.

13. **Remove `@flow-state-dev/ui` from the framework's docs as a "first-party" thing; reposition as "an example component pack."**
    - *Action:* Keep the package. Stop including it in the framework story.
    - *Removes:* No code. Just clarifies identity.
    - *Risk:* Trivial.

14. **Drop `agentType: "trace"`; trace items go through a separate emitter.**
    - *Action:* Generators are `primary` or `sub`. Trace observability is `ctx.emit.trace(...)` which writes to the devtool channel only.
    - *Removes:* ~150 lines of visibility resolution; the "agentType is also a visibility tag" overload.
    - *Risk:* Low.

15. **Stop referring to internal Linear issue IDs in user-facing docs and READMEs.**
    - *Action:* Audit `apps/docs/`, package READMEs, and the architecture docs. References like "FIX-413," "FIX-477," "FIX-480" go in `changelog.md` and internal artifacts only. CLAUDE.md already says this; the codebase doesn't follow it.
    - *Removes:* ~30 references across user-facing surfaces.
    - *Risk:* Trivial. Reduces "this is internal" smell for newcomers.

The first six are pure organizational simplifications and could land in a week without breaking the public API. Items 7–10 are the real surgery and need a major version. Items 11–15 are easy clarifications.

---

## Closing

The framework has a real and defensible idea: typed, composable block primitives where the production library is built from the same primitives users get. The execution of that idea is over-broad. Sixteen packages, twenty-five vocabulary terms, thirteen item types, twenty-one DSL methods, four state scopes, three identity types, three persistence stores, two resume protocols, two cognitive-architecture sub-projects.

Every locked contract, every named abstraction, and every package boundary made sense at the moment it was added. Together they sum to a framework that is harder to evaluate than its competitors and easier to misunderstand than its core insight deserves.

The simplification path is not radical. Cut six packages. Halve the sequencer DSL. Halve the item taxonomy. Stop hedging on AI SDK. Move the cognitive-architecture project sideways. The remaining framework would be the one the docs already promise: blocks, composition, streaming with resume, type safety end to end. That framework would be easier to adopt, easier to teach, and harder for competitors to copy.
