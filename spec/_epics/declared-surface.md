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

- **FIX-1126 is the substance.** The getting-started sequence and both public blog posts teach
  `preset/*` model strings that were removed by FIX-516 and now `throw`. The documented
  first-run path ends in an unhandled exception at the exact moment a reader has the least
  context to diagnose it. **Its boundary is semantic, not textual.** A page that names
  `preset/*` as a *rejected* value, or that teaches the migration away from it, is telling the
  truth and stays; a broken example is in scope wherever it lives, including outside
  `apps/docs/`. Scoping by a count of textual matches gets both ends wrong — it deletes correct
  migration guidance and leaves the most prominent broken examples untouched.
- **FIX-1048 is the same defect one layer down**, and worse-shaped: a *type* that accepts four
  fields the runtime silently drops. A missing option fails loudly; a declared-and-ignored one
  compiles clean and looks configured. **Which way it resolves is not ours** — wiring the
  fields adds a capability, deleting them retracts an advertised one. It is open with the
  product owner (§5).
- **FIX-1052 is cheap rather than severe.** Its runtime consequence is unestablished — most
  likely a superset of what should be prefetched, not a misroute. It is kept because one line
  (`mergeDeclaredResources` stops mutating its target) closes it, closes FIX-1051, and closes
  an unfiled third variant. **If the fix grows past making that function pure, that is the
  signal something larger was found and it should be re-scoped, not absorbed.**
- **FIX-754 is the weakest, and it is kept rescoped.** Its filed harm — "redundant
  `block_output` echoes in the user-visible log" — was priced against a taxonomy that no longer
  exists. `block_output` is gone as a type (`packages/contracts/src/items/types.ts:702-716`),
  replaced by `block_trace`, which is a trace type and never reaches a client or a history
  (`docs/architecture/items.md:24`). A read of `main` closes the rest: **`.tap()` suppresses no
  item that `.step()` emits** — both dispatch through the same `runChild`, and the only delta
  is `recordSequentialChild` advancing the chain pointer, which for a block returning its input
  unchanged resolves to the identical ref. So the fix has **zero observable effect**, and its
  real scope is **two sites, not four**: `captureContext` in `patterns/src/response-auditor/index.ts`
  (~:51-62, wired at :213) and `stashTaskId` in `patterns/src/eventActors/index.ts` (:423, wired
  at :439). Both `tools/src/bash/blocks.ts` sites are **already correct** — the audit cited
  handler definitions rather than their wiring, which is `.workIf` at :951 and `.tapIf` at :953.

  **Kept, at two one-word edits.** Not for observable harm — there is none — but because the
  repo declares BP-012/BP-014 and this code contradicts them in the packages developers read as
  the model. That is this epic's objective applied to our own standards, which is the one place
  a "declared surface" epic cannot exempt itself. It also unblocks FIX-625 (the BP-014
  enforcement guard), which cannot land against known violations.

**Not doing.** This is four verified defects, not a sweep. An objective phrased as "everything
declared is true" invites an unbounded audit of every declaration in the framework; that is
explicitly not this epic, and a fifth site discovered during the work is filed, not folded.
Also out: **FIX-852** (model-layer complexity — a different objective, runs standalone after)
and **FIX-766** (`work` → `sideChain` — same family, but it became a public-contract and
persisted-format migration, so it takes the spec route and its own lifecycle).

## 2. Themes & long-horizon direction

1. **When a declaration and the runtime disagree, make the runtime true.** That is the epic's
   default and it binds every issue here. **One deliberate exception:** where the declaration
   was never meant to be supported, removing it from the type — so misuse fails at compile
   time — closes the gap just as well. **Taking that exception is not an implementer's call**,
   because it decides what the framework offers rather than how a fix is written. FIX-1048 is
   the only issue where both resolutions are available, and it is open in §5.

2. **A carrier PR names its passenger.** FIX-502 rides FIX-1126 and FIX-1051 rides FIX-1052
   rather than each getting its own row. The carrier's description names the passenger, or the
   passenger closes with no trace of what closed it. **The changeset names it too only where the
   carrier touches a publishable package** — that is FIX-1052/FIX-1051 alone. FIX-1126/FIX-502
   is docs-and-examples-only across private packages, which take no changeset at all
   ([`release-notes-workflow.md`](../../docs/contributing/release-notes-workflow.md)).

3. **No sequencing between the four.** They touch disjoint surfaces, can run in parallel, and
   can merge in any order. Stated because a four-issue epic invites a reader to look for the
   dependency graph, and there isn't one. The one near-seam — `docs/patterns/response-auditor.md`
   carries a stale preset example, and FIX-754 edits the block that page describes — is not a
   real collision: the page documents the pattern's composition, not its block output.

## 3. Shape of the whole *(POC)*

