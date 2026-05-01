# 06 — Validation: Identity and Progressive Disclosure

**Validator brief:** Re-examine `00-team-synthesis.md`, `01-newcomer-dx.md`, and `06-cross-cutting-simplification.md` through the maintainer's reframed lens — the framework is deliberately anti-opinionated, deliberately powerful, and the simplification target is the intro experience, not the surface area.

The original review was written under an implicit assumption: "if a feature isn't load-bearing for typical apps in the first month, it should be removed." That is a Mastra-shaped assumption. The maintainer has explicitly rejected it. The framework was built *because* Mastra's opinions did not survive contact with real applications. The right question is not "what can we cut?" but "what can we hide from the front door without losing it from the building?"

This report works through that re-framing concretely.

---

## 1. Reclassifying the original "top 15" simplifications

The original `06-cross-cutting-simplification.md` §10 ranked 15 simplifications by ROI. Below each item is reclassified:

- **REMOVE** — genuinely dead or unprincipled. Cut.
- **KEEP-BUT-HIDE** — real capability, but does not belong in the intro path. Move to "Advanced" or "Ecosystem" docs; keep the code.
- **KEEP-AS-IS** — the original review's prescription was driven by the "minimal surface area" lens that the maintainer rejects. Either the feature pulls weight or its cost is small.

### 1. Move `@thought-fabric/core` out of the repo
**Verdict:** KEEP-AS-IS in the repo, but RECLASSIFY in docs as ecosystem.
The maintainer is explicit: "thought-fabric-core is a research project, but the memory layer is real. It's meant to be part of the ecosystem." Shipping it from the same monorepo is fine — it's the dogfood that proves the primitives are expressive enough. What was wrong was treating it as peer to `@flow-state-dev/core` in the docs sidebar. Move it under "Ecosystem" in the docs (it already lives at `/thought-fabric/*` route, so the routing is already clean — the issue is the framing). Drop the "framework's identity is split" framing; the identity *is* "core + ecosystem" and t-f is the tentpole ecosystem package.

### 2. Drop `@flow-state-dev/skills` and `@flow-state-dev/tools` from the framework
**Verdict:** KEEP-AS-IS as packages, RECLASSIFY in docs as ecosystem.
Skills and tools are exactly the kind of "advanced capability available when needed" the maintainer wants to preserve. A user who never writes a SKILL.md file does not pay for the skills package. The original review's argument was "you don't need them on day one" — that is exactly the maintainer's point about progressive disclosure. The cure is docs reorganization, not deletion. Both currently sit at top-level sidebar categories; both should move under "Ecosystem."

### 3. Merge `@flow-state-dev/devtool` into `@flow-state-dev/cli`
**Verdict:** KEEP-AS-IS package boundary; possibly bundle assets internally.
This is genuinely a build-artifact split, but it does not affect users. The framework story is unchanged whether they ship as one package or two. Low priority either way. Internal cleanup.

### 4. Merge `@flow-state-dev/vercel` into `@flow-state-dev/server` as a subpath
**Verdict:** KEEP-AS-IS for now.
Same reasoning. This is a packaging decision, not an identity decision. If the package is ~50 substantive lines, a subpath is fine. If keeping it separate makes it easier for a Vercel-specific user to discover, the subpath is worse. Defer.

### 5. Collapse `store-sqlite`/`store-postgres` into `server`
**Verdict:** KEEP-AS-IS as separate packages; better discoverability.
Store adapters are a category users actively pick from. Having them as discrete packages with their own READMEs makes the choice explicit. Bundling them behind subpaths obscures the choice. The original review was optimizing for surface-area count; the maintainer is optimizing for power-user clarity. These are not the same goal.

### 6. Make `@flow-state-dev/tasks` an internal substrate of `@flow-state-dev/patterns`
**Verdict:** ALREADY DONE.
`task-board/` now lives inside `packages/patterns/src/`, with a capability and substrate role exactly as described. The `@flow-state-dev/tasks` package is gone from main. This recommendation has shipped.

