# FIX-1870 · Plan

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan** · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

An epic plan sequences the work and says what each piece entails. It does not say how to build
any piece; that's each issue's own plan. IDs cross-reference [DECISIONS.md](DECISIONS.md) (D-n)
and [BUSINESS-RULES.md](BUSINESS-RULES.md) (ER-n).

## The path

![The path as of 11 October 2026. An input lane: FIX-1820, the restart closure, done on 11 October. This epic spec in review at the now line. FIX-1875 dispatchTask: spec, then implementation. FIX-1872 one fence: spec beside FIX-1875's build, implementation in two PRs after FIX-1875 merges. FIX-1876 docs and vocabulary: spec beside, implementation after both. The closure FIX-1887: its QA plan written early, its run after all three merge. The critical path runs through every implementation in order, then the closure run](figures/path.svg)

A straight chain. Specs can be written side by side once this one merges; implementations can't,
because each one hands the next a surface that must stop moving. Only the QA plan runs early.

## What each issue entails

| Issue | Route | Consumes | Delivers | Releases | Size |
|---|---|---|---|---|---|
| **FIX-1875** dispatchTask | spec → impl PR | `wait-for-response.ts` and the notices · D1 · ER-3 | The tool; `waitForResponse` and `timeoutMs` retired; public ask names renamed | FIX-1872 · FIX-1876 | Medium |
| **FIX-1872** one fence | spec → impl PR | `dispatchTask` · D2 | Today's coordinator posts sorted: none is a tell, so every post is a row per delegate, a workstream's row carrying its `target` (added to `dispatchTask`); board seams first, then the `handOff` tool, the ledger and its two entries removed in one PR ([FIX-1872 D3](../../issues/FIX-1872/DECISIONS.md#d3)) | FIX-1876 | Medium |
| **FIX-1876** docs and vocabulary | spec → impl PR | Both above, merged · D3 | Internal ask and hand-off names renamed, with a migration for rows already marked; the pages in [DOCS.md](DOCS.md) | The closure run | Small–medium |
| **FIX-1887** closure · required | spec (the QA plan) → runs until one is clean → PR | Every other child, merged, on one `main` commit | The reruns, the sweep, a QA report, and a bug child for every failure | The wrap | Medium, repeats per retest |

## Where it is

[The set table](SPEC.md#the-set--as-of-2026-10-11) is the review-time snapshot. Follow its Linear
links for current state. The one input, FIX-1820, is Done (2026-10-11, PRs
[#3045](https://github.com/fixpoint-labs/flow-state-dev/pull/3045) and
[#3048](https://github.com/fixpoint-labs/flow-state-dev/pull/3048)).

## What unblocks what, from here

1. **This spec's amendment merges** (Open 1, answered 2026-10-11, folded into D2) → FIX-1875's spec starts, and the closure's QA plan with it. FIX-1872 and
   FIX-1876 can be specced in parallel, against FIX-1875's spec once it is approved.
2. **FIX-1875 merges** → FIX-1872's implementation starts.
3. **FIX-1872 merges** → FIX-1876's implementation starts.
4. **FIX-1876 merges** → the closure's first run, on one `main` commit. A failure becomes a child
   of this epic that blocks FIX-1887, and the whole plan reruns after it lands.

## Coordination seams to watch

| Seam | Between | Rule |
|---|---|---|
| The coordinator's delivery | FIX-1875 and FIX-1872 | FIX-1875 leaves the coordinator alone: `handOff` and `dispatchTask` coexist for one release. FIX-1872 swaps the delivery path and removes `handOff` and the ledger together, so no build carries two fences (ER-10) |
| `task-tools-capability.ts` and `wait-for-response.ts` | FIX-1875 and FIX-1876 | FIX-1875 changes the public surface; FIX-1876 renames internals afterward, names only |
| `background-work.md`, `task-board.md`, `coordinators.md`, `chief-of-staff.md`, `glossary.md` | All three | Each child updates the pages its surface change breaks; FIX-1876 publishes the shared narrative and the vocabulary pass. Whoever lands later links rather than repeats |

## Not children, deliberately

FIX-1815 (done) · FIX-1816 (its D3 is amended by D2) · FIX-1786 (the task envelope and filing API) · FIX-1791 · FIX-1794 · FIX-1312 · FIX-1637 and FIX-1796 (they wait on FIX-1876's
vocabulary) · FIX-1818 (canceled; FIX-1872 closes it in favour of itself).

## Wrap

When ER-15 holds: run the lessons pass, dispatch docs polish over the pages above, and report the
outcome from Linear and implementation evidence. Meaningful design amendments go through a
follow-up PR, not a final status commit.