**`spec_poc: skipped`** — the trigger an end-state POC answers (*does the division into issues
hold once it's all there?*) does not fire: the four fixes touch disjoint files, share no seam,
and none creates surface another consumes.

What a POC would have shown, reading `main` showed directly and cheaper — and it is where every
scope correction in this epic came from, first at drafting (FIX-754's premise names a removed
item type) and again at review (that fix has no observable effect at all, and covers two sites
rather than four; FIX-1126's boundary is semantic rather than textual). Both are folded into §1
rather than discovered later in a worktree.

## 4. Running index

| Issue | What it delivers | Route | Spec PR | Impl PR | State |
|---|---|---|---|---|---|
| [FIX-1126](https://linear.app/fixpoint-labs/issue/FIX-1126) | Every stale `preset/*` example stops teaching syntax that throws; getting-started rewritten around `intent/*` (carries FIX-502) | **bug** | — | — | Todo |
| [FIX-1048](https://linear.app/fixpoint-labs/issue/FIX-1048) | `FlowInstanceOptions.webhooks/chat/schedules/mcp` either apply at instance creation or stop type-checking | **bug** | — | — | Todo |
| [FIX-1052](https://linear.app/fixpoint-labs/issue/FIX-1052) | `mergeDeclaredResources` stops mutating its target, so `ownDeclaredResources` stays a block's own (carries FIX-1051) | **bug** | — | — | Todo |
| [FIX-754](https://linear.app/fixpoint-labs/issue/FIX-754) | Two state-only blocks stop declaring an `outputSchema` and returning their input (BP-012/BP-014); unblocks FIX-625 | **bug** | — | — | Backlog |

*Every row is `direct` route, so **no row will ever carry a spec PR** — an empty Spec PR cell
here is correct by design, not a gap ([`orchestration.md`](../../docs/contributing/orchestration.md)
→ "Which issues get a spec"). Each row's per-issue evidence and implementer notes live on its
Linear issue, not here.*

## 5. Open cross-cutting questions

- **Do the four dead `FlowInstanceOptions` fields get wired, or deleted?** Raised by review on
  this PR. It is theme 1's exception, and it is the one issue where both resolutions are
  genuinely available — so it is a call about what the framework offers, not about how a fix is
  written. **With the product owner**, alongside the objective gate. **Blocks FIX-1048 only**;
  the other three proceed either way.

  *The ask:*

  - **The fork.** Should creating a flow instance be able to override webhooks, chat, schedules
    and MCP — or do we retract that promise?
  - **Plain terms.** Our type says you can hand these four transport settings to a flow when you
    create it. The runtime ignores them. Wiring them means one flow definition can be reused
    under different transports — the same app served to two tenants on two webhook endpoints.
    Deleting them means transports belong to the definition, and passing them stops compiling.
  - **The trade-off.** Wiring is real work — four merge paths and their tests, mirroring how
    `voice` already does it — for a capability nobody has asked for. Deleting is small and
    honest and costs no migration at `0.0.0`, but it takes back something the type has been
    advertising.
  - **My recommendation: delete the four fields.** Nothing in the repo passes them, we have no
    per-instance transport use case, and while we're unpublished we can add the capability back
    the day someone wants it — as a feature with a real requirement behind it, rather than as
    four fields we guessed at.
  - **What would change my mind.** A concrete near-term need to run one flow definition under
    two transport configurations. Multi-tenant webhook endpoints is the obvious shape; if that's
    on the roadmap this quarter, wire them now.
  - **Cost of being wrong.** Low and reversible both ways while unpublished. Delete wrongly and
    we add it back later as a normal feature. Wire wrongly and we maintain four merge paths and
    their tests for something unused.

  *Either way, FIX-1048's PR adds a `packages/core/test/flow.test.ts` assertion — no
  instance-override test exists today, which is how four fields stayed dead unnoticed.*

- **Does the objective imply a fifth issue — a guard that keeps this from recurring?**
  Raised here, at authoring. FIX-516 removed `preset/*` from the framework and the docs went on
  teaching it, unnoticed, until an audit found them. This epic restores truth today and does
  nothing about tomorrow: the next removal repeats it. Whether we spend on a check that fails CI
  when a doc example uses removed syntax is a scope-and-timing call, not an engineering one.
  **Blocks nothing** — all four issues proceed either way.

  *The ask:*

  - **The fork.** Fix the stale examples and move on, or also build a guard that catches the next one?
  - **Plain terms.** Our docs can teach code that crashes, and nothing tells us. It happened
    once and took months to notice. A guard would compile-check the examples in our docs so it
    fails our own build instead of a reader's first run.
  - **The trade-off.** The guard is real work (docs examples aren't currently compiled at all)
    and it is not this epic's four verified defects — it's a fifth, larger, unscoped one.
    Without it, the same class of failure returns on the next syntax removal, and the cost is
    paid by whoever is evaluating FSD that week.
  - **My recommendation: fix the stale examples now, file the guard separately, don't fold it in.**
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
- **After epic review (round 1)** — trimmed §2 from six themes to three, because the four
  themes cut were per-issue implementation briefs and this epic has no sub-issue specs for them
  to coordinate; they now live on the Linear issues they belong to.
- **After epic review (round 1)** — FIX-754's keep is now argued on standards conformance and
  on unblocking FIX-625, not on observable harm, because reading `main` established there is
  none: `.tap()` suppresses no item `.step()` emits, and the real scope is two sites, not four.
- **After epic review (round 1)** — theme 1's compile-time-removal exception stopped being the
  implementer's call and became an open question with the product owner, because choosing it for
  FIX-1048 adds or retracts a capability rather than settling how a fix is written.
- **After epic review (round 1)** — FIX-1126 is scoped by semantically stale usage rather than
  by textual match, because the file count included pages that correctly teach the migration and
  excluded broken examples living outside `apps/docs/`.
