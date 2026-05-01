# Higher-Layer Review: patterns, thought-fabric-core, tools, skills, tasks

Reviewer: first-principles audit. Scope: the five higher-level packages that sit on top of the four-block core.

## TL;DR

The framework's core (`handler / generator / sequencer / router`) is a defensible idea. The higher layers are not all defensible. Of ~24,000 LOC across these five packages, a meaningful fraction is library code looking for users, structured around metaphors rather than measured problems. The patterns package alone ships 11 named pattern factories with one in-tree consumer (`apps/kitchen-sink`). `thought-fabric-core` is a research project wearing a framework package's clothes. `skills` and `tasks` are doing real work but their boundary with patterns is muddled.

The single most valuable change: **shrink `patterns` to 3-4 patterns, demote `thought-fabric-core` out of the framework, fold `tasks` into `core` (or into `patterns/_substrate`), keep `tools` and `skills`**. Details below.

---

## 1. Patterns package — necessary or premature abstraction?

**Inventory** (`packages/patterns/src/index.ts`, ~4950 LOC):

| Pattern | LOC (src) | Test LOC | Purpose | Real consumers (outside `packages/patterns`) |
|---------|-----------|----------|---------|-----------|
| `taskBoard` | 1054 | 1475 | Concurrent drain over `TaskCollection` with dependency gating, per-task router. The substrate the others build on. | `parallelTasks`, `supervisor`, `plan-and-execute` (internal) |
| `plan-and-execute` | 842 | 1026 | Plan → drain → evaluate → optionally replan → loop | `apps/kitchen-sink/flows/chat-agent/flow.ts` |
| `supervisor` | 485 | 680 | Per-task review wrapper on `taskBoard` | `apps/kitchen-sink/flows/chat-agent/flow.ts` |
| `blackboard` | 466 | 1919 | Controller-driven multi-agent shared workspace | `apps/kitchen-sink/flows/chat-agent/blocks/thinking-styles.ts` |
| `drain-pool` | 545 | 516 | Durable concurrent worker queue (predates `taskBoard`) | none |
| `reactive-blackboard` | 434 | 1129 | Stigmergic actor mesh, write-time fan-out | none (only kitchen-sink demo block) |
| `response-auditor` | 281 | 347 | Post-generation analyzer fan-out | `apps/kitchen-sink/flows/chat-agent/flow.ts` |
| `parallelTasks` | 202 | 351 | Single-pass fan-out/fan-in on `taskBoard` | none in-tree (`coordinator()` deprecated alias) |
| `event-queue` | 110 | 313 | In-flow event drain via `loopBack` | `apps/kitchen-sink/flows/chat-agent/blocks/event-queue-demo.ts` (demo only) |
| `rlm` | 214 | 278 | Recursive Language Model reference | none |
| `coordinator` | 48 | 410 | Deprecated alias → `parallelTasks` | (deprecated) |

**Diagnosis**: 11 names, one in-tree real-app consumer (`chat-agent`), and that consumer pulls in only 4 of them. Five patterns (`drain-pool`, `reactive-blackboard`, `parallelTasks`, `event-queue`, `rlm`) have **zero non-test consumers** in this monorepo. `coordinator` is a deprecation shim.

**Genuinely valuable** (earn their keep):

1. **`taskBoard`** — this is the substrate. `supervisor`, `parallelTasks`, and `plan-and-execute` all sit on top of it. It does real work (CAS-safe claim, dependency gating, per-task routing) that you would not want to rewrite per-app. KEEP.
2. **`supervisor`** — review-with-retry is a recurring agent shape that's annoying to wire by hand. Used in production-shaped code (`chat-agent`). KEEP.
3. **`plan-and-execute`** — adaptive replanning loop is non-trivial; the synthesize-status translation alone (`packages/patterns/src/plan-and-execute/blocks/synthesize.ts`) is 100+ lines of fiddly logic. KEEP.

**Speculative / would be more honest as docs recipes**:

