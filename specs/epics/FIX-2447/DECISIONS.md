# FIX-2447 · Decisions

[Spec](SPEC.md) · **Decisions**

The calls that sit above any single child: what was chosen, what lost, and what each locks in for
the 18 children and the closure. D1 to D3 are the sign-off. Q1 is open, and it is the owner's.

## The tree

```mermaid
flowchart TD
  E["FIX-2447"] --> Q1["Q1 · open · how adopters meet the moved names"]
  E --> D1["D1 · all 17 review children and a closure, now · legs first"]
  D1 -.->|"rejected"| X1["the seven P1s only"]
  E --> D2["D2 · two kinds of hidden surface"]
  D2 -.->|"rejected"| X2["each child names its own subpath rule"]
  E --> D3["D3 · a loud refusal for a retired value"]
  D3 -.->|"rejected"| X3["each child picks a policy"]
```

<a name="q1"></a>
## Q1 · Open · 0.4.0 has shipped: how do adopters meet the names this epic moves?

**In plain terms.** The brief said FIX-2454 must land before 0.4.0 publishes. Core, engine,
client and react 0.4.0 went to npm on Nov 3, and orchestration is at 0.5.0. So every root name
this epic moves is one an adopter can import today, and moving it breaks their code. We choose
how that break reaches them.

**The options.** *Alias, then one removal:* each child adds the new home and keeps the old root
name as a `@deprecated` alias naming the new path and a removal version, and every alias goes in
one named foundation minor. That removal is either its own child, blocking the closure, or the
named minor itself, with BP-030's checklist and no 19th child; then the closure runs after that
minor ships. Either way the aliases are exempt from the *Shims* row, which they would otherwise
fail, until that minor. *Hold:* the next minor of core, engine, client and react waits
for all seven P1 moves. *Break as each lands:* no alias, each child's move ships in whatever
minor follows it.

**The trade-off.** Alias and hold both break an adopter once; only the alias warns first, and
it is what Mastra, the Vercel AI SDK and LangChain.js each did for the same kind of move. Holding
also holds the 19 changesets already pending on `main`, and every sibling package, because
`workspace:*` publishes exact version pins. Breaking as each lands keeps the cadence and breaks
adopters up to seven times. The alias's price is the goal itself: old names still autocomplete,
struck through, until the removal minor, so the closure runs after it.

**My recommendation: alias, then one removal.** A `FIX-XXX · remove the deprecated aliases`
child joins the set, blocked by every moving child and blocking the closure. To decide with it:
which minor removes them, and whether a child or that minor carries the removal.

**What would change my mind.** Evidence that almost nobody runs 0.4.0. Then break as each lands
and skip the aliases.

**What being wrong costs.** Alias, wrongly: a minor or two of struck-through names and one more
child. Hold, wrongly: every package's merged work waits for the slowest P1. Break as each lands,
wrongly: adopters pay several breaking upgrades, which is the debt this epic exists to clear.

