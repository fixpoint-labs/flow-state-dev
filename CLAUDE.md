# General Personality

You are not a sycophant. You don't tell the user they have a good idea until you have considered its pros and cons and determined if it really is an improvement or not.

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

## 5. Tests verify intent, not just behavior

Tests must encode WHY behavior matters, not just WHAT it does.
A test that can't fail when business logic changes is wrong.

## 6. Surface conflicts, don't average them

If two patterns contradict, pick one (more recent / more tested).
Explain why. Flag the other for cleanup.
Don't blend conflicting patterns.

## 7. Read before you write

Before adding code, read exports, immediate callers, shared utilities.
If unsure why existing code is structured a certain way, ask.

## 8. Match the codebase's conventions, even if you disagree

Conformance > taste inside the codebase.
If you think a convention is harmful, surface it. Don't fork it silently.

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

# @flow-state-dev — Implementation Repo

`@flow-state-dev` is a TypeScript block-based AI workflow framework. This is the active implementation workspace for Phase 1 (Foundation).

## Orientation

**Read first (every session):**

1. `docs/philosophy.md` — How we build FSD: the tenets, the apex of the grounding (BPs derive from it)
2. `docs/architecture/overview.md` — System architecture and package roles
3. `docs/contributing/architecture-reference.md` — Locked contracts quick reference
4. `AGENTS.md` — Process protocol and code style rules

**Verifying flow changes**: When you change flow logic, the default verification is `fsdev run` (see `AGENTS.md` → "Verifying flow changes during development"). Reach for `pnpm test` only for unit-level changes; reach for kitchen-sink in a browser only for UI-layer changes.

**Read when relevant:**

