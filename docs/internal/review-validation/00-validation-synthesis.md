# Validation Synthesis — What Held, What Didn't, What's New

A six-validator second pass against the original team-synthesis (`/docs/internal/review/00-team-synthesis.md`), prompted by the maintainer's pushback on specific findings. Each validator went back to the code, weighed the maintainer's pushback fairly, and rendered a verdict.

The headline: **the framework's identity is "production-grade with progressive disclosure," not "minimal surface area."** The original review was written against the latter goal. Re-reading the same evidence with the right lens flips many of the recommendations from "remove" to "keep but hide in docs." The simplification target is the **first-hour experience**, not the API. Most of the work is editorial.

But three original findings sharpened into stronger calls than the first review made, and one new structural finding emerged that the first team missed entirely.

## The team's reports

| # | Validator focus | File |
|---|-----------------|------|
| 01 | State scopes (request/session/user/org) | `01-state-scopes-validated.md` |
| 02 | Handler discipline & block boundary | `02-handler-discipline-validated.md` |
| 03 | DSL ergonomics (branch vs thenIf, schemas) | `03-dsl-ergonomics-validated.md` |
| 04 | Items, observability separation, clientData privacy | `04-items-and-clientdata-validated.md` |
| 05 | Tools/utility, getTarget, package count, project→org | `05-tools-utility-packages-validated.md` |
| 06 | Identity, progressive disclosure, docs reorg | `06-identity-and-progressive-disclosure.md` |

Read the individual reports for code citations. This document is the reconciled call.

---

## Findings retracted from the original review

These are claims the validation team rejected after going to the code. Treat the originals as overruled.

### State scopes: 3 of 4 original claims retracted

The original review's Tier 3 item 24 ("collapse `request`/`session`/`user`/`org` to `session` + `identity`") was wrong on every axis except the editorial one.

- **Drop `request` scope** — rejected. A bare-handler action has `ctx.request` but no `ctx.sequencer`. They are not interchangeable. Two production consumers prove the lifetime distinction: the MCP capability bubbles a `requestStateSchema` for per-turn tool filtering (`packages/tools/src/mcp/capability.ts:61-79`), and the tasks pattern README is explicit that "sequencer-backed collections lose their state at each sequencer-invocation boundary because sequencer state is per-instance" — request scope exists precisely to fix that. The original review confused `transientSlot()` (a serialization marker on sequencer state) with a request-scope substitute.
- **Collapse user + org** — rejected. They are structurally asymmetric: org binding is immutable per session (`OrgBindingMismatchError` enforces it); a user belongs to themselves regardless of org. The maintainer's framing — "users could roll into org, the way a `users` collection might roll into a `projects` collection" — is closer to the architectural truth.
- **Default user state to flow-isolated** — rejected. The kitchen-sink's two flows (`chat-agent` and `rich-text-component`) deliberately share user state so memories captured in chat can be recalled in personalization. Reversing the default would gut a flagship integration. The cross-flow registry exists to make sharing safe, not to clean up after a bad default.
- **State + resources duality** — partially right. Both primitives earn their keep; schema bubbling is load-bearing for the framework's "blocks declare their needs and the framework wires it up" pitch. The complexity the original review noticed is real but lives in *documentation*, not in the primitive set.

**Net call:** keep all four scopes. Keep state and resources as separate primitives. The editorial fix (lead with session, defer request/org to advanced) is the right one; the structural change is wrong.

### DSL: collapse-into-`branch()` and cut-to-8 retracted

