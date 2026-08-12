# Epic — The declared surface is the real surface

**Linear:** [FIX-1127](https://linear.app/fixpoint-labs/issue/FIX-1127/epic-the-declared-surface-is-the-real-surface) · **Project:** Framework simplification & cleanup · **Branch:** `epic/declared-surface`

---

## 1. Purpose & objective *(the gated sign-off surface)*

**Objective.** Everything FSD declares or documents should be true. Four independently-filed
defects share one failure mode: the framework states something — in a doc page, in a type, in a
block's declared resources, in a block's output contract — and the runtime does something else.
A developer meeting FSD cannot tell which of our statements to trust, and the ones that fail
first are the ones they meet first. When this epic lands, the four places we are provably
lying have stopped lying.

This is the last cheap moment. `@flow-state-dev/core` is `0.0.0` and unpublished, so none of
these has an external consumer to migrate.

**Holistic necessity.** Four issues, and the honest question is whether it's three.

- **FIX-1126 is the substance.** Twenty-two files under `apps/docs/` teach `preset/*` model
  strings that were removed by FIX-516 and now `throw` — including the entire getting-started
  sequence and both public blog posts. The documented first-run path ends in an unhandled
  exception at the exact moment a reader has the least context to diagnose it.
- **FIX-1048 is the same defect one layer down**, and worse-shaped: a *type* that accepts four
  fields the runtime silently drops. A missing option fails loudly; a declared-and-ignored one
  compiles clean and looks configured.
- **FIX-1052 is cheap rather than severe.** Its runtime consequence is unestablished — most
  likely a superset of what should be prefetched, not a misroute. It is kept because one line
  (`mergeDeclaredResources` stops mutating its target) closes it, closes FIX-1051, and closes
  an unfiled third variant. **If the fix grows past making that function pure, that is the
  signal something larger was found and it should be re-scoped, not absorbed.**
- **FIX-754 is the weakest, and it is kept rescoped.** Its filed harm — "redundant
  `block_output` echoes in the user-visible log" — was priced against an item taxonomy that no
  longer exists: `block_output` was replaced by `block_trace` and is gone as a type
  (`packages/core/test/output-item-public-surface.test-d.ts:13` asserts its absence). Every
  block still gets a trace row, so nothing disappears from the log. What remains is real but
  smaller: four framework blocks violate BP-012/BP-014 by declaring an `outputSchema` and
  returning their input, so their trace row's `output` echoes the input for no reader. **Kept
  as a conformance fix in code developers read as a model — not as a stream-pollution fix.**

**Not doing.** This is four verified defects, not a sweep. An objective phrased as "everything
declared is true" invites an unbounded audit of every declaration in the framework; that is
explicitly not this epic, and a fifth site discovered during the work is filed, not folded.
Also out: **FIX-852** (model-layer complexity — a different objective, runs standalone after)
and **FIX-766** (`work` → `sideChain` — same family, but it became a public-contract and
persisted-format migration, so it takes the spec route and its own lifecycle).

## 2. Themes & long-horizon direction

1. **All four take the direct (bug) route.** None has an approach that is a decision — each has
   a verified scope and a known correct shape. There are **no sub-issue specs and no
   spec-approval gates in this epic**; each implementation PR is that issue's only gate. FIX-754
   was re-categorised Improvement → Bug for this reason, recorded openly on the issue.

2. **When a declaration and the runtime disagree, make the runtime true.** That is the epic's
   default and it binds every issue here. **One deliberate exception:** where the declaration
   was never meant to be supported, removing it from the type — so misuse fails at compile time
   — closes the gap just as well. FIX-1048 is the only issue where both resolutions are
   available; which one it takes is its implementer's call on the PR, and no issue needs to
   invent a policy for it.

3. **Two issues ride inside another's PR rather than getting their own row.** FIX-502 rides
   FIX-1126 (the same three guide files, including the `scope: "project"` example at
   `apps/docs/guides/adding-skills-to-your-app.md:108`, which is not a scope type); FIX-1051
   rides FIX-1052 (literally the same one-line fix). **The carrier PR names the carried issue
   in its description and its changeset**, or the carried issue closes with no trace of why.

4. **FIX-1052's fix is the shared mechanism, not the symptom.** Making
   `mergeDeclaredResources` pure (`packages/core/src/blocks/internal/build-block.ts:51-71`)
   resolves FIX-1052, FIX-1051, and the unfiled leaf-block `.rescue()` variant in one place.
   All six call sites already reassign the result (`defineFlow.ts:417`, `build-block.ts:430`,
   `sequencer.ts:1176`, `sequencer.ts:2020`, `router.ts:47`, `router.ts:204/216`), so purity is
   a safe change rather than a migration. **No issue fixes a `.rescue()` call site
   individually.**

5. **Two of the four change what a user can observe, and both settle that on their PR.** FIX-754
   changes what a block's trace row carries; FIX-1126 rewrites what a new developer is taught
   first, because `quick-start.md` and `setting-up-models.md` explain "a preset" as a live
   ambient concept that has no same-shaped equivalent under `intent/*`. **Each of those two PRs
   names its behaviour change explicitly in its description** — that is what makes the direct
   route safe here, and it is the whole reason these are judged against a real diff rather than
   a document.

6. **No sequencing between the four.** They touch disjoint surfaces — `apps/docs/**` ·
   `core/src/flow/defineFlow.ts` · `core/src/blocks/internal/build-block.ts` ·
   `patterns/` + `tools/`. All four can run in parallel and merge in any order. Stated because
   a four-issue epic invites a reader to look for the dependency graph, and there isn't one.
   The one near-seam — FIX-1126 edits `docs/patterns/response-auditor.md` and `docs/tools/bash.md`,
   whose blocks FIX-754 changes — is not a real collision: neither page documents block output.

## 3. Shape of the whole *(POC)*

**`spec_poc: skipped`** — every row's scope is verified against `main` with file:line evidence
from the 2026-08-12 audit; no unchecked premise.

The trigger an end-state POC answers (*does the division into issues hold once it's all
there?*) does not fire: the four fixes touch disjoint files, share no seam, and none of them
creates surface another consumes. What a POC would have shown, the audit already showed
directly — and it found the one thing worth finding (FIX-754's premise names a removed item
type), which is folded into §1 rather than discovered later in a worktree.

## 4. Running index

| Issue | What it delivers | Route | Spec PR | Impl PR | State |
|---|---|---|---|---|---|
| [FIX-1126](https://linear.app/fixpoint-labs/issue/FIX-1126) | 22 doc/blog files stop teaching `preset/*`, which throws; getting-started rewritten around `intent/*` (carries FIX-502) | **bug** | — | — | Todo |
| [FIX-1048](https://linear.app/fixpoint-labs/issue/FIX-1048) | `FlowInstanceOptions.webhooks/chat/schedules/mcp` either apply at instance creation or stop type-checking | **bug** | — | — | Todo |
| [FIX-1052](https://linear.app/fixpoint-labs/issue/FIX-1052) | `mergeDeclaredResources` stops mutating its target, so `ownDeclaredResources` stays a block's own (carries FIX-1051) | **bug** | — | — | Todo |
| [FIX-754](https://linear.app/fixpoint-labs/issue/FIX-754) | Four state-only blocks stop declaring an `outputSchema` and returning their input (BP-012/BP-014) | **bug** | — | — | Backlog |

*Every row is `direct` route, so **no row will ever carry a spec PR** — an empty Spec PR cell
here is correct by design, not a gap ([`orchestration.md`](../../docs/contributing/orchestration.md)
→ "Which issues get a spec").*

*One correction the implementer needs, carried here because it changes what FIX-754's PR must
say: **the issue's `block_output` vocabulary is stale.** That type was replaced by `block_trace`
and no longer exists. The four sites are still exactly as its 2026-08-12 audit comment
verified — `patterns/src/response-auditor/index.ts:61`, `patterns/src/eventActors/index.ts:430`,
`tools/src/bash/blocks.ts:787`, `tools/src/bash/blocks.ts:815` — but the PR must establish the
real delta against `block_trace` before naming it, rather than repeating "removes a redundant
item from the log."*

## 5. Open cross-cutting questions

- **Does the objective imply a fifth issue — a guard that keeps this from recurring?**
  Raised here, at authoring. FIX-516 removed `preset/*` from the framework and 22 doc files
  went on teaching it, unnoticed, until an audit found them. This epic restores truth today
  and does nothing about tomorrow: the next removal repeats it. Whether we spend on a check
  that fails CI when a doc example uses removed syntax is a scope-and-timing call, not an
  engineering one. **Blocks nothing** — all four issues proceed either way.

  *The ask, for whoever settles it:*

  - **The fork.** Fix the 22 files and move on, or also build a guard that catches the next one?
  - **Plain terms.** Our docs can teach code that crashes, and nothing tells us. It happened
    once and took months to notice. A guard would compile-check the examples in our docs so it
    fails our own build instead of a reader's first run.
  - **The trade-off.** The guard is real work (docs examples aren't currently compiled at all)
    and it is not this epic's four verified defects — it's a fifth, larger, unscoped one.
    Without it, the same class of failure returns on the next syntax removal, and the cost is
    paid by whoever is evaluating FSD that week.
  - **My recommendation: fix the 22 files now, file the guard separately, don't fold it in.**
    The four issues here are all verified and small; adding an unscoped infrastructure issue
    to the set is exactly the "does the whole overbuild" failure this epic-spec exists to
    catch. Filing it keeps it from being forgotten without holding this epic's objective open.
  - **What would change my mind.** If we're near a public launch of the docs site, the
    recurrence risk stops being theoretical and the guard becomes part of shipping them.
  - **Cost of being wrong.** Low and reversible either way. Fold it in and this epic grows an
    unbounded issue. Defer it and the worst case is a second doc-cleanup pass later — annoying,
    not expensive, and cheaper while we're pre-1.0 with no external consumers.

---

## Epic evolution

- **Epic drafted** — four verified defects under one outcome: what FSD declares is what FSD
  does. Scoped out FIX-852 and FIX-766; recorded that the set is four defects, not an audit.
- **At drafting, verifying FIX-754 against `main`** — rescoped it from a stream-pollution fix
  to a BP-012/BP-014 conformance fix, because `block_output` no longer exists as an item type
  and its filed harm was priced against a taxonomy that has since been replaced by
  `block_trace`. It stays in the set; what its PR must claim changed.
