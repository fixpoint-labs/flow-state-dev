# General Personality

You are not a sycophant. You don't tell the user they have a good idea until you have considered its pros and cons and determined if it really is an improvement or not.

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently. Present them **with your recommendation** — see "Asking for sign-off" below; a neutral fork you already have a view on isn't neutrality.
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
- `docs/contributing/asking-for-decisions.md` — **Read before putting any fork, gate, or sign-off to the user.** The engineer/product-owner contract, the six-part shape, and a worked example.
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
| `@flow-state-dev/fsdev`             | Terminal interface — the `fsdev` command                                |
| `@flow-state-dev/devtool`           | Pre-built DevTool assets for `fsdev dev`                                |
| `@flow-state-dev/store-sqlite`      | SQLite-backed persistent store                                          |
| `@flow-state-dev/store-postgres`    | PostgreSQL-backed persistent store                                      |
| `@flow-state-dev/vercel`            | Vercel deployment adapter (SSE shaping, heartbeats, runtime config)     |
| `@flow-state-dev/next`              | Next.js deployment adapter                                              |
| `@flow-state-dev/node`              | Node HTTP host adapter — serve a long-lived FSD server in one call      |
| `@flow-state-dev/bullmq`            | BullMQ host/runtime adapter — durable background jobs, native cron, full-flow worker dispatch |
| `@flow-state-dev/mcp`               | MCP transport adapter                                                   |
| `@flow-state-dev/scheduled`         | Scheduled-actions transport                                             |
| `@flow-state-dev/voice-openai`      | OpenAI voice transport                                                  |
| `@flow-state-dev/claude-code`       | Claude Code integration — run a Claude Code agent in-process as a harness block (Agent SDK) |
| `@flow-state-dev/codex`             | Codex integration — run OpenAI's Codex agent as a block through the Codex SDK, returning core's neutral harness handle |
| `@flow-state-dev/cursor`            | Cursor integration — run Cursor's coding agent as a block through the Cursor SDK local runtime, returning core's neutral harness handle |
| `@flow-state-dev/tools`             | Reusable tool blocks                                                    |
| `@flow-state-dev/orchestration`     | Task substrate, dispatchers, the task-board primitive, and the skills runtime |
| `@flow-state-dev/workforce`         | Worker factory (`hireWorkforce`), the `WORKER.md` loader, and personas (Layer 2 on orchestration) |
| `@flow-state-dev/patterns`          | Higher-level composition patterns (built on the task board)             |
| `@flow-state-dev/harness-manager`   | Task-board worker that turns a row into a supervised coding run — own checkout, verdict before settlement, question channel, and the coding harness as a slot |
| `@flow-state-dev/shift-manager`     | The browser app a Workforce Lab is worked through, run as the `shift-manager` command over `fsdev dev --app` |
| `@flow-state-dev/memory`            | Cross-turn memory system (working / episodic / semantic / digest tiers) |
| `@flow-state-dev/ui`                | Component registry for flow UIs                                         |
| `@thought-fabric/core`              | Cognitive architecture primitives (attention, identity)                 |
| `apps/devtool`                      | DevTool source app (builds into `@flow-state-dev/devtool`)              |
| `apps/docs`                         | Documentation site (Docusaurus)                                         |
| `apps/kitchen-sink`                 | Canonical reference app (Next.js): opens on a picker of modes. Flow State mode is a support desk on Workforce and the other subsystems it hosts; the coding harness modes (Claude Code, Codex, Cursor) each get their own address. Features with no job in it are proven by fixture hosts under `goals/` |
| `apps/pattern-benchmark`            | Cross-pattern benchmark suite over a fixed task suite + model           |


## Documentation Structure

```
docs/
  architecture/     Framework architecture reference
  contributing/     Development setup, best practices, wave process
  internal/         Wave plans, journals, changelogs (process artifacts)
```

## Linear access (check the env first)

Every skill that touches Linear — `issue-spec`, `issue-implement`, `linear-triage`, `plan-day`, the lifecycles, the `issue-manager` agent — picks its channel here, once, at the start of the task:

- **`LINEAR_API_KEY` set → use the Linear GraphQL API directly. Do not use a Linear MCP server**, even if one is connected. It works in headless/cron runs, where an interactively-authenticated MCP server isn't there.
- **unset → fall back to the Linear MCP tools**, as the skills describe.

**Pick one channel per task and stay on it** — half the reads through MCP and half through the API is how a skill acts on two different views of the same issue. The skills name operations (`get_issue`, `save_issue`, `list_issue_statuses`); translate them to the equivalent GraphQL when you're on the API.

POST to `https://api.linear.app/graphql` with the key as a **bare** `Authorization` header — no `Bearer` prefix:

```bash
curl -sS https://api.linear.app/graphql -H "Authorization: $LINEAR_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"query":"query($id:String!){ issue(id:$id){ identifier title state{name} } }","variables":{"id":"FIX-123"}}'
```

The `stateId`s and team id the lifecycles use are inlined in `issue-lifecycle` → "Linear status is a mirror you own"; they are the same ids on both channels. **Never echo `LINEAR_API_KEY` into a log, a commit, a PR body, or a Linear comment.**

## Skills Library

Development task skills live in `.agents/skills/` — the harness-neutral home, since Claude is our main harness but not our only one. `.claude/skills` is a symlink to it so Claude Code's skill discovery keeps working; don't put files under `.claude/skills` directly. Use these when performing common development tasks:

> **Workflow scripts** live in `.agents/workflows/` (`.claude/workflows` is symlinked the same way): `epic-wake` and `issue-multi-pr`, the pure-mechanism half of the lifecycles. **Run `node .agents/workflows/verify.mjs` after editing either script.** Their contract is [`orchestration.md`](docs/contributing/orchestration.md) → "The pieces at a glance".

### Workflow skills

