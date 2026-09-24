# FIX-1553 · Plan

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan** · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

This plan sets the order the work runs in and what each piece involves. How to build a piece is
that issue's own plan. IDs cross-reference [DECISIONS.md](DECISIONS.md) (D-n) and
[BUSINESS-RULES.md](BUSINESS-RULES.md) (ER-n).

## The path

![The path as of 24 September 2026, in steps rather than dates because the epic is unscheduled. The now line sits at this gate. Input lane: FIX-1495 model string grammar, backlog, optional. Step 1: FIX-1554, the evaluator kind, with FIX-1560 folded in. Step 2, in parallel: FIX-1558 cascadingRouter, FIX-1559 skill activator inject, FIX-1557 facets. Step 3: FIX-1555 memory seam, preferring to follow FIX-1559, and FIX-1556 docs and teach path after FIX-1558 and FIX-1559. Step 4: the assembled goal and wrap. The critical path runs from the gate through FIX-1554, FIX-1558 and FIX-1556 to wrap.](figures/path.svg)

One foundation, then a wide middle. Only FIX-1554 can start at the gate. After it lands, the
router and all three consumers can run side by side. The critical path is the kind, the router,
then the teaching page. FIX-1559 is the same length as the router and runs beside it. The
dependency graph is in [the spec](SPEC.md#how-the-issues-flow-into-each-other); this figure adds
order to it.

## What each issue entails

| Issue | Route | Blocked by (hard) | Consumes | Delivers | Releases | Size |
|---|---|---|---|---|---|---|
| **FIX-1554** evaluator kind | spec → impl PR | — | The #1903 lab · the owner locks · FIX-1560's acceptance list ([D1](DECISIONS.md#d1)) | The kind, resolver, capability refusal, answer shape (ER-3), the `ai` floor bump, the five-kinds docs (ER-8), a changeset | Every other child | Medium to large: the kind reaches core, contracts, engine, testing and the DevTool |
| **FIX-1560** direction | none, folded | — | — | Nothing separate; its acceptance is FIX-1554's spec | — | Close as duplicate |
| **FIX-1558** `cascadingRouter` | spec → impl PR | FIX-1554 | The block · the answer shape | The utility beside the kind, fail-closed gates (ER-4), leg (c) | FIX-1556 | Medium |
| **FIX-1559** skill activator | spec → impl PR | FIX-1554 | The block · [D3](DECISIONS.md#d3) · [D4](DECISIONS.md#d4) | The optional evaluator slot on tier 3 (ER-5), leg (d) | FIX-1556 · the inject shape FIX-1555 copies | Small |
| **FIX-1557** facets | spec → impl PR | FIX-1554 | The block · D3 | Classify at write, deterministic read (ER-6), leg (e) | The proof | Medium: storage shape is open for its spec |
| **FIX-1555** memory seam | spec → impl PR | FIX-1554 | The block · FIX-1559's seam shape, preferred | The seam, proved by its own tests (ER-7); leg (f), memory with none | The proof | Small |
| **FIX-1556** docs and teach | spec → impl PR | FIX-1558 · FIX-1559 | Every shipped surface above | The teaching page, one demo, the assembled goal (ER-15, ER-16) | Wrap | Medium |

**The hard edges to wire in Linear as blocked-by:** FIX-1558, FIX-1559, FIX-1557 and FIX-1555
are each blocked by FIX-1554. FIX-1556 is blocked by FIX-1558 and FIX-1559 (and by FIX-1554
through them). Nothing else is hard. FIX-1555 after FIX-1559 is a preference: [D3](DECISIONS.md#d3)
fixes the seam shape here, so memory need not wait. FIX-1495 blocks nothing.

**FIX-1556 is not blocked by FIX-1555 or FIX-1557.** Its teach path omits them, and its PR can
merge with legs (a) to (d) green. Legs (e) and (f) join the assembled goal as those two land. The
epic waits on them at wrap, not before.

## FIX-1560: folded

FIX-1554's spec author writes FIX-1560's four acceptance items into
`specs/issues/FIX-1554/SPEC.md` and links FIX-1560. The coordinator then closes FIX-1560 as a
duplicate of FIX-1554 and moves its relations across. Nothing else in the set changes: no child
waits on FIX-1560, and its Linear text holds no decision the locks on FIX-1553 don't already hold.

## Where it is

[The set table](SPEC.md#the-set--as-of-2026-09-24) is the dated snapshot; follow its Linear
links for current state. On 2026-09-24 every child is Backlog and unspecced, and the hard blocked-by edges
below are wired in Linear. #1903 is an open draft (DNM) at `b33a072` and is never merged as the product.
[FIX-1495](https://linear.app/fixpoint-labs/issue/FIX-1495) is Backlog on Framework
simplification & cleanup.

## What unblocks what, from here

1. **This spec is approved and merged** → FIX-1554 is specced, carrying FIX-1560. FIX-1560 closes.
   The other five may be specced now against #1903 and the answer shape, but not built.
2. **FIX-1554 merges** → FIX-1558, FIX-1559, FIX-1557 and FIX-1555 can be built in parallel.
3. **FIX-1558 and FIX-1559 merge** → FIX-1556 is built.
4. **All six legs pass** (ER-15) → wrap.
5. **FIX-1495 lands at any point** → examples may switch to `provider:model` ids. Nothing re-sequences.

## Coordination seams to watch

| Seam | Between | Rule |
|---|---|---|
| `BlockKind` in `packages/core/src/types/block.ts` and `blockKind` in `packages/contracts/src/items/types.ts` | FIX-1554 and every reader | FIX-1554 widens both in one change. No other child touches the union |
| The answer type (answers, optional confidence and probabilities) | FIX-1554 and the four consumers | FIX-1554 owns it. Consumers import it; none adds a field |
| The `ai` range in `packages/core/package.json` | FIX-1554 and the rest | One bump, in FIX-1554. No package pins its own |
| Jev's provider library as an optional peer | FIX-1554 and the rest | FIX-1554 declares it, optional, in one place. No consumer lists it (ER-9, ER-11) |
| `packages/orchestration/src/skills/skill-activator.ts` and `packages/workforce/src/agent-worker-flow.ts` | FIX-1559 and the stock agent kind | FIX-1559 edits the activator only. The stock kind's `enableLlmClassifier` keeps its behavior |
| `apps/docs/docs/fundamentals/blocks.md` | FIX-1554 and FIX-1556 | FIX-1554 writes the kind's section. FIX-1556's guide links to it |
| The kitchen-sink host for the demo | FIX-1556 and [FIX-1455](https://linear.app/fixpoint-labs/issue/FIX-1455) | FIX-1556 agrees placement with FIX-1455's rebuild, or uses the smallest surface that boots |

## Not children, deliberately

[FIX-1495](https://linear.app/fixpoint-labs/issue/FIX-1495) (model string grammar) ·
[FIX-1482](https://linear.app/fixpoint-labs/issue/FIX-1482) (work-query, not a consumer) ·
[FIX-202](https://linear.app/fixpoint-labs/issue/FIX-202) (the eval harness) ·
[FIX-1455](https://linear.app/fixpoint-labs/issue/FIX-1455) (kitchen-sink rebuild) ·
[FIX-1372](https://linear.app/fixpoint-labs/issue/FIX-1372) (empty first-turn catalog; FIX-1559
must not paper over it). Related, never re-parented (ER-12).

## Wrap

When ER-15 holds, run the lessons pass, dispatch docs polish over the blocks, skills and memory
pages, and report completion in Linear from the goal verdict and the merged PRs. The report names
the retirement of the generator classifier ([D4](DECISIONS.md#d4)) as the follow-up it is.