### 7. Cut sequencer DSL from 21 methods to 8 + `compose`
**Verdict:** KEEP-AS-IS, HIDE in intro docs.
The maintainer's framing applies most cleanly here. `forEachBackground`, `thenAny`, `race`, `workIf`, `tapIf`, `loopBack` are not noise — they are the long-tail flexibility the framework exists to provide. A user who never writes `race` doesn't pay for it, but a user who needs it without the framework would have to hand-roll it.
The intro docs problem is real: `sequencers/overview.md` lists 22 methods with no triage. Fix: rewrite the page as "core seven you'll always use" + "advanced methods, by use case." The implementation stays. Note that the *internal* code dedup (Core review's identification of `then`/`thenIf`/`tap`/`tapIf` arg-shape resolution duplication) is unrelated to the user-facing surface and is still worth doing — that's an internal refactor with no API impact.

### 8. Cut item types from 13 to 6
**Verdict:** KEEP-AS-IS, HIDE-IN-DOCS.
The 14-type taxonomy is over-broad for the average user. It is not over-broad for the framework's own observability story or the DevTool. The right move is `streaming/items.md` having a "common items" section (message, reasoning, component, status, error, tool-output) and an "advanced items" section (block_output, router_decision, state_snapshot, block_debug). The cleanup of `BlockValue` ref/inline duplication and other internals is worth doing on its own merits, but the public type count can stay.

### 9. Drop `clientData` for `view` blocks
**Verdict:** KEEP-AS-IS, HIDE in intro.
The original review treated `clientData` as ceremony. It's privilege-separation infrastructure. Most users won't write any `clientData` because the default exposure is appropriate; some users absolutely need the function-form for redaction. Hiding it from quick-start (it currently appears in `flows.md`'s example) is fine. Removing it is throwing out a security primitive because the demo doesn't need it.

### 10. Slim `Resource` to typed key/value
**Verdict:** KEEP-AS-IS.
`flowIsolation`, `dynamic`, `llmReadable`, `allowedExtensions`, `metadata` — these are the kinds of fields that exist because real applications hit those needs. Removing them and saying "write a handler" is exactly the Mastra opinion the framework rejects. The intro docs can show `defineResource({ scope, schema, content? })` and not mention the rest. The advanced page can cover the long tail.

### 11. Drop `starting_after` resume mode
**Verdict:** KEEP-AS-IS, mention only `Last-Event-ID` in intro.
Two resume protocols sounds like noise until you find a deployment context where `Last-Event-ID` is stripped by an intermediary. The intro docs should mention exactly one (Last-Event-ID); the advanced doc mentions both with the rationale.

### 12. Unlock the AI SDK lock; commit explicitly
**Verdict:** REMOVE the lock from the contracts list, KEEP the abstraction.
The maintainer wants to be able to swap providers; the Vercel AI SDK itself is the abstraction that lets that happen, but the `ModelResolver` indirection is a place to plug in non-AI-SDK providers without changing user code. The original review's "drop ModelResolver" was correct under the lens that "no one else implements it" — but the maintainer's framing means we keep the seam open even when the only seam-walker today is the AI SDK adapter. The locked-contracts language can drop "Vercel AI SDK in Phase 1" because that lock now reads as opinion rather than commitment.

### 13. Remove `@flow-state-dev/ui` as first-party
**Verdict:** KEEP-AS-IS package, RECLASSIFY in docs as ecosystem.
Same as skills/tools. UI components are an ecosystem package. The current sidebar has "UI Components" as a top-level category, which front-loads a non-core concept.

### 14. Drop `agentType: "trace"`
**Verdict:** KEEP-AS-IS, HIDE-IN-DOCS.
`agentType: trace` is the seam between user-visible and observability-only generators. Removing it forces every user who writes a non-display generator to wire a parallel trace channel. That's worse, not better. Keep it; mention it in advanced docs only.

### 15. Stop referring to internal Linear IDs in user-facing docs
**Verdict:** REMOVE from docs.
Already in CLAUDE.md as a rule, just not enforced. Mechanical cleanup.

### Summary table

| # | Item | Original verdict | Reclassified |
|---|------|------------------|--------------|
| 1 | Move thought-fabric out of repo | Drop | KEEP-AS-IS, reframe in docs |
| 2 | Drop skills + tools | Drop | KEEP-AS-IS, ecosystem section |
| 3 | Merge devtool into cli | Merge | KEEP-AS-IS, packaging detail |
| 4 | Merge vercel into server | Merge | KEEP-AS-IS, packaging detail |
| 5 | Collapse stores | Merge | KEEP-AS-IS, discoverability wins |
| 6 | Tasks → patterns substrate | Move | DONE (task-board) |
| 7 | Sequencer DSL 21→8 | Cut | KEEP-AS-IS, hide in intro |
| 8 | Item types 13→6 | Cut | KEEP-AS-IS, hide in intro |
| 9 | Drop clientData | Cut | KEEP-AS-IS, hide in intro |
| 10 | Slim Resource | Cut | KEEP-AS-IS, hide in intro |
| 11 | Drop starting_after resume | Cut | KEEP-AS-IS, mention one in intro |
| 12 | Unlock AI SDK | Unlock | REMOVE the lock, KEEP abstraction |
| 13 | Reposition UI | Reposition | KEEP, ecosystem section |
| 14 | Drop agentType: trace | Drop | KEEP-AS-IS, hide in intro |
| 15 | Drop Linear IDs in docs | Cut | REMOVE (mechanical) |

**Net:** under the progressive-disclosure lens, the deletion list shrinks from 15 items to about 3 — the rest is documentation work.

---

## 2. Patterns audit after the cleanup

The original review's claim was "5 of 11 patterns have zero non-test consumers." Let me check that against what's actually in main now.

`grep -rn "from \"@flow-state-dev/patterns" --include=*.ts --include=*.tsx packages/ apps/ examples/` (excluding `/patterns/src/` and tests):

| Pattern (current location) | Non-test consumers (grep result) | Status |
|---|---|---|
| `task-board/` | 1 (kitchen-sink) | Substrate. Used by other patterns internally. |
| `eventActors/` | 1 (kitchen-sink) | Replaces `reactive-blackboard`. Documented. |
| `routedSpecialists/` | 1 (kitchen-sink) | Replaces parts of `blackboard`. Documented. |
| `parallelTasks/` | 0 direct, but coordinator-shim exports it | Documented. |
| `plan-and-execute/` | 1 (kitchen-sink) | Documented. |
| `supervisor/` | 1 (kitchen-sink) | Documented. |
| `response-auditor/` | 1 (kitchen-sink) | Documented. |
| `coordinator/` | 0 (deprecation shim) | Already deprecated. |
| `rlm/` | 0 | No documentation page in the patterns sidebar. |

Patterns that were in the original review's "dead weight" list and are GONE from main: `blackboard/`, `reactive-blackboard/`, `event-queue/`, `drain-pool/`. Four of the five have shipped as removals.

**Reclassified pattern recommendations:**

- **`coordinator/`**: still a deprecation shim. Removing it now is reasonable. The original recommendation stands. Tier 1 work.
- **`rlm/`**: this one is the genuine outlier. No consumers, no docs page, no apparent role in the current pattern story. The maintainer's framing doesn't argue for keeping things that aren't even discoverable. Either write a docs page (if there's a story) or move to `examples/`. Defer the call to the maintainer; do not remove silently.
- **The substrate framing has changed everything else.** The original review counted `task-board` as a candidate for deletion-or-relocation. With the maintainer's framing — "TaskBoard is a powerful concept and an example of something that can be replaced with someone else's implementation on top of the core primitives and it still works" — `task-board` is core to the ecosystem story. Document it as the substrate, not as a pattern.
- **`eventActors`** is described by the maintainer as "the closest thing the framework currently has to event driven patterns and it is a high performer in testing so far." It earns its keep on capability grounds, even if kitchen-sink is the only public consumer today.

**Updated patterns sidebar recommendation:**

```
Patterns
  Overview
  Substrates
    Task Board
    Event Actors workspace
  Composable Patterns
    Routed Specialists
    Parallel Tasks
    Plan and Execute
    Supervisor
    Response Auditor
  Utility Blocks
    Core
    Extensions
```

Drop `coordinator` (deprecated). Drop `rlm` from the sidebar until it has a real story. Add a "Substrates" sub-section that calls out task-board and event-actors-workspace as the two re-implementable substrates so users understand what's foundation vs. what's a recipe.

---

## 3. Proposed docs reorganization

The current sidebar (from `apps/docs/sidebars.ts`) has 14 top-level categories: Getting Started, Fundamentals, Block Sequencing, Resources, Patterns, Items, Server, Client, UI Components, Testing, Dev Experience, Tools, Skills, API Reference. That hierarchy treats every package as a peer. There is no clear "core vs. ecosystem" separation, no clear "intro vs. advanced" separation.

The proposal below has four top-level groups: **Getting Started**, **Core**, **Ecosystem**, **Advanced**. Plus the existing **API Reference** which stays at the bottom.

```ts
// Proposed apps/docs/sidebars.ts
const sidebars: SidebarsConfig = {
  docsSidebar: [
    "intro",  // rewritten — see §4

    // ─────────────────────────────────────────────
    // GETTING STARTED — five concepts max
    // ─────────────────────────────────────────────
    {
      type: "category",
      label: "Getting Started",
      items: [
        "getting-started/quick-start",       // rewritten: handler/generator/sequencer/flow only
        "getting-started/installation",
        "getting-started/setting-up-models", // NEW — replaces buried server/custom-model-resolver
        "getting-started/your-first-flow",   // NEW — narrative walkthrough
        "getting-started/project-structure",
      ],
    },

    // ─────────────────────────────────────────────
    // CORE — @flow-state-dev/core + @flow-state-dev/server
    // The irreducible runtime.
    // ─────────────────────────────────────────────
    {
      type: "category",
      label: "Core Concepts",
      items: [
        "fundamentals/overview",
        "fundamentals/blocks",
        "fundamentals/flows",
        "fundamentals/actions",
        {
          type: "category",
          label: "Sequencing",
          items: [
            "sequencers/overview",         // rewritten: "the seven you'll use"
            "sequencers/control-flow",
            "sequencers/connectors",
          ],
        },
        {
          type: "category",
          label: "State",
          items: [
            "fundamentals/state-and-scopes",   // split into ≤300-line pages first
            "fundamentals/type-system",
          ],
        },
        {
          type: "category",
          label: "Resources",
          items: [
            "resources/overview",
            "resources/storage",
            "resources/collections",
          ],
        },
        {
          type: "category",
          label: "Streaming and Items",
          items: [
            "streaming/overview",
            "streaming/items",
            "streaming/emitting-items",
          ],
        },
        {
          type: "category",
          label: "Server",
          items: [
            "server/setup",
            "server/authentication",
            "server/connection-resilience",
            "persistence/overview",
          ],
        },
        {
          type: "category",
          label: "Client",
          items: [
            "client/overview",
            "client/react",
          ],
        },
        {
          type: "category",
          label: "Testing",
          items: [
            "testing/overview",
            "testing/testing-flows",
          ],
        },
      ],
    },

    // ─────────────────────────────────────────────
    // ECOSYSTEM — patterns, tools, ui, skills, thought-fabric
    // Optional packages built on the core.
    // ─────────────────────────────────────────────
    {
      type: "category",
      label: "Ecosystem",
      items: [
        "ecosystem/overview",   // NEW — explains what counts as ecosystem
        {
          type: "category",
          label: "Patterns",
          items: [
            "patterns/overview",
            {
              type: "category",
              label: "Substrates",
              items: [
                "patterns/task-board",         // NEW page
                "patterns/event-actors",
              ],
            },
            {
              type: "category",
              label: "Composable Patterns",
              items: [
                "patterns/routed-specialists",
                "patterns/parallelTasks",
                "patterns/plan-and-execute",
                "patterns/supervisor",
                "patterns/response-auditor",
              ],
            },
            {
              type: "category",
              label: "Utility Blocks",
              items: [
                "patterns/utility-blocks/core",
                "patterns/utility-blocks/extensions",
              ],
            },
          ],
        },
        {
          type: "category",
          label: "Tools",
          items: [
            "tools/overview",
            "tools/fetch",
            "tools/crawl",
            "tools/bash",
            "tools/mcp",
          ],
        },
        {
          type: "category",
          label: "Skills",
          items: [
            "skills/overview",
            "skills/activation",
            "skills/authoring",
          ],
        },
        {
          type: "category",
          label: "UI Components",
          items: [
            "ui/overview",
            "ui/common-components",
            "ui/flow-aware-components",
            "ui/generative",
          ],
        },
        {
          type: "category",
          label: "Thought Fabric",
          link: { type: "doc", id: "ecosystem/thought-fabric-pointer" }, // NEW pointer page
          items: [],   // Real sidebar lives at /thought-fabric/* (existing sub-site)
        },
        {
          type: "category",
          label: "Dev Experience",
          items: [
            "cli/overview",
            "devtool/overview",
            "devtool/setup",
            "devtool/embedding",
          ],
        },
      ],
    },

    // ─────────────────────────────────────────────
    // ADVANCED — power-user features deliberately deferred
    // ─────────────────────────────────────────────
    {
      type: "category",
      label: "Advanced",
      items: [
        "advanced/capabilities",                 // moved from fundamentals/
        "advanced/flow-isolation",               // moved from fundamentals/
        "advanced/generator-context",            // moved from fundamentals/
        "advanced/voice",                        // moved from fundamentals/
        "advanced/utility-blocks-deprecated",    // the redirect stub stays
        "advanced/sequencer-side-chains",        // moved from sequencers/side-chains
        "advanced/state-targets-and-parents",    // split out of state-and-scopes
        "advanced/sequencer-state",              // split out of state-and-scopes
        "advanced/item-types-reference",         // the full 14-type catalog
        "advanced/agent-types",                  // primary/sub/trace explained
        "advanced/transient-slots",              // the transient marker doc
        "advanced/clientData-redaction",         // the privacy use case
        "advanced/custom-model-resolver",        // moved from server/
        "advanced/model-groups",                 // moved from server/
        "advanced/inbound-transports",           // moved from server/
      ],
    },

    "roadmap",

    // ─────────────────────────────────────────────
    // API REFERENCE — auto-generated, last
    // ─────────────────────────────────────────────
    {
      type: "category",
      label: "API Reference",
      items: [
        "api/core",
        "api/server",
        "api/client",
        "api/react",
        "api/testing",
        "api/cli",
      ],
    },
  ],
};
```

### What moves where, concretely

| Current location | New location | Reason |
|---|---|---|
| `fundamentals/capabilities.md` | `advanced/capabilities.md` | Self-criticizes the per-block style the quick-start teaches. Belongs after the reader knows what they're abstracting from. |
| `fundamentals/flow-isolation.md` | `advanced/flow-isolation.md` | Resource isolation is a power-user concern. |
| `fundamentals/generator-context.md` | `advanced/generator-context.md` | Multi-slot prompt assembly is intermediate, not intro. |
| `fundamentals/voice.md` | `advanced/voice.md` | Voice is an opt-in subsystem, not core. |
| `fundamentals/utility-blocks.md` | `advanced/utility-blocks-deprecated.md` | The redirect stub. Eventually delete. |
| `sequencers/side-chains.md` | `advanced/sequencer-side-chains.md` | Background work is essential capability, but adds a third execution model on top of sync/async. Belongs after the basics. |
| `state-and-scopes.md` (1077 lines) | Split: `fundamentals/state-and-scopes.md` (≤300 lines), `advanced/state-targets-and-parents.md`, `advanced/sequencer-state.md` | Original review item. Splitting was already on the list. |
| `server/custom-model-resolver.md` | `advanced/custom-model-resolver.md` | Replaced in intro by `getting-started/setting-up-models.md` which is opinionated about the common case. |
| `server/model-groups.md` | `advanced/model-groups.md` | Power-user model routing. |
| `server/inbound-transports.md` | `advanced/inbound-transports.md` | Most users use HTTP. Inbound transports are edge cases. |
| `streaming/items.md` (full taxonomy) | `streaming/items.md` (six common) + `advanced/item-types-reference.md` (full 14) | Hide-don't-cut. |
| Tools / Skills / UI / Thought Fabric | All under `Ecosystem` | Not core. |

### What gets created new

- `getting-started/setting-up-models.md` — the "where do I put my OPENAI_API_KEY" page that the original review correctly identified as the single highest-impact missing piece.
- `getting-started/your-first-flow.md` — narrative walkthrough that doesn't fit in the quick-start but doesn't belong with reference material either.
- `ecosystem/overview.md` — the elevator pitch for the ecosystem story.
- `ecosystem/thought-fabric-pointer.md` — bridge page that links to the sub-site at `/thought-fabric/`.
- `patterns/task-board.md` — the substrate doesn't have its own page yet; this fixes that.
- `advanced/agent-types.md` — `primary`/`sub`/`trace` deserves a single page that explains what each tag does and when to set it.
- `advanced/transient-slots.md` — the `transientSlot()` marker doc, currently buried in state-and-scopes.

### Quick-start shape after the change

The five concepts the quick-start should introduce, in order:

1. **Block** (universal unit; four kinds named in passing)
2. **Generator** (one config object; concrete model setup link)
3. **Sequencer** (`.then()` only; nothing else mentioned)
4. **Flow** (`defineFlow` with `actions` and `session.stateSchema` only)
5. **`useSession`** (the React hook; `items` rendered as message text via a default renderer)

Things the current quick-start mentions that the new one does *not*:

- Handler returning input (BP-014 violation gone — drop the counter handler from the example, leave it for the "your-first-flow" walkthrough)
- `agentType` (defaults handle the chat case)
- `clientData` (irrelevant to a chat tutorial)
- `requireUser` (default is fine; document the toggle in the auth page)
- FlowType vs. FlowInstance ceremony (`defineFlow(...)` returns the registerable thing in the new shape; the `({ id })` factory call is hidden by a default)
- Custom `ItemRenderer` (use a built-in `<MessageStream items={...} />` component for the intro; the renderer customization is a separate page)

That gets the quick-start from ~19 introduced concepts to about 6.

---

## 4. The identity statement

The maintainer wants a clear "what is the core" elevator pitch. Working backward from the constraints:

- Honest about being more than the AI SDK (composition, state, streaming-with-resume — these *are* the value).
- Clear about what the core is (`@flow-state-dev/core` + `@flow-state-dev/server`: blocks, flows, state, streaming).
- Clear that ecosystem packages exist as opt-ins (patterns, tools, skills, ui, thought-fabric).
- Anti-opinionated. The framework gives you primitives and gets out of your way.
- Engineer-to-engineer voice (the apps/docs writing rules apply).

Draft 1 (105 words):

> flow-state.dev is a TypeScript framework for building agentic systems out of composable, typed building blocks. The core is small: four block kinds (handler, generator, sequencer, router), four state scopes, items that stream over SSE with sequence-based resume. That's the runtime. Everything else — patterns like supervisor and plan-and-execute, the task-board substrate, tool packs, the React hooks, the cognitive memory layer in Thought Fabric — is ecosystem. You can use the core by itself to ship a streaming chat or an agent with tools. When you outgrow the core's defaults, the ecosystem packages compose on top of the same primitives. Nothing is hidden.

Draft 2 (98 words, tightened, removes a list):

> flow-state.dev is a TypeScript framework for building agents and agentic systems out of typed, composable blocks. The core gives you four block kinds, four state scopes, items that stream over SSE with sequence-based resume, and an HTTP layer that turns a flow into a complete API. With just the core you can ship a streaming chat or an agent with tools. When you need more — supervisor patterns, a task-board substrate, a memory system, a React component pack — the ecosystem packages compose on top of the same primitives. The framework is unopinionated by design. Nothing is hidden.

Draft 2 is the recommendation. It explicitly anchors what the core *is* (kinds, scopes, items, HTTP), states what you can build with just the core, names the ecosystem categories without leaning on them, and lands "unopinionated" + "nothing is hidden" — which together are the framework's actual differentiation against Mastra/LangChain/AI-SDK.

Recommend: replace the first three paragraphs of `apps/docs/docs/intro.md` with this. Keep the "What it looks like" code block and the "Four primitives" table that follow. Drop the empty `## Four primitives` heading on line 14 (existing bug). Move the "Strategies: built to be remixed" laundry list of pattern names — most of which don't exist in the codebase — to the ecosystem overview page; replace it in intro.md with a one-paragraph callout that links to it.

---

## 5. Thought Fabric positioning audit

Today, `apps/docs/thought-fabric/introduction.md` opens with: *"flow-state-dev gives you blocks, flows, state, and streaming. Those are execution primitives. They don't have opinions about how an agent should think. Thought Fabric is the cognitive layer. It's a separate framework built on top of flow-state-dev that models how agents manage attention, form memories, develop identity, perceive their environment, and reason about problems."*

This is *exactly* the framing the maintainer wants. The thought-fabric introduction does the right thing already — it explicitly says "separate framework," "built on top of flow-state-dev." The framework's main intro page is the part that's miscalibrated, not thought-fabric's intro.

What needs to change:

- **Main `intro.md` line 159–167** ("Thought Fabric is what the primitives make possible when you push them. A full cognitive architecture..."): the framing "Not a feature of the framework. Proof of concept." is good; the placement is bad. Today this is the second-to-last section before "Get started," which puts it visually peer with the rest of the framework story. Move this to a one-line callout near the bottom: "An optional cognitive layer ships separately as Thought Fabric — see [Thought Fabric →]." That's enough to acknowledge it without claiming it as core.
- **Memory layer separation:** the maintainer says "the memory layer is real" while constitution/perspective is more research. Today the introduction lists Memory as "Shipped" and Identity as "Shipped (partial)" — that distinction is already there but lightly weighted. Recommend: rewrite the introduction to lead with Memory as "stable, used in production-shaped flows" and frame Attention/Identity/Metacognition as "research surfaces, evolving." Don't bury the value; rank it.
- **`@thought-fabric/core` README:** opens with the four-domain table that has Identity and Metacognition both as "(partial)." That's accurate; keep it. Add a "stable surface" callout pointing at the memory subpath import (`@thought-fabric/core/memory`) as the recommended consumption path for non-research uses.
- **CLAUDE.md naming-convention rules** for thought-fabric (the `workingMemory[Verb]` vs `[verb]WorkingMemory` rules) are fine to keep — but they're naming conventions for the *thought-fabric* package, not the framework. They should live in `packages/thought-fabric-core/AGENTS.md` or its README, not in the top-level CLAUDE.md. Today they live in CLAUDE.md and conflate "framework rules" with "package-specific rules."

**Net call:** the docs are already saying the right thing about thought-fabric in thought-fabric's own intro. The fix is two paragraphs in the framework's main intro and a section move in the framework's sidebar. The package itself stays. Memory's "real" status is already documented; just lean into it harder.

---

## 6. Is the core useful by itself?

If a user installed only `@flow-state-dev/core` and `@flow-state-dev/server`, what could they ship?

Walking through what they get from `core`:

- `handler`, `generator`, `sequencer`, `router` block factories
- `defineFlow` with `actions`, `session/user/project/request` state scopes, `resources`, lifecycle hooks
- The full sequencer DSL (21 methods)
- `defineCapability`, `defineResource`, `defineResourceCollection`
- The model resolver with AI SDK adapter and "preset/fast" / "preset/main" defaults
- All 14 item types and the SSE event shape
- Capability factory + presets
- Utility blocks (the prebuilt summarizer/analyzer/classifier set, exported from core under `utility/`)

And from `server`:

- `createExecutionContext`, the runtime
- Streaming with SSE + sequence-based resume + reconnect
- `createFlowRegistry` + `createFlowApiRouter` (the Next.js-shaped catch-all)
- Authentication hooks
- In-memory store implementation (no extra packages required for dev)

**Streaming chat:** Yes, completely. Quick-start works with just these two packages plus `@flow-state-dev/react` for the hooks. No pattern, tool, or ecosystem package needed. The example in the current quick-start is exactly this shape.

**Agent with tools:** Yes. Tools in the framework are just blocks. Define a handler, hand it as a `tools: [searchHandler]` to a generator, done. The user does not need `@flow-state-dev/tools` (which is just a curated set of pre-built handlers for popular search providers — convenience).

**Multi-step agent (plan, then execute, then synthesize):** Yes. Compose with `sequencer().then(plan).then(execute).then(synthesize)`. The `plan-and-execute` pattern from `@flow-state-dev/patterns` is a more sophisticated version with replanning, but the user can ship a v1 without it.

**Background work alongside streaming:** Yes. The sequencer DSL has `.work()` for non-blocking sidechains.

**Resumable streaming after disconnect:** Yes, built into the server's SSE layer.

**State accumulating across sessions / users:** Yes — all four scopes plus CAS.

**What you can't ship without ecosystem packages:**

- Postgres or SQLite persistence (need `@flow-state-dev/store-postgres` or `store-sqlite`)
- React UI (need `@flow-state-dev/react`)
- Vercel-specific SSE plumbing (need `@flow-state-dev/vercel`, though arguably the core SSE works on Vercel too)
- Memory beyond what conversation history provides (need `@thought-fabric/core/memory`)
- The supervisor, plan-and-execute, etc. recipes (need `@flow-state-dev/patterns`)

**Honest assessment:** The core is genuinely useful by itself for the chat-app and basic-agent cases, which is most users' first month. It is *not* useful by itself for production deployment because the in-memory store is dev-only — you need a store adapter package. That dependency is mild though: pick one store package, install it, configure it, done.

This validates the maintainer's intuition. The core *is* useful by itself. The framing problem is that the docs structure today doesn't make this obvious — the user lands on a sidebar where Skills, Tools, UI, and Thought Fabric all sit at the same conceptual level as Server and Client, and they have to infer which is the irreducible runtime.

The proposed sidebar reorg fixes exactly this. After the reorg, "what's core" is a top-level group; "what's ecosystem" is a different top-level group. A user who scans the sidebar can see the boundary in five seconds.

---

## 7. What to do first — top 5 concrete actions

In order of leverage. Each is a few hours to a day of work, none break public APIs.

### 1. Rewrite `apps/docs/docs/intro.md` against the identity statement

Replace the opening with the identity statement from §4. Fix the empty `## Four primitives` heading. Move the Thought Fabric block from a peer-section to a one-line callout near the bottom. Replace the "Strategies: built to be remixed" laundry list (which mostly names patterns that don't ship) with a link to a future ecosystem overview page.

### 2. Reorganize `apps/docs/sidebars.ts` per §3

The mechanical changes: introduce four top-level groups (Getting Started, Core, Ecosystem, Advanced), reparent existing pages into them per the table in §3, create the small set of new pages identified there. Most pages don't move *files*; they move *categories*. This is mostly editing one TypeScript config file plus a small handful of new markdown stubs.

### 3. Fix the quick-start

Apply the changes called out in §3: drop the BP-014-violating handler, drop the `agentType` rule contradiction (defaults handle it), drop the FlowType vs. FlowInstance ceremony, drop `clientData` from the example, add a one-paragraph "configure your model provider" link/callout, replace `<ItemRenderer>` with a default `<MessageStream>` (or whatever the simplest render-the-stream component is). Get the introduced-concept count from ~19 to ~6.

### 4. Split `state-and-scopes.md` and write the model setup page

`state-and-scopes.md` at 1077 lines is a structural failure regardless of which review lens you apply. Split into Scopes (overview), State operations, Resources, and an Advanced page covering targets and sequencer state. Separately, write `getting-started/setting-up-models.md` — the page whose absence means the quick-start cannot literally be run by a new user.

### 5. Patterns sidebar restructure + drop two

In `packages/patterns/`: remove the `coordinator/` deprecation shim (Tier 1 from the original review, uncontroversial). Decide on `rlm/` (move to examples or write a docs page). Update the patterns sidebar in `apps/docs/sidebars.ts` per §2 — add a "Substrates" subsection for task-board and event-actors-workspace, add a `patterns/task-board.md` page, drop coordinator from the listed patterns.

---

## Closing

The original review's biggest miscalibration was treating "minimal surface area" as the goal. That's the goal of frameworks that have an opinion about how you should build (Mastra, LangChain's prebuilt agents). flow-state-dev's chosen identity is the opposite: lots of capabilities, lots of substrates, lots of opt-in ecosystem — but a small core that's enough to ship with, and progressive disclosure for everything else.

Under that lens, most of the original review's prescriptions are still good, but as docs surgery rather than code surgery. The framework already has ~80% of what it needs; the docs just don't reveal it as such. A user landing on a sidebar with a clear Core / Ecosystem / Advanced split will internalize the framework's actual shape in the first scroll. The same user landing on the current sidebar — where Tools, Skills, UI Components, and Thought Fabric all sit at peer level with Server and Client — will assume the framework is asking them to learn fourteen things and will close the tab.

The simplification path is real. It's just mostly a documentation reorganization and a few page rewrites — not a refactor.
