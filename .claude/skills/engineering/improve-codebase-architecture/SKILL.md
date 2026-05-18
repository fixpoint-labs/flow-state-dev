---
name: fsd:improve-codebase-architecture
description: Find deepening opportunities in the @flow-state-dev repo, informed by FSD's existing domain vocabulary (block, generator, sequencer, router, pattern, capability, scope, item) and authority hierarchy (docs/architecture > docs/contributing/best-practices.md > AGENTS.md). Use when the user wants to improve architecture, find refactoring opportunities, consolidate shallow blocks or thin handlers, or make a package more testable and AI-navigable. Respects existing best practices (BP-001–BP-016) — suggestions that would contradict a BP should explicitly justify revisiting it.
---

# Improve Codebase Architecture

Surface architectural friction and propose **deepening opportunities** — refactors that turn shallow modules into deep ones. The aim is testability and AI-navigability.

## Glossary

Use these terms exactly in every suggestion. Consistent language is the point — don't drift into "component," "service," "API," or "boundary." Full definitions in [LANGUAGE.md](LANGUAGE.md).

- **Module** — anything with an interface and an implementation (function, class, package, slice).
- **Interface** — everything a caller must know to use the module: types, invariants, error modes, ordering, config. Not just the type signature.
- **Implementation** — the code inside.
- **Depth** — leverage at the interface: a lot of behaviour behind a small interface. **Deep** = high leverage. **Shallow** = interface nearly as complex as the implementation.
- **Seam** — where an interface lives; a place behaviour can be altered without editing in place. (Use this, not "boundary.")
- **Adapter** — a concrete thing satisfying an interface at a seam.
- **Leverage** — what callers get from depth.
- **Locality** — what maintainers get from depth: change, bugs, knowledge concentrated in one place.

Key principles (see [LANGUAGE.md](LANGUAGE.md) for the full list):

- **Deletion test**: imagine deleting the module. If complexity vanishes, it was a pass-through. If complexity reappears across N callers, it was earning its keep.
- **The interface is the test surface.**
- **One adapter = hypothetical seam. Two adapters = real seam.**

## Vocabulary layering

This codebase has its own primary domain vocabulary. The architectural overlay (module/interface/seam/adapter) coexists with it — don't substitute the overlay terms for FSD-native ones.

**FSD-native domain language** (use these as the names of things):

- **block** (handler / generator / sequencer / router), **pattern**, **capability**, **flow**, **action**, **scope** (request/session/user/project), **item** (message, reasoning, block_output, component, container, status, context, state_change, error, step_error), **store adapter**.
- See [LANGUAGE.md § "FSD vocabulary mapping"](LANGUAGE.md) for how each maps to module/interface/seam/adapter.

**Authority hierarchy** (suggestions must respect this):

1. `docs/architecture/*` — adapted reference docs (block kinds, items, streaming, state/scopes, execution/errors, middleware, capabilities, sequencer DSL, server/client, etc.).
2. `docs/contributing/best-practices.md` — implementation standards (BP-001–BP-016). New cross-cutting patterns belong here.
3. `docs/contributing/architecture-reference.md` — quick reference to locked contracts.
4. `AGENTS.md` — process protocol.
5. Per-package `README.md` — public API documentation for that package.

**Where decisions get recorded** (replaces the generic "ADR" flow):

- **Implementation-level pattern** that should propagate → new entry in `docs/contributing/best-practices.md` (next BP number).
- **Architecture refinement** that updates a documented contract → edit the relevant `docs/architecture/<area>.md` directly and call it out in the change description.
- **Specific actionable refactor** with a clear owner → Linear issue.
- **Surface-level user-facing change** → update the package `README.md` and any affected `apps/docs` page in the same change set (CLAUDE.md rule).

**Lock state to check before proposing**:

- BP-001–BP-016 are constraints, not guidelines. A candidate that violates a BP needs to either (a) align with it instead, or (b) explicitly justify why the BP should be revisited.
- Package boundaries: `server` never depends on `client` or `react`; `react` wraps `client` (no transport in `react`). Cross-boundary refactors are off-limits — the boundary validator at `scripts/validate-package-boundaries.mjs` will catch violations.
- Middleware coverage: `docs/architecture/middleware.md` documents which seams are public — keep suggestions aligned with what's currently exposed rather than inventing parallel mechanisms.

## Process

### 1. Explore

Read the relevant docs first so suggestions don't re-litigate decided design:

- `docs/architecture/overview.md` — package roles and the system shape
- `docs/architecture/<area>.md` — `blocks.md`, `items.md`, `streaming.md`, `state-and-scopes.md`, `execution-and-errors.md`, `middleware.md`, `capabilities.md`, `sequencer-dsl.md`, `server-and-client.md`, etc.
- `docs/contributing/architecture-reference.md` — locked contracts quick reference
- `docs/contributing/best-practices.md` — BP-001–BP-016 (these are constraints, not suggestions)

Then use the Agent tool with `subagent_type=Explore` to walk the codebase. Don't follow rigid heuristics — explore organically and note where you experience friction:

- Where does understanding one concept require bouncing between many small **blocks**?
- Where are **blocks** or **handlers** shallow — `inputSchema`/`outputSchema` nearly as complex as the `execute` body?
- Where have pure functions been extracted just for testability, but the real bugs hide in how blocks are composed in a sequencer (no **locality**)?
- Where do tightly-coupled blocks leak state or shape across their seams (e.g. a handler that reaches into an upstream block's output structure)?
- Which parts of the codebase are untested, or hard to test through their current interface?

**FSD-specific friction patterns to look for** (each maps to an existing BP — violations are likely candidates):

| Pattern | Smell | Likely fix |
|---------|-------|------------|
| Thin connector handler whose `execute` is `return { x: input.y }` | `.then()` chain bloated with adapter blocks | Use a connector function: `.then((v) => ({ x: v.y }), block)` (BP-013) |
| Handler that calls another block inside `execute` | Hidden composition; defeats observability | Lift to a sequencer (`BP-011`) |
| Handler returning its input unchanged | Items log polluted with echoes | Replace with `.tap()` (BP-012, BP-014) |
| Wrapper sequencer just to gate a `.then()` on a condition | Indirection that obscures control flow | `.thenIf` / `.workIf` / `.tapIf` (BP-015) |
| Multiple blocks each plumbing the same tools/context/resources into a generator | Capability-shaped duplication | Extract a `defineCapability` and use `uses: [cap]` |
| Generator `outputSchema` with `z.record` / `z.optional` / heterogeneous `z.union` | OpenAI strict-mode incompatibility | Collapse to fixed shape + nullable (BP-016) |
| `useEffect` doing derived-state computation in React layer | Renders out of sync, brittle to deps | `useMemo` (BP-010) |
| Two near-identical helpers in different packages | Duplication of common utilities | Hoist to shared utils (per CLAUDE.md coding conventions) |

Apply the **deletion test** to anything you suspect is shallow: would deleting it concentrate complexity, or just move it?

- A thin handler whose work the next block could do directly? Deleting it concentrates complexity in one place — refactor.
- A capability bundling tools + context + resources for `useTools` blocks? Deleting it explodes complexity across N blocks — it's earning its keep.
- A `store-sqlite` adapter when only the in-memory store is used in tests? Deleting it removes a real seam (two adapters = real) — keep.

### 2. Present candidates

Present a numbered list of deepening opportunities. For each candidate:

- **Files** — which files/modules are involved (use real paths: `packages/<pkg>/src/...`)
- **Problem** — why the current architecture is causing friction (cite the BP or doc it pushes against, if any)
- **Solution** — plain English description of what would change, in FSD-native terms
- **Benefits** — explained in terms of locality and leverage, and how tests would improve
- **Scope** — is this a localised refactor, or does it touch a documented contract in `docs/architecture/*`? Flag the latter explicitly so the doc gets updated in the same change set.

**Use FSD-native vocabulary for the domain** (block, generator, sequencer, pattern, capability, scope, item) **and [LANGUAGE.md](LANGUAGE.md) vocabulary for the architecture** (module, interface, seam, adapter, depth, leverage, locality). E.g.: "Deepen the `gatherFollowups` pattern by collapsing its three internal handlers into the pattern's interface — the interface becomes `{ topic, depth } → Followup[]` instead of exposing the intermediate handlers."

**Don't rename FSD concepts.** A pattern is a pattern; don't call it "a module" — call it "the X pattern (a deep module composed of Y blocks)."

**BP conflicts and contract changes**: if a candidate would contradict a BP, or would change something documented in `docs/architecture/*`, mark it clearly:

> _"This would change the item taxonomy documented in `docs/architecture/items.md` and conflict with BP-014. Worth doing if the new shape pays back across patterns X and Y, but the doc update needs to land in the same change set."_

Don't list every theoretical refactor a BP forbids.

Do NOT propose interfaces yet. Ask the user: "Which of these would you like to explore?"

### 3. Grilling loop

Once the user picks a candidate, drop into a grilling conversation. Walk the design tree with them — constraints, dependencies, the shape of the deepened module, what sits behind the seam, what tests survive.

Side effects happen inline as decisions crystallize. **Route each by scope** — there's no `CONTEXT.md` to update, but there are real homes for each kind of artifact:

- **A new cross-cutting implementation pattern emerges from the discussion?** Draft a new entry for `docs/contributing/best-practices.md` (next BP number). Keep it concise and rule-shaped, matching BP-001–BP-016.
- **A term in `docs/architecture/<area>.md` was fuzzy and got sharpened?** Update the relevant `docs/architecture/*` doc directly in the same change set.
- **A public API surface changed?** Update the package's `README.md` in the same change set (CLAUDE.md rule for user-facing changes); add or revise the relevant `apps/docs` page.
- **User rejects the candidate with a load-bearing reason that future explorers would need to avoid re-suggesting?**
  - If the reason captures an implementation rule worth preserving → propose a new BP entry recording it.
  - If the reason is a deliberate contract choice → bake it into the relevant `docs/architecture/<area>.md` as a "Rejected alternatives" / "Why not X" note.
  - Ephemeral reason ("not now") → don't record. Move on.
- **Want to explore alternative interfaces for the deepened module?** See [INTERFACE-DESIGN.md](INTERFACE-DESIGN.md). The parallel-sub-agent pattern is especially valuable when the candidate is a capability or pattern factory — "design it twice" applies cleanly because capabilities/patterns are the deepest reusable modules in the framework.

### 4. After the refactor lands (per BP-007 + CLAUDE.md rules)

- Co-located `*.spec.ts` next to the deepened module's source. Old `*.spec.ts` files attached to the now-deleted shallow blocks should be removed in the same commit — see [DEEPENING.md § "Testing strategy"](DEEPENING.md).
- File header comment + doc comments on every export (BP-007).
- Per-package check: `pnpm --filter <pkg> typecheck && pnpm --filter <pkg> test`. Root `pnpm typecheck` if the refactor crossed packages (also runs the boundary validator).
- Update the per-package `README.md` if the public API changed. Update any affected `apps/docs` pages.
- Add a `changelog.md` entry if the change ships to consumers.