| Skill | Purpose |
| --- | --- |
| `issue-spec` | Research and write implementation specs for Linear issues |
| `issue-implement` | Implement a Linear issue from its spec document |
| `adhoc-quick-fix` | Log a Linear issue and ship it — fix it now, or the work is already done |
| `diagnose` | Hard-bug loop (reproduce → hypothesise → fix). Calls `debug-flow` for flow traces |
| `debug-flow` | `fsdev run` toolkit (`diagnose` calls it): NDJSON traces, `fsdev block`, failure-pattern table |
| `statechart` | Mermaid statechart from a TLA+ model of Task status, holds, notice records, or the assemble phase. Scratch dir; no runtime change |
| `fsd-coding` | Drive coding through one FSD flow (`fsdev run` + a host-selected Codex, Cursor, or Claude harness). Local / Grok-box only in v1 |
| `linear-triage` | Review and prioritize Linear issues |
| `plan-day` | Identify unblocked tasks and generate a daily work plan |
| `distill-lessons` | Measure the loop (cycle-ledger) and encode the recurring class — architecture / lint / test before a soft rule. Skill evals in `eval.md` |
| `audit-coherence` | Sweep the codebase or a change for incoherence; the coherence lens of `review`. Whole-repo debt audits land here too |
| `review` | The one definition of review (flaws in the work): coherence, restraint, reuse, correctness, completeness, optional depth, as parallel lenses |
| `reuse-review` | Each Adds item of a spec, epic or change against existing pieces: reuse X, extend X, or genuinely new |
| `analysis` | Whether this is the right work (seven objectives), on a drafted spec before the gate and at epic wrap |
| `adhd` | Parallel divergent ideation under cognitive frames, to generate alternative shapes; 8 sub-agent calls, a decision-point instrument. Adapted from the MIT-licensed [UditAkhourii/adhd](https://github.com/UditAkhourii/adhd) |
| `polish-docs` | Corpus-level docs editing pass; standalone, and as a draft PR at epic wrap |
| `concept-doc` | Plain-language doc on how one part of the framework works or should work, checked by a cold read |
| `issue-lifecycle` | Drive ONE issue end-to-end, stopping before merge; a **bug skips the spec** |
| `epic-lifecycle` | Drive ONE epic: epic-spec, objective gate, child issue lifecycles in parallel worktrees, wrap. Parallel issue work always runs under an epic |
| `epic-em` | Run an epic as engineering manager: you own engineering calls. A delta over `epic-lifecycle` that **moves no gate** |
| `epic-pm` | Run an epic as product manager: shape the outcome and cut scope before each gate. A delta over `epic-lifecycle` + `epic-em` that **moves no gate** |
| `spec-poc` | Experimental POC inside its owning retained spec, to validate direction before the gate |
| `settle-claim` | Settle ONE disputed factual claim with a throwaway POC when a review loops on it; returns CONFIRMED / REFUTED / INCONCLUSIVE |
| `cross-spec-review` | Review an epic's set of approved specs against each other for coherence before any is built. Read-only |
| `agent-mailbox` | Talk to agents this session can't dispatch (Grok, Cursor, Codex, another Claude) over the `fixpoint-labs/agent-mailbox` board |
| `project-spec` | The standing artifact for one Linear project, on a never-merged PR. **No lifecycle and no gate**; refreshed only on epic-level transitions. Written by `project-agent` |
| `watch-pr` | Local substitute for cloud-only `subscribe_pr_activity`: a `Monitor` poll loop over PR comments, reviews and CI |

> **How the orchestration fits together** — epic and issue lifecycles, roles, gates, feature/bug routes, spec-review convergence, the twelve-round PR-feedback cap, and spec retention, merge and amendment — is defined in [`docs/contributing/orchestration.md`](docs/contributing/orchestration.md). Skills reference it rather than restating it. Issue/epic spec content is canonical in the repository; Linear carries status and links. [`pr-reviewer-guidance.md`](docs/contributing/pr-reviewer-guidance.md) defines the PR layout and reviewer contracts. **A retained issue/epic spec is a directory, not a file**: `SPEC.md` (direction, what changes, what's already here and the debt) and `DECISIONS.md`, plus owned artifacts — no build plan, since the implementer plans against the code — shaped by the [issue](docs/contributing/spec-template.md) and [epic](docs/contributing/epic-spec-template.md) templates. [`spec-figures.md`](docs/contributing/spec-figures.md) defines figures; [`writing-for-humans.md`](docs/contributing/writing-for-humans.md) defines the fold and word budgets; [`asking-for-decisions.md`](docs/contributing/asking-for-decisions.md) defines what every gate, fork and blocker asks.


### Development skills

| Skill               | Purpose                                                                        |
| ------------------- | ------------------------------------------------------------------------------ |
| `create-block`      | Create a new block (handler, generator, utility, router) with tests            |
| `create-pattern`    | Create a multi-block composable pattern with tests and docs                    |
| `add-flow`          | Create a new flow definition with actions, scopes, resources, and capabilities |
| `tdd`               | Red-green-refactor loop. Conventions live in `write-block-tests`               |
| `write-block-tests` | Conventions reference for block/pattern vitest tests. The red-green loop is `tdd` |
| `add-store-adapter` | Create a new persistence store adapter package                                 |
| `add-docs-page`     | Add a page to the Docusaurus documentation site                                |


## Automated PR review is Codex

Never dispatch a Claude agent as a stand-in for a bot review. Make sure Codex has reviewed a PR once (if not, comment `@codex review` naming what you're unsure of); don't re-request after every push, only for a real concern, and name it. Canonical: [`orchestration.md`](docs/contributing/orchestration.md) → "Codex is the automated reviewer".

## Asking for sign-off

**You are the engineer; the user is the product owner.** Translate every ask into the business decision they are making, in six parts, batched under one `Need your sign-off` heading, hardest first: the fork as a plain-language heading · plain terms · the trade-off · my recommendation, always · what would change my mind · what being wrong costs. Don't ask what is the implementer's call, derivable, or near-free either way: decide it and note it in a line. **Read [`docs/contributing/asking-for-decisions.md`](docs/contributing/asking-for-decisions.md) (BP-041) before putting any fork, gate, or sign-off to the user.**

## Capabilities

- **Prefer capabilities over manual plumbing.** Use `defineCapability` + `uses: [cap]` instead of manually spreading `tools`, `context`, `resources` into blocks. Capabilities are self-contained, portable, and composable.
- **Factory pattern for configurable capabilities.** When a capability needs config (provider type, resource refs), export a factory: `createXCapability(options)` → `DefinedCapability`.
- **Prefer static capability entries over manual context functions.** If a capability already provides context presets, use the capability in `uses` rather than reimplementing its formatting in a `context` slot. Gate conditional behavior at the pipeline level (e.g., `sideChainIf` on capture) instead of at the context injection level.
- **Dynamic `uses` for conditional capabilities.** `uses` arrays accept `(ctx) => CapabilityRef[]` functions. Static entries install resources at build time; dynamic entries add context/tools at runtime. Resources must be declared statically somewhere.
- **Presets for opt-in/opt-out.** Use presets to bundle context/tools that consumers can enable/disable: `cap.presets({ tools: false })`.
- **`ToolsSlot` and `UsesSlot`** are framework types exported from `@flow-state-dev/core` for factory interfaces.
- **Pattern factories accept `uses`.** `planAndExecute`, `supervisor`, `blackboard` all forward `uses` to their default internal generators.

## Key Architectural Constraints

- Block kinds: exactly `handler`, `generator`, `evaluator`, `sequencer`, `router`
- Actions are flow-level: `defineFlow({ actions })`
- Required caller input: `userId`
- Streaming: SSE item/content model with sequence-number resume
- Generator provider: Vercel AI SDK in Phase 1
- Lifecycle hooks: past tense (`onStarted`, `onCompleted`, `onErrored`, `onFinished`)
- Package boundary: `react` wraps `client` — no transport logic in react
- Package boundary: `engine` never depends on `client` or `react`
- Kitchen Sink is glue: it assembles framework pieces and stays clean. Features, workarounds and custom config belong in the owning package; see `apps/kitchen-sink/CLAUDE.md` → "What belongs here, and what belongs in the framework".
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

The full standard is [`docs/contributing/user-docs.md`](docs/contributing/user-docs.md) — read it before writing any user-facing prose. It carries the **outsider rule** (docs describe what the thing does, never how it was built, what it used to do, or what bug prompted it), the two sentence tests, and the tells table. The summary below is the voice half of it.

**Don't write user-facing prose yourself while holding a spec or a diff.** Dispatch the `docs-writer` agent, then `docs-editor`. Context leaks even when you know the rules — that's what the isolation is for.

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
- **Use `openai/gpt-6-luna` in code examples** when a small/fast model is appropriate. Don't use legacy names like `gpt-5.4-mini`, `gpt-4o-mini`, `gpt-4o`, `gpt-3.5-turbo`, etc. — they read as out of date.

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

### Best practices

Best practices have two altitudes. Full text lives in `docs/contributing/best-practices.md` (universal) and `docs/contributing/best-practices/<category>.md` (situational).

**Convictions live as tenets** in `docs/philosophy.md` (read first). Former BP-001 / BP-028 / BP-029 / BP-038 are folded into tenets 1 / 5 / 2 / 3 and are no longer separate always-loaded BPs.

**Universal — the operational core, always apply, every task:**

- **BP-003** Verification evidence is mandatory — every deliverable has an evidence path + pass criteria, and so does every claim the change rests on (scope counts, equivalence, runtime behaviour): execute or parse it, don't read it. **A report is a claim too** — "I fixed it", a status line, a summary of someone else's work — so re-derive it from the artifact, not from the list you worked off. The command is subject to tenet 7 in three shapes — aimed at a *neighbour* of the claim, **never ran the check**, or **stated scope wider than the real one** (BP-003 has each). If you cannot say what would make this check fail, you have not verified anything: produce the red state where one exists, and where none does (parity work) show the check reaches the code it covers.
- **BP-007** Concise API/file docs — file header + 100% of exported APIs documented; non-obvious helpers too.
- **BP-022** Release notes via Changesets — **not required by default.** Add a `.changeset/*.md` only when a downstream consumer of a published package needs to know; private packages (labs, examples, apps, plugin, goals) never get one. Skipping needs no empty fragment, just a line in the PR. Pre-1.0: `patch`/`minor` only.
- **BP-030** Tolerate the old shape when you change a persisted/in-flight field — dual-read legacy records; reject removed keys loudly; `== null`-guard new nullable fields.
- **BP-031** Never make auth/routing decisions from caller-controllable input — derive them from a trusted source (server-set identity, verified token, the framework's transport `source`), not `body`/`metadata`/query/headers.
- **BP-034** Finish move/rename refactors — update provenance (headers, diagrams, doc anchors) and subpath re-exports, not just imports.
- **BP-035** Walk the second-path checklist before declaring a change done — legacy / null-boundary / concurrent-409 / cancel-error / multi-tenant / cost-observability / React-derived-state / event-read-off-state paths; test the off/new state of any new flag.

**Situational — open the category file when working in that area:**

- **Blocks & composition** (`docs/contributing/best-practices/blocks.md`): BP-011 handlers don't call blocks (compose as a sequencer) · BP-012 `.tap()` for state-mutation-only blocks · BP-013 `connectInput`/`connectOutput` inside the router · BP-014 handlers never return input · BP-024 helpers when the body varies, factories when only identity does · BP-025 declare/validate sequencer output schemas deliberately · BP-036 prefer conditional step variants (`.sideChainIf`/`.tapIf`/`.stepIf` with an inline connector) over wrapper sequencers · BP-042 a handler's or action's return is recorded: no unbounded payloads; transient bulk data through `.map`, data for a person through a read path.
- **Generators & prompts** (`docs/contributing/best-practices/generators.md`): BP-016 outputSchemas OpenAI strict-compatible · BP-017 typed `context` slot for prompts · BP-018 shared prompt formatters in `lib/`.
- **Resources & state** (`docs/contributing/best-practices/resources.md`): BP-015 `expose`/`exclude` over `data` projections · BP-019 resource refs in leaf modules · BP-020 live mode never falls back to fixtures · BP-021 `cacheable` declared deliberately · BP-023 state schemas `.nullable().default(null)` · BP-027 user-scoped resources default to shared · BP-033 filter at the source before you load (don't list-then-discard).
- **React** (`docs/contributing/best-practices/react.md`): BP-010 `useMemo` over `useEffect`; derive flags from the complete input set; signal only on real change.
- **Engine & transport** (`docs/contributing/best-practices/engine.md`): BP-026 bundle forwarded options into `RuntimeConfig`.
- **Process & docs** (`docs/contributing/best-practices/process.md`): BP-002 spec-driven execution (each change maps to a tracked unit of intent — a spec for a feature, the issue itself for a bug; a surface it decided survives a build constraint — move the mechanism, or raise a conflict to re-gate, never a fork to offer) · BP-004 public boundary first · BP-006 keep planning/tracking labels out of code & tests · BP-008 root README onboarding-first · BP-009 package READMEs current · BP-037 retain issue and epic specs as reviewed design history; repository canonical, Linear links/status; project exception unchanged · BP-039 lead with the problem in plain language and fold the derivation below it (grok before diving deep) · BP-040 spec review is a direction check — fold only what changes the approach, note the rest for the implementer, converge in two rounds · BP-041 frame every ask as a business decision.

**Document new and changed user-facing functionality** (always)

- New/changed end-user functionality is documented in the same change set: relevant `packages/*/README.md` for public API changes, and `apps/docs` (Docusaurus) pages for concepts/guides/APIs end users reference.

## Using Bash

It is important that you not bother the user with a permission approval that isn't necessary. Think to use a bash command structure that fits within the already allowed list of commands, if possible.