- **Collapse `thenIf`/`tapIf`/`workIf`/`exitIf` into `branch(condition, if, else)`** — rejected. The four methods sit at three different points along two axes (does the block's output replace the chain value? does the main chain block on it?). A unified `branch` either drops semantic distinctions or grows into a mode-flagged super-method that's worse than the four current methods combined. Validator 03 wrote out the toy rewrite — it does not work without weakening the type-level guarantee that a `tap` arm doesn't change chain output.
- **Cut `loopBack`** — rejected. Three patterns (`task-board`, `routedSpecialists`, `plan-and-execute`) actively use it. The pattern is "re-run a named segment until convergence," which `doUntil`/`doWhile` do not model.
- **Schemas are required ceremony on toy handlers** — rejected. `build-block.ts:131-132` defaults `inputSchema` and `outputSchema` to `z.any()`. They are opt-in for type inference, not required for runtime. The friction the review described is the cost of opting into the type system, which is what people use the framework for.
- **Cut DSL from 21 methods to 8** — reframed. Two genuine deletions (`validate()` is dead-code-adjacent with a broken `_def.typeName` heuristic; `background()` is a literal one-line alias for `work()`). The other 19 methods earn their keep at the pattern level even when they don't appear in `apps/kitchen-sink`. The fix is documentation tiering: a 6-method beginner page (`then`, `map`, `tap`, `thenIf`, `work`, `rescue`) plus an advanced reference for the rest.

### Tools and utility are different categories

- **Merge `@flow-state-dev/tools` with `core/utility`** — rejected. `tools` is third-party-API integrations (Tavily, Exa, Perplexity, Firecrawl, Jina, MCP, bash sandboxes) designed to be passed into a generator's `tools` slot — invoked by the LLM at runtime. `utility` is parameterized block factories (summarizer, decomposer, intentClassifier, upsertResource) the developer positions on a sequencer chain at build time. The categories are different in *call site*, not just adapter pattern.

### `getTarget` / `targetStateSchemas` are load-bearing

- **Drop `getTarget` as an escape hatch** — rejected. The `taskBoard` pattern depends on `ctx.getTarget(boardName)` for its collection helper to find the board's state ref from inside nested blocks. There is no clean substitute for "named ancestor handle" that traverses several levels.
- **Soft-deprecate `ctx.parent.input`** — accepted. The kitchen-sink team has already TODO'd a refactor away from it (`apps/kitchen-sink/flows/chat-agent/blocks/artifacts.ts:173`). Connectors are the right replacement. Don't remove from the type — there will always be edge cases — but stop showing it in examples.

### Package consolidation reframed as docs reorganization

- **Cut from 16 packages to 7** — rejected as code change. Adopted as docs framing. The maintainer's instinct is right: package count is a presentation problem, not a packaging problem. Discrete packages with their own READMEs make the choice explicit; bundling them behind subpaths obscures the choice.
- **Drop `@thought-fabric/core`, `skills`, `tools`, `ui`, `vercel`** — rejected as packages. Reposition in docs as ecosystem.

### "Expose all + hidden list" clientData default is wrong

- The original recommendation picks the wrong default for production-grade software. New fields silently leak. The maintainer's instinct ("private by default") is correct.

---

## Findings sustained or strengthened

### Quick-start documentation is broken (sustained, sharper)

The original review identified BP-014 violation, agentType contradiction, dead heading, and missing model setup. All confirmed. Validator 06 added: the quick-start currently introduces ~19 concepts where it should introduce 5–6. The fix is editorial — a rewrite that drops the BP-014-violating counter handler, drops `agentType` mention (defaults handle the chat case), drops `clientData` from the example, adds a one-paragraph "configure your model provider" link, and uses a default `<MessageStream>` instead of a custom `<ItemRenderer>`.

### `validate()` and `background()` are deletable

- `validate()` (sequencer.ts:1859-1889) — broken `_def.typeName` heuristic, zero callers. Delete.
- `background()` (sequencer.ts:1381-1387) — literal `return definition.work(...)` alias. Delete.

### Trace channel separation is a real simplification

Validator 04 confirmed: `block_output`, `router_decision`, `state_snapshot`, `block_debug` are devtool-consumed in practice. Production code paths use `siblingRegistry` (in-process), `component` items, or the resource snapshot — not the items log. The `BlockValue<T>` ref machinery exists purely as a wire-protocol compression for persisted item storage; if those types move to a parallel trace channel that's only attached when the devtool connects, the union shrinks to two cases (inline / structure) on the public surface. This is a refactor that *moves* complexity from `core/items` to `server/streaming` (the trace publisher) and the devtool boundary, not a pure deletion — but the user-facing surface gets meaningfully smaller.

### `state_change` / `resource_change` have shared structure

Full consolidation widens the operation union to 9 values with conditional fields ("patch on a resource" is meaningless). Better: factor out an `InvalidationItem` base for shared `scope`/`delta`/`version`, keep typed leaves. ~30% duplication reduction without conflating semantics.

### project→org rename is incomplete

Validator 05 cataloged leftovers:
- Confirmed in test fixture: `flow-state-inference.type-test.ts:22,36` (`projectStateValue`).
- ~14 internal variable names in `packages/server/src/context/createExecutionContext.ts`.
- Test fixtures in `flow-isolation.test.ts` and `registry-routes.test.ts` (`projectLabel`/`projectInfo` keys look like real-surface leftovers).
- 14+ user-facing pages in `apps/docs/docs/` still describe a "project" scope. Highest-impact leftover.
- Maintainer-decision items: filesystem `projects` directory, CLI `--seed-project` flag.

### Patterns: most "dead weight" already shipped as removals

Of the original review's 5 "dead weight" patterns, four (`blackboard`, `reactive-blackboard`, `event-queue`, `drain-pool`) are gone from main. Remaining cleanup: `coordinator/` (deprecation shim, safe to remove) and `rlm/` (no consumers, no docs page — defer to maintainer call).

The current 8-pattern landscape is healthier:
- `task-board/` and `eventActors/` — substrates the maintainer described as "powerful concepts and examples of things that can be replaced with someone else's implementation on top of the core primitives."
- `routedSpecialists/`, `parallelTasks/`, `plan-and-execute/`, `supervisor/`, `response-auditor/` — composable patterns.
- `coordinator/` — deprecated.
- `rlm/` — orphaned.

---

## New findings the original team missed

### `clientData` privacy story is broken today

This is the most surprising finding. `docs/architecture/overview.md:135` says: *"Raw state never reaches the client. This is deliberate: you can't accidentally leak internal state because `clientData` is the sole data gateway."*

The code does not match. `packages/server/src/routes/state-routes.ts:227-249` returns `state: { request, session, user, org }` raw, alongside `clientData`. The client-typed contract (`packages/client/src/types/index.ts:209`) declares both. There is no filtering, no allowlist.

So `clientData` today is a derived-views convenience that ships *alongside* raw state, not in place of it. The friction is real (kitchen-sink writes a 22-line projection function); the privacy framing is aspirational.

**The fix is two-part, not one:**
1. Make the doc true. Stop returning raw state from `state-routes.ts`.
2. Evolve the API: `clientData: { name: fn }` becomes `client: { expose: string[], derived: { name: fn } }`. Mirror resource-level `client.data`. Sequencer state and resources without a `client` config remain as private-by-default escape hatches (the supervisor pattern is the canonical example).

### The handler/block boundary leak is structural, not editorial

The original review framed handler-vs-sequencer as "genuinely ambiguous in practice." Validator 02 sharpened the diagnosis: the ambiguity exists *only because* the public block type permits the escape hatch. `BlockDefinition.run(input, ctx)` is on the type that users hold, and the handler's own `ctx` matches what `run` accepts.

Audit results:
- One real production violation in shipped first-party code: `packages/core/src/utility/intent-router.ts:78` (a handler calls `classifier.run(input, ctx)`).
- One sanctioned-by-design helper that endorses the anti-pattern: `packages/tasks/src/helpers/dispatch-and-execute.ts:142` whose docstring tells callers to invoke it inside handler bodies.
- JSDoc `@example` blocks in `thought-fabric-core` teaching `block.run(...)` as a user-facing API.

**The cheapest correct fix is a type-level firewall.** Split `BlockDefinition` (public) from `BlockRuntime` (internal substrate dispatch surface, with `_run`). Substrate (`executeBlock`, `sequencer`, `router`, `generator` tool loop, CLI's `fsdev block run`) imports `BlockRuntime`. Users hold `BlockDefinition` and cannot reach `_run` from a handler. ~300 LOC touched. Makes BP-011 a TypeScript error in the entire codebase.

This is the cheapest move that decisively closes the ambiguity. Everything else (lint rule, runtime guard) is belt-and-braces for cases that slip past TS.

### The four-kind taxonomy is clean if and only if handlers can't call blocks

This is the consequence of the previous finding. Once `_run` is invisible to userland:
- Handlers do bounded work with their own ctx.
- Sequencers compose.
- Routers dispatch one of N.
- Generators run LLM calls with the framework's tool loop.

There is no overlap. The original review's "should this be a handler or a sequencer?" question stops being ambiguous because the answer is structural: if you need to invoke another block, you write a sequencer.

The Inngest-style permissive alternative (allow `block.run` in handlers, require idempotency for the future durable resume runtime) is also viable, but trades crispness for flexibility and has not been chosen — `state_snapshot` is already emitted at sequencer step boundaries, which is the right primitive for the strict stance.

---

## Refined action plan (supersedes the original team-synthesis)

### Tier 1 — pure deletes and edits (no API impact)

Effort: ~3 days. Risk: minimal. Each item is independently shippable.

1. **Delete `validate()` and `background()` from sequencer DSL.** Broken heuristic + literal alias. Confirmed via callers count and code inspection.
2. **Delete `coordinator/` pattern.** Already a deprecation shim.
3. **Defer `rlm/` to maintainer call.** No consumers, no docs page — either write a docs page (if there's a story) or move to `examples/`.
4. **Fix the existing BP-011 violation in `intent-router.ts:78`.** Refactor as a sequencer composition. Single file.
5. **Stop teaching `block.run(...)` in `@thought-fabric/core` JSDoc examples.**
6. **Audit and prune `core/index.ts` re-exports** for dead inference-helper types and `@deprecated` aliases (per original Core review). Carries over.
7. **Mechanical project→org renames** (per Validator 05 catalog): `flow-state-inference.type-test.ts` variable, ~14 internals in `createExecutionContext.ts`, test fixture parameter names. Skip the maintainer-decision items.
8. **Remove internal Linear IDs from user-facing docs.** Already in CLAUDE.md as a rule.

### Tier 2 — editorial work (the bulk of the value)

Effort: ~1–2 weeks. Risk: low. This is the disproportionate-impact tier.

9. **Rewrite `apps/docs/docs/intro.md` against the identity statement.** Validator 06's draft 2:

   > flow-state.dev is a TypeScript framework for building agents and agentic systems out of typed, composable blocks. The core gives you four block kinds, four state scopes, items that stream over SSE with sequence-based resume, and an HTTP layer that turns a flow into a complete API. With just the core you can ship a streaming chat or an agent with tools. When you need more — supervisor patterns, a task-board substrate, a memory system, a React component pack — the ecosystem packages compose on top of the same primitives. The framework is unopinionated by design. Nothing is hidden.

   Fix the empty `## Four primitives` heading. Move the Thought Fabric block from a peer-section to a one-line callout near the bottom.

10. **Reorganize `apps/docs/sidebars.ts` into four top-level groups**: Getting Started, Core, Ecosystem, Advanced. Move `capabilities`, `flow-isolation`, `generator-context`, `voice`, `agent-types`, `transient-slots`, `clientData-redaction`, `custom-model-resolver`, `model-groups`, `inbound-transports`, `state-targets-and-parents`, `sequencer-state`, `item-types-reference` to Advanced. Move `tools`, `skills`, `ui`, `thought-fabric` to Ecosystem. The proposed sidebar is in `06-identity-and-progressive-disclosure.md` §3.

11. **Rewrite the quick-start.** Drop the BP-014-violating counter handler. Drop `agentType` (defaults handle chat). Drop `clientData` from the example. Drop FlowType-vs-FlowInstance ceremony. Add a one-paragraph "configure your model provider" link to a new `getting-started/setting-up-models.md`. Replace `<ItemRenderer>` with a default `<MessageStream>`. Concept count: 19 → 6.

12. **Split `state-and-scopes.md`** (1,077 lines) into Scopes (overview), State operations, Resources, and Advanced (targets/sequencer-state).

13. **Write `getting-started/setting-up-models.md`.** The single highest-impact missing page — without it, the quick-start cannot literally be run by a new user.

14. **Update user-facing docs for project→org.** 14+ pages in `apps/docs/docs/` still describe a "project" scope. Highest-impact rename leftover.

15. **Document the auth contract loudly.** The framework trusts the application's `userId`. Cross-user data access is the application's problem to solve. Position the cross-flow registry as the mechanism that makes shared-by-default *safe*, not as cleanup machinery.

16. **Tier the sequencer DSL docs** into "Composing blocks" (`then`, `map`, `tap`, `thenIf`, `work`, `rescue`) and "Control flow reference" (the other 14). Stop presenting all 22 with equal weight.

17. **Add a "Substrates" subsection to the patterns sidebar** — `task-board` and `eventActors` are substrates, not patterns. Write `patterns/task-board.md`. Reframe overview accordingly.

18. **Reposition Thought Fabric in the framework's main intro** as a one-line ecosystem callout. Lean harder into the "memory layer is real, attention/identity/metacognition are research surfaces" distinction. Keep the package; reframe the framing.

### Tier 3 — focused refactors (preserve public APIs, change internals)

Effort: ~1 month. Risk: low-medium per item.

19. **Type-level firewall on `BlockDefinition.run`.** Split `BlockDefinition` (public) from `BlockRuntime` (internal). Substrate imports `BlockRuntime`; users hold `BlockDefinition`. Makes handler-internal `block.run(...)` a TypeScript error. ~300 LOC. Plus a runtime guard in `executeBlock` (Tier 3 from Validator 02) for `any`-cast escapes — ~30 LOC, belt-and-braces.

20. **Refactor `dispatchAndExecute` from a free function into a block factory.** Returns a sequencer; patterns `.then(dispatchAndExecuteBlock(...))` it. Removes the framework's most explicit endorsement of handler-internal block calls.

21. **Fix the `clientData` privacy hole.** Stop returning raw state from `state-routes.ts:227-249`. Then evolve the API: `clientData: { name: fn }` → `client: { expose: string[], derived: { name: fn } }`. Match resource-level `client.data` so there's one mental model.

22. **Trace channel separation.** Move `block_output`, `router_decision`, `state_snapshot`, `block_debug` to a parallel SSE channel that opens only when the devtool attaches. Strip the `BlockValue.ref` kind from the public `OutputItem` shape (keep `inline | structure`). Producing API splits into `ctx.emit.<production>` and `ctx.emit.trace.<trace>`.

23. **Factor out `InvalidationItem` base** for `state_change`/`resource_change`. Shared `scope`/`delta`/`version`; keep typed leaves.

24. **Internal sequencer DSL kernel rewrite** (carried from original Core review). Three primitives (`runChild`, `runBackground`, `resolveCallShape`) replace 12 hand-rolled methods. `sequencer.ts` from 1,934 to ~600–800 LOC. Public surface unchanged. Worth doing, even though we no longer cut the public method count.

25. **Extract `core/models/` to `@flow-state-dev/models`** (carried). 3,113 LOC out of `core`. Re-export with deprecation note for one minor version.

26. **Extract `server/voice/` to `@flow-state-dev/voice`** (carried). 457 LOC out of `server`.

27. **Streaming internals: adopt `hono/streaming`** for SSE framing + heartbeat (carried). Public emitter API unchanged. ~250 LOC removed.

28. **Replace `execution/retry.ts` with `p-retry`** (carried). ~120 LOC removed.

29. **Replace `routes/parseFlowRoute.ts` + dispatcher with a Hono `Hono` instance** (carried). Public `{ GET, POST, PATCH, DELETE }` shape preserved. ~400 LOC removed.

### Items NOT in the new plan

These were in the original synthesis and the validation team retracted them:

- ~~Collapse `request`/`session`/`user`/`org` to `session` + `identity`.~~
- ~~Default user state to flow-isolated.~~
- ~~Drop `request` scope as a public concept.~~
- ~~Cut sequencer DSL from 21 methods to 8 + `compose`.~~
- ~~Cut `loopBack`.~~
- ~~Collapse `thenIf`/`tapIf`/`workIf`/`exitIf` into `branch(condition, if, else)`.~~
- ~~Merge `tools` and `utility`.~~
- ~~Drop `getTarget` as an escape hatch.~~
- ~~Move `@thought-fabric/core` out of the repo.~~
- ~~Drop `@flow-state-dev/skills` and `@flow-state-dev/tools` from the framework.~~
- ~~Reposition `@flow-state-dev/ui` as not-first-party.~~
- ~~Slim `Resource` to typed key/value.~~
- ~~"Expose all + hidden list" clientData default.~~
- ~~Drop `agentType: "trace"`.~~
- ~~Drop `starting_after` resume mode.~~ (Both stay; intro mentions one.)

The pattern: most original-review removals were re-classified as "keep but hide in intro docs." Progressive disclosure replaces minimization.

---

## What changed about the framework's identity

The original review framed flow-state-dev as competing on simplicity (against Mastra, AI SDK). That framing was wrong. The framework was built *because* Mastra's opinions did not survive contact with real applications. The framework competes on **power preserved by progressive disclosure**: lots of capabilities, lots of substrates, lots of opt-in ecosystem, but a small core that's enough to ship with.

Under that lens:

- "Cognitive load is too high" is real — but the fix is teaching three concepts in the intro and 30 elsewhere, not having 30 fewer concepts.
- "Sequencer DSL has 21 methods" is real — but only `validate` and `background` are deletable. The rest earn keep at the pattern level. The intro should teach 6.
- "13 item types" is real — but production code uses 11 and trace uses 4. The fix is channel separation, not type reduction.
- "16 packages" is real — but consolidation hides ecosystem optionality. The fix is sidebar reorg with explicit `Core:` and `Ecosystem:` prefixes.
- "Vocabulary is too large" is real — but each named concept defends a real distinction (state vs resources, user vs org, trace vs production, tools vs utilities). The fix is what the docs put in the reader's first hour, not what the framework defines.

The honest assessment of "is core useful by itself?" — yes. With just `@flow-state-dev/core` + `@flow-state-dev/server` + `@flow-state-dev/react`, a user can ship a streaming chat, an agent with tools, a multi-step pipeline with replanning, background work alongside streaming, resumable streaming after disconnect, and state accumulating across sessions/users. They cannot ship Postgres persistence without a store adapter — but that's a focused dependency, not a question of identity.

The proposed sidebar reorganization makes "what's core" visible in the first scroll. Today's sidebar puts Tools, Skills, UI Components, and Thought Fabric at peer level with Server and Client, and a newcomer has to infer which is the irreducible runtime. That inference is what makes the framework feel sprawling. The fix is editorial, and it's the highest-leverage move on the entire list.

---

## Closing call

The validation team's net effect is to retract about 60% of the original review's structural recommendations, sharpen 20%, and discover one new structural finding (the `BlockDefinition.run` leak) plus one new factual finding (the clientData privacy story doesn't match its docs).

Most of the work is editorial. The first-hour experience can move from 19 introduced concepts to 6 with intro/quick-start/sidebar rewrites that take 1–2 weeks. The handler-discipline fix is a focused refactor with a type-system payoff. The clientData privacy fix is a one-line route change followed by an API rename. Trace channel separation is a real refactor but bounded.

The framework's complexity is not accidental. The validation team reaffirmed at every primitive that the simplicity available is the simplicity the framework already provides — what's missing is a docs structure that exposes it that way. That's good news: the path forward is mostly editing, not refactoring, and it's achievable in a month of focused work without breaking any public API.