- **`reactive-blackboard`** (434 LOC, 1129 LOC of tests, no consumers). The pattern doc is 205 lines and the tests are 5x the source. The "stigmergic actor mesh" is interesting research but the validation case is "kitchen-sink has a demo." Library code looking for users.
- **`rlm`** (214 LOC). The file header says "Reference implementation of the Recursive Language Model architecture (Gao et al. 2025)" — that is literally a paper recreation. It belongs in `examples/`, not `packages/`.
- **`event-queue`** (110 LOC). Module header: "Demonstrates that FSD's `stateSchema` + `loopBack` primitives are architecturally sufficient for intra-flow event-driven dispatch — no new framework APIs required." That is a sentence describing an example, not a package member. Keep the *example*; delete the package.
- **`drain-pool`** (545 LOC). Predates `taskBoard`. The pattern docs describe a feature set that overlaps heavily with `taskBoard`'s "concurrent streaming dispatch." Two patterns for the same shape, with different schemas and lifecycles, is a maintenance tax for end users.
- **`parallelTasks`** (202 LOC). Already a thin sequencer over `taskBoard` + `utility.decomposer` + `utility.combiner`. The README is 30 lines of usage and the source has nine config keys. The whole thing reads like a pattern-recipe doc that got promoted. The docs page (233 LOC) shows the call site is ~10 lines. Honestly: a doc snippet would carry equal information.
- **`coordinator`** — deprecated, will be removed.

---

## 2. Pattern bloat and overlap

**Per-pattern average**: ~450 LOC source, ~750 LOC tests. The top three by tests-to-source ratio (`response-auditor` 1.23x, `reactive-blackboard` 2.6x, `coordinator` 8.5x) raise eyebrows — when test code dwarfs source code by that much, it suggests either combinatorial-edge-case anxiety or that the pattern's contract is slippery.

**Composition between patterns**: Patterns are *internally* layered (supervisor / parallelTasks / plan-and-execute all build on `taskBoard`). They are not externally composable in any documented or tested way — there is no test for "supervisor inside plan-and-execute" or "blackboard whose specialist is a parallelTasks." The "Pattern selection" decision tree in `apps/docs/docs/patterns/overview.md` reads as "pick one"; nothing in the docs suggests stacking patterns is a supported compositional axis.

**Hidden duplication**:

- **`drain-pool` vs `taskBoard`**: both are "N workers draining a durable queue with at-least-once and concurrency control." `drain-pool` predates the unified Task substrate (`packages/patterns/src/drain-pool/index.ts:9-15` describes it as "concurrent streaming dispatch over a durable, dynamic queue" — exactly `taskBoard`'s job). Consolidate.
- **`coordinator` vs `parallelTasks`**: explicitly the same thing, with a deprecation shim. (`packages/patterns/src/coordinator/index.ts:1-9` calls itself a deprecated alias.) Resolve the deprecation: delete `coordinator/`.
- **`blackboard` vs `reactive-blackboard`**: not technically duplicate (controller-driven vs stigmergic), but they share schemas, naming, and conceptual surface. For a user trying to choose, "blackboard" already meant something specific; introducing two patterns named "Blackboard" guarantees confusion. If both stay, one needs renaming.

---

## 3. thought-fabric-core: framework concern, or research project?

`@thought-fabric/core` is ~7,300 LOC organized into four namespaces: `attention`, `memory`, `identity`, `metacognition`. Look at the **identity** subpackage:

- `constitution.ts` (259 LOC) — "principles, contextual overrides, conflict resolutions"
- `perspective.ts` (388 LOC) — "structured viewpoint model that encodes what an analytical position pays attention to"
- `perspective-system.ts` (266 LOC), `perspective-capability.ts` (211 LOC), `perspective-blocks.ts` (481 LOC), `perspective-helpers.ts` (472 LOC)

This is not solving a measured problem. It is implementing a metaphor: "agents have constitutions, perspectives, and identities." There is no benchmark anywhere in the repo demonstrating that constitution-enforced agents outperform a normal system prompt. `metacognition/bias-detection*.ts` (~775 LOC) is plausibly more useful (the bias taxonomy is concrete and the analyzer plugs into `responseAuditor`), but it's still essentially a prompt template plus zod schemas wrapped in 1100 LOC of factories, helpers, and capabilities.

**Coupling**: tight on the import side (every block factory uses `@flow-state-dev/core` types), loose on the *necessity* side. Nothing in `core` knows about thought-fabric. Nothing in `server` or `client` knows about it. The kitchen-sink uses it (`apps/kitchen-sink/flows/chat-agent/flow.ts:27-29`) but mainly for `memorySystem` and `perspective`, and in ways that could equally be a 200-line app-local module.

**Real, measurable problem?** "Working memory with capacity limits and decay" — yes, agents do drown in context, this is a real problem. But the answer here is 7 files and 1075 lines of memory-system blocks, when the actual mechanism is "keep the N most-recent or N-highest-salience entries in a session resource and inject them into the prompt." That can fit in 200 lines. The rest is taxonomy.

**Verdict**: this is a research project. The naming alone (`thought-fabric`, `cognitive-architecture-primitives`) signals ambition that has outrun validation. It should be a separate repo and a separate decision about what's reusable. Keeping it inside `flow-state-dev/` blurs the framework's identity: is FSD a runtime, or a cognitive architecture? Pick one.

---

## 4. thought-fabric naming conventions

The CLAUDE.md rule is:

> `workingMemory[Verb]` = block/item (prefix first). `[verb]WorkingMemory` = helper (verb first). The inversion signals the category without needing docs.

Concrete examples from `packages/thought-fabric-core/src/memory/index.ts`:

```ts
// Blocks (prefix-first):
workingMemoryCapture, workingMemoryObserve, workingMemoryRemember,
workingMemoryTick, workingMemorySnapshot, workingMemoryAdd

// Helpers (verb-first):
addWorkingMemory, evictWorkingMemory, pinWorkingMemory,
unpinWorkingMemory, refreshWorkingMemory, advanceWorkingMemory,
workingMemoryItems            // wait, this is prefix-first
formatWorkingMemoryEntries    // and this is verb-first… for an accessor?
```

The rule already breaks within its own export list. `workingMemoryItems` is described as a helper (verb-first category) but uses prefix-first form. `formatWorkingMemoryEntries` is verb-first, but `workingMemoryContextFormatter` (immediately below it in the same file) is prefix-first — both are "helpers" in the rule's category, with no explanation.

**Does the reader intuit category from word order?** Sit with `workingMemoryAdd` and `addWorkingMemory` for a second. One is a block, one is a helper. Without docs, no reader gets that right on first encounter. The only thing word order encodes is "this is the FSD style"; it does not encode the category in any way that survives a code review.

**Is the rule pulling its weight?** No. It is a complexity tax. The right rule is the boring one used by every other JS library: helpers and blocks live in different files (and they do — `working-memory-helpers.ts` vs `working-memory-blocks.ts`); export them under namespaces (which the package does — `memory.workingMemoryAdd` is a block, `memory.addWorkingMemory` is a helper). The naming convention adds nothing on top of the file separation.

---

## 5. Five higher-level concepts: where do they overlap?

The framework now ships:

| Concept | Lives in | Granularity |
|---------|---------|-------------|
| Utility blocks | `core/utility/` (~1200 LOC, 13 files) | one block factory |
| Tools | `tools/` (~4200 LOC) | one block factory + adapter |
| Skills | `skills/` (~2600 LOC) | a directory format + activation system |
| Tasks | `tasks/` (~2300 LOC) | a substrate (collection + dispatcher + worker) |
| Patterns | `patterns/` (~5000 LOC) | a sequencer composition |

Plus the cognitive layer (`thought-fabric-core/`).

**Overlap analysis**:

- **Utility blocks vs Tools vs Patterns**: utility blocks are single blocks with config (e.g., `utility.summarizer`). Tools are also single blocks with config (e.g., `tools.search`). These are the same concept — "a block factory we ship in the box" — separated only because tools have provider adapters (`tavilySearch`, `firecrawlFetch`, etc.). That separation is fine, but the fact that we call one "utility" and the other "tools" is a vocabulary tax on users. They could collapse into `core/utility` + `core/utility/adapters/*` or be renamed for parallelism (`utility.summarizer` and `utility.search`).
- **Patterns vs `thought-fabric-core` block factories**: thought-fabric exports things like `memorySystem()`, `perspective()`, `responseAuditor()`-compatible analyzers. Several of these *are* patterns (multi-block sequencer compositions). The kitchen-sink already imports `responseAuditor` from `patterns` and `biasAnalyzer` from `thought-fabric-core/metacognition` — and the bias analyzer plugs into the response auditor. The boundary is: "patterns" = generic shapes, "thought-fabric" = LLM-flavored cognitive ones. That boundary is hard to defend; the line between `responseAuditor` (pattern) and `biasAnalyzer` (thought-fabric) is just topic.
- **Tasks vs Patterns**: `tasks` is the *substrate* under `taskBoard`, `parallelTasks`, `supervisor`, `plan-and-execute`. The package was extracted from patterns precisely so patterns could depend on tasks without circular imports. Fine for layering, but exporting `Task`, `TaskCollectionRef`, `fifoDispatcher`, `priorityDispatcher`, etc. as a public package is a lot of public surface for what is fundamentally an implementation detail of "concurrent task drain." Most apps consuming patterns will never `import` from `@flow-state-dev/tasks` directly; the kitchen-sink does (`apps/kitchen-sink/flows/chat-agent/blocks/thinking-styles.ts`), but only because patterns leak the type.

**Could this collapse?** Yes:
- Merge `tools` into the utility block catalog (one concept: "configurable block factories shipped by FSD").
- Make `tasks` a non-public substrate of `patterns` (or move into `core` if the substrate has framework-level reach).
- Move thought-fabric out entirely (separate repo).

That leaves three concepts a user has to learn: **blocks** (the four primitives), **utilities** (configurable factories, including tools), **patterns** (multi-block compositions). That is a teachable surface.

---

## 6. The "skills" package: justify or eliminate

**What it does** (from `packages/skills/src/index.ts`):

- A SKILL.md format (frontmatter + body + supporting files), parser/serializer
- A resource collection that stores skills (`defineSkillsCollection`)
- Activation paths: `runSkill` tool (mid-flow), `inlineActivate` (handler), `intentSelector` (up-front classifier)
- Context formatters that inject active skills into the prompt
- Directory-walk ingestion (`importSkillsDirectory`) for build-time seeding
- One unified capability (`createSkillsCapability`) bundling all of the above

**How does it differ from tools?** Tools are typed function calls the LLM invokes during generation. A skill is *a directory* the LLM can activate, which then unlocks a body (system-prompt addition) and a curated tool list. Tools are atomic callables; skills are scoped contexts.

**How does it differ from blocks?** A block is a unit of execution. A skill is a unit of LLM behavior — closer to a system-prompt fragment than a piece of executable logic.

**Real?** Yes. The format mirrors Anthropic Claude's Skills (`.claude/skills/*/SKILL.md`) and FSD's own `.claude/skills/` is a working example of the same idea. The intent-classification path (`intentSelector`) is doing a thing that's hard to do otherwise: select skills *before* the main generator runs, based on lightweight matching, and inject them. The package has 9 test files, real coverage, and is consumed by user-facing infrastructure.

**Verdict**: KEEP. `skills` is the most clearly justified of the higher-level packages. It solves a problem (managing many model behaviors that swap based on context) that would otherwise require ad-hoc plumbing in every app. The 552-LOC `skill-md.ts` parser is annoying but unavoidable.

---

## 7. The "tasks" package: justify or eliminate

**What it does** (from `packages/tasks/src/index.ts`):

- `Task` schema, status state machine (`taskStatusSchema`, `isTransitionAllowed`)
- `TaskCollectionRef` interface with two implementations: `sequencer-backed` (state-bag) and `resource-backed` (durable)
- A `getOrCreateTaskCollection` factory that reads backing config
- Dispatchers: FIFO, topological, priority, classifier, event
- Helpers: `taskLoopBack`, `dispatchAndExecute`
- Item-window extraction utilities

**How does it differ from blocks/patterns?** It's not a block kind and it's not a pattern. It's a *substrate* — a typed collection abstraction with concurrency-safe operations, used by patterns (`taskBoard`, `parallelTasks`, `supervisor`, `plan-and-execute`) as their internal data structure.

**Real?** Yes — but mostly internally. Its public consumers are all in `packages/patterns`. The kitchen-sink imports from it once (`getOrCreateTaskCollection` in `chat-agent/blocks/thinking-styles.ts`) — to share a board with a pattern.

**Verdict**: KEEP, but consider demoting from a public package to an internal-only export. Right now, `@flow-state-dev/tasks` is a top-level publishable package with its own README, dispatcher catalog, schema, and exports — for what is, in 95% of cases, an implementation detail. Two reasonable moves:

1. **Fold into core** as `@flow-state-dev/core/tasks`. Tasks are framework-shaped (status, dispatch, claim), and core is the natural home for substrates that multiple patterns share.
2. **Keep as `@flow-state-dev/patterns/_substrate`** (private). Drop the standalone package, expose only the types that patterns leak.

Option 1 is cleaner; option 2 requires no behavior change.

---

## 8. Code-vs-doc ratio

Pattern docs in `apps/docs/docs/patterns/` (8 pages, ~2150 LOC of markdown):

| Page | LOC | Source LOC | Doc:Source |
|------|-----|-----------|----------|
| coordinator.md | 23 | 48 (deprecation shim) | reasonable |
| drain-pool.md | 269 | 545 | reasonable |
| parallelTasks.md | 233 | 202 | reasonable |
| plan-and-execute.md | 367 | 842 | reasonable |
| supervisor.md | 274 | 485 | reasonable |
| reactive-blackboard.md | 205 | 434 | reasonable |
| response-auditor.md | 279 | 281 | reasonable |
| overview.md | 93 | — | (selection guide) |

Notable absences: **no doc page for `blackboard`** (only `reactive-blackboard`), **no doc page for `event-queue`**, **no doc page for `rlm`**, **no doc page for `taskBoard`**. So three patterns ship in the package with zero user-facing documentation, plus the substrate they all sit on. If the patterns docs are the contract, those are unfinished products.

`thought-fabric/` has 7 doc pages totaling ~2300 LOC. The docs read like architecture papers: "A perspective is a structured viewpoint model that encodes what an analytical position pays attention to" (`perspective.ts:5-8`). For a framework's user-facing prose this is the wrong register — it explains the metaphor instead of the call site.

---

## 9. Test coverage

| Package | Test files | Source LOC | Test LOC | Density |
|---------|-----------|-----------|---------|--------|
| `patterns` | 14 | ~5000 | ~10800 | 2.16x |
| `thought-fabric-core` | 10 | ~7300 | (not counted, est. 4000+) | ~0.55x |
| `tools` | 24 | ~4200 | (varies, est. 5000+) | ~1.2x |
| `skills` | 9 | ~2600 | (est. 2500+) | ~1.0x |
| `tasks` | 8 | ~2300 | (est. 3500+) | ~1.5x |

Patterns has very heavy coverage — 2x source — which mostly reflects the combinatorial nature of the patterns (claim contention, retry budgets, cascade-skip-dependents, replan loops). Most patterns have meaningful integration tests, not just shape tests.

`thought-fabric-core` has the lightest coverage. It also has the lowest external usage. The two are correlated.

**Tests are not the issue.** The issue is whether the *existence* of these packages is justified, not whether they're well-tested. A speculative pattern with thorough tests is still a speculative pattern.

---

## 10. Recommendations

| Package | Recommendation | Justification |
|---------|----------------|---------------|
| **patterns** | **TRIM TO 4** (`taskBoard`, `supervisor`, `plan-and-execute`, `blackboard`) | These four cover the agent shapes with measured demand. Keep `parallelTasks` only if `coordinator` is removed first; otherwise demote it to a doc recipe (it's already a thin sequencer). |
| **patterns: drain-pool** | **REMOVE** (subsumed by `taskBoard`) | Two patterns for the same shape; consolidate. |
| **patterns: reactive-blackboard** | **DEMOTE TO EXAMPLE** | No consumers. Move to `examples/reactive-blackboard/` as a recipe. |
| **patterns: rlm** | **DEMOTE TO EXAMPLE** | Self-described "reference implementation" of a paper. That is the literal definition of an example. |
| **patterns: event-queue** | **DEMOTE TO RECIPE** | Self-describing as a demonstration that primitives suffice. Take it at its word. |
| **patterns: coordinator** | **REMOVE** | Already deprecated. |
| **patterns: response-auditor** | **KEEP** | Used in chat-agent; analyzer plugin model is genuinely reusable. |
| **patterns: parallelTasks** | **KEEP IF SLIM, ELSE DOCS** | Justifiable as a 1-call shortcut; if it grows past 200 LOC stay critical. |
| **thought-fabric-core** | **EXTRACT TO SEPARATE REPO** | Research project, not framework concern. Couples loosely; nothing in FSD core needs it. The package's contents should live or die by their own external traction. The naming convention should leave with it. |
| **tasks** | **TRIM TO INTERNAL** | Either fold into `@flow-state-dev/core` or make it `@flow-state-dev/patterns/_substrate` (private). It's a substrate, not a public concept. The dispatcher catalog (FIFO/topological/priority) belongs next to the patterns that use it. |
| **tools** | **KEEP, RENAME-CONSIDER** | Real value (search/fetch/crawl/bash/MCP). The `tools` vs `utility.*` split is unprincipled; consider unifying naming so adapters live alongside non-adapter utilities. |
| **skills** | **KEEP** | Most clearly justified package of the bunch. Solves a real problem (model-behavior context switching) with a real contract (SKILL.md). |

---

## Higher-layer rationalization plan

Concrete proposed changes, in order of risk:

**Phase A — drop the dead weight (low risk, no API impact for live consumers)**

1. Delete `packages/patterns/src/coordinator/`. Remove `coordinator()` and `coordinatorInputSchema` exports. Update `apps/docs/docs/patterns/coordinator.md` to a one-line redirect.
2. Move `packages/patterns/src/rlm/` to `examples/rlm/`. Remove the `rlm` exports from `packages/patterns/src/index.ts`.
3. Move `packages/patterns/src/event-queue/` to `examples/event-queue/` (or fold into the chat-agent demo block, which is its only consumer). Delete the package export.
4. Move `packages/patterns/src/reactive-blackboard/` to `examples/reactive-blackboard/`. The chat-agent uses it via `import from "@flow-state-dev/patterns/reactive-blackboard"` — that import becomes a local module.

After Phase A: `patterns` drops from ~5000 to ~3700 LOC and from 11 patterns to 7. The deletions are all currently-unused-by-real-apps surface.

**Phase B — consolidate overlapping shapes (medium risk)**

5. Audit `drain-pool` against `taskBoard`. If the only differences are schema names, retire `drain-pool` and document the migration. If `drain-pool`'s lease-recovery model has features `taskBoard` lacks, port them to `taskBoard` first.
6. Make `@flow-state-dev/tasks` non-public: fold its types into `@flow-state-dev/core` under `core/tasks/*`, or move them inside `packages/patterns/_substrate/`. Either way: stop publishing it as a top-level package. (External app code that imports from `@flow-state-dev/tasks` becomes `@flow-state-dev/core/tasks` — straightforward codemod.)

**Phase C — separate cognitive primitives (higher risk, scope decision)**

7. Move `packages/thought-fabric-core/` out of `flow-state-dev/`. Either to a sibling repo (`thought-fabric/` workspace owned by the same maintainer) or to its own repo entirely. Keep the kitchen-sink consuming it as a versioned dependency.
8. Drop the `[domain][Verb]` vs `[verb][Domain]` naming convention from CLAUDE.md when the package leaves. The framework doesn't enforce it; nothing in FSD core uses it.

**Phase D — reframe the public surface (documentation)**

9. Rewrite `apps/docs/docs/patterns/overview.md`: three tiers become **primitives** (the four block kinds), **utilities** (configurable factories — including what's currently called "tools"), **patterns** (multi-block compositions). One word per layer.
10. Add doc pages for the patterns that don't have them yet (`blackboard`, `taskBoard`). If a pattern survives the trim, it must have a doc page; this is the consistency standard.

**Net effect**

Before: 5 high-level packages, ~24,000 LOC, 11 patterns, two overlapping vocabularies (utility/tools), and one cognitive-architecture sub-framework occupying first-class real estate.

After: 3 high-level packages (`patterns`, `tools`, `skills`), ~14,000 LOC, 4-7 patterns, one vocabulary, and `thought-fabric` living in its own repo where it can be evaluated on its own merits.

The framework gets smaller. The reader's working set gets smaller. The patterns that survive are the ones with measured demand. The cognitive-architecture work continues — separately — without holding the framework hostage to its own scope creep.