![Q1: alias then one removal, recommended, beside holding the next minor and breaking as each lands. Decides it: how many times an adopter's upgrade breaks. Price: old names autocomplete, struck out, until the removal minor. Flips if adopters on 0.4.0 are few enough to ignore](figures/open-release-target.svg)

It comes down to breaking once, warned first: only the alias does both.

<a name="d1"></a>
## D1 · All 17 review children and a closure, now, with exit triggers on FIX-2463 and FIX-2462

| | |
|---|---|
| **Instead of** | The seven P1s, which alone clear the review's five rows, with P2 and P3 left for later |
| **Because** | The goal says one way to do each thing, and the duplicates are in P2: four output-polling copies, three harnesses with their own error types, two claim orders, a testing package that can't test a suspension. Without them the goal shrinks to the smaller one the spec rejects |
| **Locks in** | A 19-child epic: the owner-confirmed 17, FIX-2564's legs split out of the closure to land first, and the closure. FIX-2463 stays only if its spec shows the `*_ENTRY` constants can't move to documented subpaths or the existing `board.entries()` and `markRolePiece` bundles without a new primitive (ER-6); otherwise it leaves for its own spec. FIX-2462 folds into FIX-2459 unless its spec shows a distinct export win. These are triggers, not defaults: the owner confirmed all 17 |

**What would change my mind:** the P2s' rows already passing once the P1s merge. FIX-2564's
manifest reports that on `main` as it happens, so it no longer waits on the closure. Then the
P2s are polish and the epic should wrap.

**Considered, not taken.** One root-surface ratchet issue absorbing FIX-2448 and FIX-2449 and the
subpath-only parts of FIX-2459, FIX-2460 and FIX-2456: it splits behaviour-owning children in
two, and FIX-2448's first PR is already the ratchet. Cutting FIX-2462 now: D1's trigger already
covers it.

![D1: all 17 review children now, chosen, beside the seven P1s only. Decides it: whether one way to do each thing is in the goal. Price: a long epic slot. Flips if the P2s' rows pass once the P1s merge](figures/d1-whole-set.svg)

It comes down to the duplicates: they are all in P2, so P1 alone can't meet the goal.

<a name="d2"></a>
## D2 · Two kinds of hidden surface, and a public subpath is documented

| | |
|---|---|
| **Instead of** | Each child naming its own rule. FIX-2448 asks for a published, undocumented `core/internal`; FIX-2459 asks for an *unpublished* orchestration `./internal` |
| **Because** | Workforce imports orchestration's filing helpers at runtime (`conversation-board/board.ts`), so an unpublished subpath would be missing from workforce's tarball and its first install would fail. Both kinds already exist: `client/./internal` is published and read by our packages; orchestration's `./inbox/check` is hidden by `publishConfig` and read only by repo tests |
| **Locks in** | `/internal` is published, undocumented and outside semver, only `@flow-state-dev/*` packages import it, and a package has at most one (core folds `./items/internal` under it or keeps it as that one). Safe only while sibling packages pin each other exactly, as `workspace:*` publishes today. A `publishConfig`-hidden entry is for repo tests and tools. A named public subpath is documented and semver-covered. Enforced statically: the exports map, and the export check's import census refusing any app that imports `/internal`. An editor's completions are a manual spot-check at the closure; if one offers `/internal` names, that package fixes it with `typesVersions` or the exports `types` condition, not an epic change. `stripInternal` is out: sibling packages compile against the published `.d.ts` |

![D2: two kinds of hidden surface, chosen, beside each child naming its own rule. Decides it: a published package that imports a hidden path. Price: internal subpaths ship in the tarball. Flips if no published package imported another's internals](figures/d2-hidden-surface.svg)

It comes down to workforce's tarball: an unpublished `./internal` breaks its first install.

<a name="d3"></a>
## D3 · A retired value gets a loud refusal with a removal version; only published shapes are dual-read

| | |
|---|---|
| **Instead of** | Each child picking, as the window's three renames did: a throw, a permanent map, and nothing |
| **Because** | A retired runtime value is the silent case. Old code that passes `human_approval` compiles, and the stop becomes a custom reason with no Inbox item. A moved export is not silent; how it reaches adopters is Q1 |
| **Locks in** | FIX-2454 writes it into BP-030: a retired value or config key fails with its replacement named and a removal version, through one shared refusal helper that replaces today's ad-hoc ones (`defineFlow.ts`, `runner.ts`) and absorbs the `retired-name-refusal` sites (`core/src/blocks/generator.ts`) and FIX-2151's planned `RETIRED` set; dual-read only shapes a published version wrote, and the retired-enum coercion in `engine/src/resources/normalize-resource-state.ts` is that case, not a third policy; a refusal past its version fails the lint. BP-034's re-export rule is amended to match Q1's answer. Every child that retires a value follows it |

![D3: a loud refusal with a removal version, chosen, beside each child picking. Decides it: old code that still passes a retired value. Price: one refusal per value until its version. Flips if we reach 1.0](figures/d3-rename-rule.svg)

It comes down to `human_approval`: without a refusal, old code loses its Inbox item silently.

## Who owns what

![Who owns what: nine rules across FIX-2448, 2449, 2453, 2454, each child, the coordinator, the closure FIX-2562 and FIX-2564, each rule with one owner](figures/ownership.svg)

Each rule has one owner. A *uses* cell is a place where a child must not decide again.

| # | Rule every child obeys | Owner | Checked at |
|---|---|---|---|
| ER-1 | Every root export of a published package has an outside consumer or a README entry. The check lands first, as a ratchet on today's baseline, so the roots stop growing while the set is specced. Blocks and resources stay public library API; Workforce's app-level flows are Shadcn-style copies and are not root surface | FIX-2448 builds it, its first PR · FIX-2449 adds collisions | CI, gating every PR; leg b for installed-name collisions |
| ER-2 | Hidden surface is one of D2's two kinds | FIX-2448 | Each spec in the spec set; packed-install |
| ER-3 | Every retired value follows D3; every moved export follows Q1's answer | FIX-2454 | Each spec in the spec set; closure leg b |
| ER-4 | A new check extends what exists: the export check reads `mechanism-exports.mjs`'s `packageExports` plus an import census, FIX-2162's caller-census pattern, not Fallow, which keeps its dead-code jobs; `ctx as never` is a `no-restricted-syntax` entry; the tracker-id rule is the one custom ESLint rule | FIX-2453 decides the lint shape at spec time | Cross-spec review |
| ER-5 | Nothing that ships carries a tracker id, including each child's own new JSDoc, errors and test titles | FIX-2453 | The lint |
| ER-6 | No second way to do a job. FIX-2463 shows capabilities and the existing bundles can't carry a flow part. FIX-2455's React read builds on `useAction`, and its server read on `withListedResult`; the handle keeps one wait. FIX-2456 extends the registry's `ConversationScrollButton`. FIX-2459 keeps `./tasks` as the one browser-safe entry. FIX-2460's answer helper goes through the engine's answer path | Each child | `reuse-review` in the spec set |
| ER-7 | One changeset per published package a child changes, one line, naming each moved name's new home | FIX-2454 | Implementation review |
| ER-8 | Consumed issues stay where they are: FIX-1804, FIX-2197, FIX-2360, FIX-2367, FIX-2418, FIX-2428 | The coordinator | Each refresh |
| ER-9 | The goal's legs assert on installed tarballs, never workspace `src`. A child's PR changes only its own rows' expectation in the closure manifest, never an assertion; leg b holds only what the workspace ratchets can't see | FIX-2564 builds them · FIX-2562 runs them last | `run.mjs --control`; the `main` job |

## Coordination seams

| Seam | Between | Rule |
|---|---|---|
| `core/src/index.ts` | FIX-2448, 2449, 2458, 2460, 2463 | FIX-2448 lands first; the others edit its split |
| Core's `Benchmark*` types | FIX-2448, 2460 | FIX-2460 owns them and moves them to `testing/benchmark` |
| `engine/src/index.ts` | FIX-2449, 2452 | FIX-2449 writes the explicit list; FIX-2452 moves store constructors under it |
| `react/src/index.ts` | FIX-2449, 2450, 2455, 2456 | Each removes its own names; none re-adds a root export without ER-1 |
| `client.ts` request handle | FIX-2450, 2455 | FIX-2450 owns the answer verb, FIX-2455 the output read |
| Orchestration's exports | FIX-2459, 2462 | FIX-2459 moves names to `./internal`; FIX-2462 may delete them |
| The quick start | FIX-2451, 2452 | FIX-2451 fixes it now; FIX-2452 updates the snippet when the shorthand ships |
| Kitchen Sink | FIX-2554, 2461, 2458, 2456 | Each edits only its own files; FIX-2461 last |
| Task-collection storage primitives | FIX-2462 × FIX-2532 (`findBy`, #4757, outside the set) | `findBy` is written on FIX-2462's storage primitives; whichever lands second rebases |
| The closure manifest | FIX-2564 and every row-owning child | FIX-2564 owns the assertions; each child flips only its own rows |

## Decided, not asked

- **A user's stop is answered through `answer`, in React and the client.** `resume` stays only
  for a developer's own `ctx.suspend`. That is the goal's *one path* row; FIX-2450 builds it.
- **Overlaps:** FIX-2455 and FIX-2043 both read an action's result by request id; FIX-2457 sits
  beside FIX-2197, which scopes this assignability gap out.
- **Linear sequencing:** FIX-2448 blocks FIX-2449 and FIX-2458; FIX-2450 blocks FIX-2460; every
  child blocks FIX-2562. FIX-2564 blocks only the closure: a child that merges first has its rows
  written `expect: pass`.
- **The goal's legs land first, in their own child.** FIX-2562 can't carry an early PR: it is
  blocked by every other child, and its one PR opens on a clean run
  ([orchestration.md](../../../docs/contributing/orchestration.md#the-closure-issue-every-epic-ends-in-qa)).
  So FIX-2564 builds the legs; the closure still runs them last, on one pinned `main`.
- **Verification is consolidated, not stacked.** Workspace ratchets gate PRs; the legs run
  non-gating on `main`; the manifest maps each row to one place it is checked, which is also the
  closure's skip list for item 3.
- **Outside the set:** client-writable resource state, for a sibling issue. FIX-2454 has no blocks relation; its rule travels as D3.
- **FIX-2451 and FIX-2554 take the direct route** as bugs. FIX-2554 joined the set on Nov 4.
- **The `scheduler` slot** is FIX-2452's to remove or keep. R-11, which would make it real, is
  not in the set.
- **FIX-2479** (public `Row` types renamed to `Item`) is outside the set and follows the same
  rule if it lands first.

## What the end-state POC showed

None built. Recommended against: the children touch separate surfaces, and the one place a
division could fail (D2, a hidden path missing from a tarball) is already proved by the
packed-install check every child runs through.

## Analysis

**2026-11-05 · watermark 2026-11-01 · right approach, with changes.** The analyst ran
`reuse-review` on the Adds and compared Mastra, the Vercel AI SDK, LangChain.js and API
Extractor. Folded: five Adds already existed (the scroll button, `./tasks`, `client/./internal`,
`useAction`, a refusal helper), now named in ER-6 and the Adds table; Q1 re-priced (19 pending
changesets, exact sibling pins) and widened to the alias option, which the three frameworks all
took, so D3 narrowed to retired values; the export check lands first as a ratchet; the client's
answer verb decided here. Recorded: the completions risk on `/internal` (D2, now enforced statically) and
D2's dependence on exact pins. The `adhd` alternatives pass ran
later, reduced to a single context rather than parallel frames. It changed one thing: the goal's
legs land first as expected-fail rows (FIX-2564), so the lead measure and D1's trigger read off
CI. Its other two shapes are recorded under D1 as not taken.

## How it got here

- **Drafted (Nov 4–5).** 17 owner-confirmed children; closure FIX-2562 filed. 0.4.0 had already
  shipped, which opened Q1. D2 came from FIX-2448 and FIX-2459 disagreeing on `/internal`.
- **Analysis (Nov 5).** Q1 widened to three options, D3 narrowed, ER-1 and ER-6 tightened.
- **Other shapes and review round 1 (Nov 5).** FIX-2564 filed to land the legs first; leg b cut
  to tarball-only gaps behind the workspace ratchets; completions enforced statically; the export
  check on `packageExports` and a census, not Fallow; D1's triggers tightened; D3's helper
  widened; Q1's removal vehicle and *Shims* exemption written in.

**Open:** [Q1](#q1).