- `docs/architecture/items.md` — **Read before touching items, rendering, or the stream.** Complete item type registry, classification, and rendering contracts.
- `docs/architecture/*.md` — Deep dives into blocks, flows, state, streaming, execution, etc.
- `docs/contributing/best-practices.md` — Universal BPs + the situational index; per-category situational BPs live in `docs/contributing/best-practices/<category>.md` (open the category file for the area you're touching). Universal BPs are mirrored in this file's "Best practices" section.
- Per-package `CHANGELOG.md` files and `docs/contributing/release-notes-workflow.md` — what shipped and how new changes get recorded
- `packages/*/README.md` — Per-package API docs

## Package Map


| Package                             | Purpose                                                                 |
| ----------------------------------- | ----------------------------------------------------------------------- |
| `@flow-state-dev/contracts`         | Zero-dependency shared layer (item taxonomy, leaf types, block-instance-id); re-exported by `core` |
| `@flow-state-dev/core`              | Isomorphic builders, type contracts, item taxonomy                      |
| `@flow-state-dev/engine`            | Execution runtime, stores, SSE streaming, HTTP routes                   |
| `@flow-state-dev/client`            | Isomorphic API client (actions, sessions, streams)                      |
| `@flow-state-dev/react`             | React hooks and renderers (wraps client)                                |
| `@flow-state-dev/testing`           | Test harnesses and mocks                                                |
| `@flow-state-dev/integration-tests` | Tier 1 flow integration suite (private)                                 |
| `@flow-state-dev/cli`               | Terminal interface (`fsdev`)                                            |
| `@flow-state-dev/devtool`           | Pre-built DevTool assets for `fsdev dev`                                |
| `@flow-state-dev/store-sqlite`      | SQLite-backed persistent store                                          |
| `@flow-state-dev/vercel`            | Vercel deployment adapter (SSE shaping, heartbeats, runtime config)     |
| `@flow-state-dev/tools`             | Reusable tool blocks                                                    |
| `@flow-state-dev/orchestration`     | Task substrate, dispatchers, the task-board primitive, and the skills runtime |
| `@flow-state-dev/workforce`         | Agent registry, personas, and materialization (Layer 2 on orchestration) |
| `@flow-state-dev/patterns`          | Higher-level composition patterns (built on the task board)             |
| `@flow-state-dev/memory`            | Cross-turn memory system (working / episodic / semantic / digest tiers) |
| `@flow-state-dev/ui`                | Component registry for flow UIs                                         |
| `@thought-fabric/core`              | Cognitive architecture primitives (attention, identity)                 |
| `apps/devtool`                      | DevTool source app (builds into `@flow-state-dev/devtool`)              |
| `apps/docs`                         | Documentation site (Docusaurus)                                         |


## Documentation Structure

```
docs/
  architecture/     Framework architecture reference (13 docs)
  contributing/     Development setup, best practices, wave process
  internal/         Wave plans, journals, changelogs (process artifacts)
```

## Skills Library

Development task skills live in `agents/skills/` — the harness-neutral home, since Claude is our main harness but not our only one. `.claude/skills` is a symlink to it so Claude Code's skill discovery keeps working; don't put files under `.claude/skills` directly. Use these when performing common development tasks:

### Workflow skills


| Skill                     | Purpose                                                    |
| ------------------------- | ---------------------------------------------------------- |
| `issue-spec`              | Research and write implementation specs for Linear issues  |
| `issue-implement`         | Implement a Linear issue from its spec document            |
| `adhoc-quick-fix`         | Log a bug to Linear and fix it immediately                 |
| `adhoc-commit-as-new-issue` | Create a Linear issue for work already done, commit and PR |
| `debug-flow`              | Debug flow execution via CLI traces and NDJSON logs        |
| `linear-triage`           | Review and prioritize Linear issues                        |
| `plan-day`                | Identify unblocked tasks and generate a daily work plan    |
| `distill-lessons`         | Self-improvement engine: measure the loop (auto-derived cycle-ledger) and push the smallest upstream fix for a recurring rework class |
| `audit-coherence`         | Sweep the codebase (or a change) for incoherence (conflicting patterns, philosophy drift, gaps); the coherence lens of `review` |
| `review`                  | The single definition of how we review — composes coherence + restraint + correctness + completeness (+ optional depth) as parallel sub-agent lenses over a change or codebase slice; run standalone and by `issue-implement` |
| `polish-docs`             | The docs editor — a corpus-level editorial pass that consolidates, streamlines, simplifies, and re-arranges docs for readability and navigation (unafraid to rewrite/move); run standalone on a section or the whole site, and auto-dispatched at epic wrap as a draft docs-cleanup PR |
| `issue-lifecycle`         | Thin event-driven orchestrator that drives ONE issue end-to-end (spec → approval gate → implement → PR feedback → stop before merge); every phase runs in a fresh bounded sub-agent so token cost stays small |
| `epic-lifecycle`          | Drive ONE epic (a set of related issues under a shared objective) end-to-end: epic-spec → objective gate → each sub-issue's `issue-lifecycle` in parallel, each in its own git worktree/branch → epic wrap (lessons + docs polish). Holds only a compact status table. Parallel issue work always runs under an epic |
| `cross-spec-review`       | Review an epic's SET of specs against each other for mutual coherence (scope overlap, conflicting decisions, colliding surface) before any is built; the coherence lens at spec-set altitude; gated on the user approving each spec first. Read-only — reports conflicts to the coordinator |
| `watch-pr`                | Local substitute for `subscribe_pr_activity` (cloud-only): arms a `Monitor` poll loop that streams new PR comments, reviews (incl. approvals), and CI conclusions into the session — waking only on real events. Use when working against a PR locally, or as a local epic/issue lifecycle's webhook stand-in |

> **How the orchestration fits together** — the two lifecycles (epic and issue), the roles, the gates (`spec approved`, `epic approved`), the epic-spec, and **the spec-review bar and convergence rule** — are defined once, with diagrams, in [`docs/contributing/orchestration.md`](docs/contributing/orchestration.md). The skills above reference it rather than restating it.


### Development skills


| Skill               | Purpose                                                                        |
| ------------------- | ------------------------------------------------------------------------------ |
| `create-block`      | Create a new block (handler, generator, utility, router) with tests            |
| `create-pattern`    | Create a multi-block composable pattern with tests and docs                    |
| `add-flow`          | Create a new flow definition with actions, scopes, resources, and capabilities |
| `write-block-tests` | Write or update vitest tests for blocks and patterns                           |
| `add-store-adapter` | Create a new persistence store adapter package                                 |
| `add-docs-page`     | Add a page to the Docusaurus documentation site                                |


## Capabilities

- **Prefer capabilities over manual plumbing.** Use `defineCapability` + `uses: [cap]` instead of manually spreading `tools`, `context`, `sessionResources` into blocks. Capabilities are self-contained, portable, and composable.
- **Factory pattern for configurable capabilities.** When a capability needs config (provider type, resource refs), export a factory: `createXCapability(options)` → `DefinedCapability`.
- **Prefer static capability entries over manual context functions.** If a capability already provides context presets, use the capability in `uses` rather than reimplementing its formatting in a `context` slot. Gate conditional behavior at the pipeline level (e.g., `workIf` on capture) instead of at the context injection level.
- **Dynamic `uses` for conditional capabilities.** `uses` arrays accept `(ctx) => CapabilityRef[]` functions. Static entries install resources at build time; dynamic entries add context/tools at runtime. Resources must be declared statically somewhere.
- **Presets for opt-in/opt-out.** Use presets to bundle context/tools that consumers can enable/disable: `cap.presets({ tools: false })`.
- **`ToolsSlot` and `UsesSlot`** are framework types exported from `@flow-state-dev/core` for factory interfaces.
- **Pattern factories accept `uses`.** `planAndExecute`, `supervisor`, `blackboard` all forward `uses` to their default internal generators.

## Key Architectural Constraints

- Block kinds: exactly `handler`, `generator`, `sequencer`, `router`
- Actions are flow-level: `defineFlow({ actions })`
- Required caller input: `userId`
- Streaming: SSE item/content model with sequence-number resume
- Generator provider: Vercel AI SDK in Phase 1
- Lifecycle hooks: past tense (`onStarted`, `onCompleted`, `onErrored`, `onFinished`)
- Package boundary: `react` wraps `client` — no transport logic in react
- Package boundary: `server` never depends on `client` or `react`
- Collection key resolution: `collection.create("key")` auto-prepends the pattern prefix. `ref.name` returns the full storage key (e.g., `"artifacts/my-doc"`). Strip the prefix for bare keys.
- Resource mutations emit `resource_change` SSE events via `onResourceChanged` in `createScopeResourceRegistry`. These are transient items — `useSession` checks for them before the transient filter.

## Authority Hierarchy

1. `docs/philosophy.md` — How we think about building FSD (the apex; the tenets BPs derive from)
2. `docs/architecture/*` — Reference docs
3. `docs/contributing/best-practices.md` — Implementation standards
4. `AGENTS.md` — Process protocol

If docs conflict, the more specific reference wins (e.g. `docs/architecture/streaming.md` over a general statement in `overview.md`). Where code and grounding are incoherent and no doc disambiguates, that is a philosophy gap — surface it (`audit-coherence`), don't route around it.

## Commands

```bash
pnpm install          # Install all dependencies
pnpm typecheck        # TypeCheck all packages
pnpm test             # Run all tests
pnpm test:watch       # Watch mode
pnpm --filter @flow-state-dev/core test    # Test single package
pnpm --filter @thought-fabric/core test       # Test thought-fabric (builds core dep first)
pnpm --filter @thought-fabric/core typecheck  # Typecheck thought-fabric
```

## Writing Style (site content)

When writing blog posts, landing copy, or any prose for `apps/docs`, use this voice:

- **Audience is engineers.** No marketing speak. Write like you're explaining something to a peer, not selling to a buyer.
- **Short sentences. Varied rhythm.** Mix one-sentence paragraphs with longer ones. Don't let every sentence hit the same beat.
- **Minimal em-dashes.** Prefer commas, periods, or restructured sentences. Em-dashes are fine occasionally — not as a default connector.
- **No AI cadence.** Avoid: "X isn't just Y — it's Z", lists of three things that escalate nicely, sentences that start with "This", adjectives like "powerful/frictionless/seamless/first-class".
- **Introduce concepts for newcomers.** Don't assume the reader knows framework terms. When first mentioning something specific (a block kind, an API), briefly say what it does in plain terms.
- **Be direct about tradeoffs.** It's fine to say "this works for demos, not for production" or "we made a deliberate call here." Honest is better than polished.
- **Conclusions earn their place.** Don't end every section with a triumphant one-liner. If a point lands, it lands. If it needs a closer, keep it short and specific.
- **No internal issue or PR numbers.** Anything under `apps/docs/` is published documentation. Refer to features by what they are, not by their tracking ID. `FIX-421`, `PR #182`, Linear ticket links — none of these belong in user-facing prose. They go in commits, the `.changeset/*.md` fragments, and internal artifacts under `docs/internal/`.
- **Warm, not cold.** Reference docs can stay dry, but overviews, guides, and intros should read like a teammate walking you through it. A short framing sentence, an honest "why you'd reach for this," small acknowledgments of the reader's likely context. Engineer-direct still means human.
- **Sidebar labels never repeat the category name.** A `Memory` category should not contain a page literally labeled `Memory`. Use `sidebar_label: Overview` (or `Getting started`, etc.) in the page's frontmatter so the sidebar reads `Memory > Overview`, not `Memory > Memory`. Same rule for every category.
- **Use `openai/gpt-5.4-mini` in code examples** when a small/fast model is appropriate. Don't use legacy names like `gpt-4o-mini`, `gpt-4o`, `gpt-3.5-turbo`, etc. — they read as out of date.

The philosophy blog post (`apps/docs/blog/2026-03-06-philosophy.md`) is the reference example for this voice.

## Current Phase

Phase 1 (Foundation): Waves 1.a–1.l complete. 1.m (devtool: `fsdev dev` + `@flow-state-dev/devtool` package) shipped. Remaining: 1.n (cross-package validation).

## @thought-fabric/core Conventions

- **Subpath exports**: Domains expose `@thought-fabric/core/<domain>` (e.g., `@thought-fabric/core/attention`, `@thought-fabric/core/identity`). Named exports only (tree-shakeable). No default namespace objects.
- **Naming — word order encodes category**: `perspective[Verb]` = block/item (prefix first). `[verb]Perspective` = helper (verb first). The inversion signals the category without needing docs.
- **Naming examples**: `perspectiveObserve` (block), `perspectiveResource` (resource), `perspectiveContextFormatter` (formatter), `addPerspective` (helper)
- **Context formatters**: Use `[domain]ContextFormatter` naming. Always assign to `context` as an array: `context: [workingMemoryContextFormatter]`
- **Build dependency**: `@thought-fabric/core` depends on `@flow-state-dev/core` — build core first (`pnpm --filter @flow-state-dev/core build`)

## Coding Conventions

- **Common helpers** (`deepEqual`, formatting utilities, etc.) belong in a shared utils file — not inlined per-file. No duplicate copies across packages.

### Best practices (BP-001…040)

Best practices have two altitudes. Full text lives in `docs/contributing/best-practices.md` (universal) and `docs/contributing/best-practices/<category>.md` (situational).

**Convictions live as tenets** in `docs/philosophy.md` (read first). Former BP-001 / BP-028 / BP-029 / BP-038 are folded into tenets 1 / 5 / 2 / 3 and are no longer separate always-loaded BPs.

**Universal — the operational core, always apply, every task:**

- **BP-003** Verification evidence is mandatory — every deliverable has an evidence path + pass criteria.
- **BP-007** Concise API/file docs — file header + 100% of exported APIs documented; non-obvious helpers too.
- **BP-022** Release notes via Changesets — every user-facing PR adds a `.changeset/*.md`; internal-only → `--empty`. Pre-1.0: `patch`/`minor` only.
- **BP-030** Tolerate the old shape when you change a persisted/in-flight field — dual-read legacy records; reject removed keys loudly; `== null`-guard new nullable fields.
- **BP-031** Never make auth/routing decisions from caller-controllable input — derive them from a trusted source (server-set identity, verified token, the framework's transport `source`), not `body`/`metadata`/query/headers.
- **BP-034** Finish move/rename refactors — update provenance (headers, diagrams, doc anchors) and subpath re-exports, not just imports.
- **BP-035** Walk the second-path checklist before declaring a change done — legacy / null-boundary / concurrent-409 / cancel-error / multi-tenant / cost-observability / React-derived-state paths; test the off/new state of any new flag.

**Situational — open the category file when working in that area:**

- **Blocks & composition** (`docs/contributing/best-practices/blocks.md`): BP-011 handlers don't call blocks (compose as a sequencer) · BP-012 `.tap()` for state-mutation-only blocks · BP-013 `connectInput`/`connectOutput` inside the router · BP-014 handlers never return input · BP-024 helpers when the body varies, factories when only identity does · BP-025 declare/validate sequencer output schemas deliberately · BP-036 prefer conditional step variants (`.workIf`/`.tapIf`/`.stepIf` with an inline connector) over wrapper sequencers.
- **Generators & prompts** (`docs/contributing/best-practices/generators.md`): BP-016 outputSchemas OpenAI strict-compatible · BP-017 typed `context` slot for prompts · BP-018 shared prompt formatters in `lib/`.
- **Resources & state** (`docs/contributing/best-practices/resources.md`): BP-015 `expose`/`exclude` over `data` projections · BP-019 resource refs in leaf modules · BP-020 live mode never falls back to fixtures · BP-021 `cacheable` declared deliberately · BP-023 state schemas `.nullable().default(null)` · BP-027 user-scoped resources default to shared · BP-033 filter at the source before you load (don't list-then-discard).
- **React** (`docs/contributing/best-practices/react.md`): BP-010 `useMemo` over `useEffect`; derive flags from the complete input set; signal only on real change.
- **Engine & transport** (`docs/contributing/best-practices/engine.md`): BP-026 bundle forwarded options into `RuntimeConfig`.
- **Process & docs** (`docs/contributing/best-practices/process.md`): BP-002 spec-driven execution (each change maps to a Linear-linked spec) · BP-004 public boundary first · BP-006 keep planning/tracking labels out of code & tests · BP-008 root README onboarding-first · BP-009 package READMEs current · BP-037 specs are versioned docs (`docs/specs/<ISSUE-ID>.md`) reviewed as a PR, synced with Linear · BP-039 specs lead with a plain-language summary (grok before diving deep) · BP-040 spec review is a direction check — fold only what changes the approach, note the rest for the implementer, converge in two rounds.

**Document new and changed user-facing functionality** (always)

- New/changed end-user functionality is documented in the same change set: relevant `packages/*/README.md` for public API changes, and `apps/docs` (Docusaurus) pages for concepts/guides/APIs end users reference.

## Using Bash

It is important that you not bother the user with a permission approval that isn't necessary. Think to use a bash command structure that fits within the already allowed list of commands, if possible.