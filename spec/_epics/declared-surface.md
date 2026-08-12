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

This is the last cheap moment. `@flow-state-dev/core` and `@flow-state-dev/patterns` are both
`0.0.0` and unpublished, so none of these has an external consumer to migrate today. Two of
them are nonetheless already written down as contracts — FIX-1048's four type fields and
FIX-754's exported block — and that is what decides how each is gated, below.

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
- **FIX-754 is the one that grew under review, twice.** Its filed harm —
  "redundant `block_output` echoes in the user-visible log" — was priced against a taxonomy that
  no longer exists. `block_output` is gone as a type
  (`packages/contracts/src/items/types.ts:702-716`), replaced by `block_trace`, which is a trace
  type and never reaches a client or a history (`docs/architecture/items.md:24`). That much
  stands, and so does the runtime reading behind it: **`.tap()` suppresses no item that
  `.step()` emits** — both dispatch through the same `runChild`, and the only delta is
  `recordSequentialChild` advancing the chain pointer.

  **"Zero observable effect" does not stand, and is withdrawn.** `captureContext` is exported
  from `@flow-state-dev/patterns` (`packages/patterns/src/index.ts:86`) — a publishable package,
  with no `private` field and `publishConfig.access: "public"` — and
  `apps/docs/docs/patterns/response-auditor.md:250` explicitly invites flow authors to remix it.
  Dropping its `outputSchema` and identity return changes a third-party `.step(captureContext)`
  from receiving `{ userInput, response }` to receiving **`undefined`, silently**.
  `block_trace.output` changes for all four blocks as well
  (`packages/engine/src/context/createExecutionContext.ts:3484-3486,3509`). **In-repo nothing
  breaks** — `.tap()` returns `{ value }` unchanged
  (`packages/core/src/blocks/sequencer.ts:1930,1963`), so the downstream `.map` chains at
  `response-auditor/index.ts:214` and `eventActors/index.ts:440` are fine. The breakage is
  **external only**, and with both packages unpublished there is no external consumer to break
  today. What the change reaches is the contract, not a live migration — and that is enough to
  gate it.

  **The scope is four handler definitions, not two.** BP-012's second clause governs the
  *definition*, not the wiring: *"Such handlers must not declare `outputSchema` and must not
  `return input`"* (`docs/contributing/best-practices/blocks.md:20-28`). `.tapIf`/`.workIf`
  wiring satisfies one clause only, so all four are non-compliant — `ensureSandbox`
  (`packages/tools/src/bash/blocks.ts:780`, `:787`), `purgeStaleContainers` (`:800`, `:815`),
  `stashTaskId` (`packages/patterns/src/eventActors/index.ts:426`, `:430`, `.step`→`.tap` at
  `:439`) and `captureContext` (`packages/patterns/src/response-auditor/index.ts:54`, `:61`,
  `.step`→`.tap` at `:213`). The two bash *wirings* are already correct (`.workIf` at `:951`,
  `.tapIf` at `:953`); only their definitions change.

  **Kept, and now on the spec route.** Still not for observable harm inside this repo — but
  because the repo declares BP-012/BP-014 and this code contradicts them in the packages
  developers read as the model. That is this epic's objective applied to our own standards,
  which is the one place a "declared surface" epic cannot exempt itself. It also unblocks
  FIX-625 (the BP-014 enforcement guard), which cannot land against known violations — and could
  not have at the two-site scope, since the two it missed are violations too.

  **But the price went up, so "is it three?" is a live question rather than a rhetorical one.**
  It was kept as two one-word edits with no gate. It is now four definitions, a spec, a spec
  gate, a docs section to reconcile, and a changeset. That is still small, and the FIX-625
  unblock is still real — but it is no longer free, and this is the row to cut if the set has to
  give one up.

**One issue now carries a spec gate.** FIX-754 changes an exported, documented block contract in
a publishable package, and `orchestration.md:245-248` sends exactly that back: a purported bug
whose fix *"changes a contract other code depends on"* is promoted, because a contract change
must not reach `main` through the one route with no gate in front of it. Its Linear category is
now **Improvement**. **So this epic has two approvals ahead of it, not one** — this objective,
and then FIX-754's spec. The other three stay on the direct route, where the implementation PR
is the only gate.

**Not doing.** This is four verified defects, not a sweep. An objective phrased as "everything
declared is true" invites an unbounded audit of every declaration in the framework; that is
explicitly not this epic, and a fifth site discovered during the work is filed, not folded.
Also out: **FIX-852** (model-layer complexity — a different objective, runs standalone after)
and **FIX-766** (`work` → `sideChain` — same family, but it grew into a persisted-format
migration with a rollout, an order of magnitude larger than anything here, so it runs its own
lifecycle). **The reason is the size and the migration, not the route:** FIX-754 is spec-route
now too and stays in the set.

## 2. Themes & long-horizon direction

1. **When a declaration and the runtime disagree, make the runtime true.** That is the epic's
   default and it binds every issue here. **One deliberate exception:** where the declaration
   was never meant to be supported, removing it from the type — so misuse fails at compile
   time — closes the gap just as well. **Taking that exception is not an implementer's call**,
   because it decides what the framework offers rather than how a fix is written.

   **Two issues can take it, and they are gated differently.** FIX-1048 — wire the four fields
   or delete them — is open with the product owner in §5, because there is no other gate in
   front of it. FIX-754 reaches the same fork one level up: keep exporting `captureContext` as a
   `.tap`-only block, or unexport it so a `.step(captureContext)` stops compiling. That one is
   settled in FIX-754's spec and signed off at its spec-approval gate, which is what the
   promotion to the spec route bought. Neither is decided in a diff.

2. **A carrier PR names its passenger.** FIX-502 rides FIX-1126 and FIX-1051 rides FIX-1052
   rather than each getting its own row. The carrier's description names the passenger, or the
   passenger closes with no trace of what closed it. **The changeset names it too only where the
   carrier touches a publishable package** — that is FIX-1052/FIX-1051 alone. FIX-1126/FIX-502
   is docs-and-examples-only across private packages, which take no changeset at all
   ([`release-notes-workflow.md`](../../docs/contributing/release-notes-workflow.md)).

3. **One sequencing constraint, and it is FIX-754 → FIX-1126.** Every other pair is disjoint:
   different files, parallel, any merge order. The exception is one page. FIX-1126 edits
   `apps/docs/docs/patterns/response-auditor.md` for stale `preset/*` strings (`:67`, `:147`,
   `:193`), while FIX-754 decides whether `captureContext` stays exported — which is precisely
   what `:246-250` of that same page documents ("The internal blocks … are exported for flow
   authors who want to remix the pipeline"). **FIX-1126 must not rewrite `:237-250`.** That
   section is FIX-754's to reconcile once its spec settles the export, or the two coordinate
   explicitly before either touches it. Recorded because the earlier reading of this seam — "the
   page documents the pattern's composition, not its block output" — was wrong: the page
   documents the export contract itself, which is the thing FIX-754 changes.

## 3. Shape of the whole *(POC)*

**`spec_poc: skipped`** — still skipped, but no longer for the reason first given. The original
justification was that the four fixes touch disjoint files and share no seam; round 2 falsified
both halves, because FIX-754 reaches an exported contract and a docs section FIX-1126 also
edits. The skip now rests on something narrower: the seam is **known and named** (theme 3), and
the artifact that settles it is FIX-754's spec, which the promotion to the spec route requires
anyway. An end-state POC asks whether the division into issues holds; it does — the one place
the issues rub is a documentation section with a named owner, and rendering four independent
fixes would show nothing the constraint statement doesn't already say.

**What reading `main` bought, and what it cost.** Every scope correction here came from reading
`main` rather than from a POC, and one of those readings was wrong. It established correctly
that `.tap()` suppresses no item `.step()` emits — then concluded "therefore zero observable
effect", having never left the runtime to check the package's export surface or the docs page
describing it. Review round 2 caught it. Kept as this epic's own evidence standard, since the
epic is about honest declarations: **a claim about what is observable has to be checked at the
boundary the observer is standing on**, not only at the layer the change is made in.

## 4. Running index

| Issue | What it delivers | Route | Spec PR | Impl PR | State |
|---|---|---|---|---|---|
| [FIX-1126](https://linear.app/fixpoint-labs/issue/FIX-1126) | Every stale `preset/*` example stops teaching syntax that throws; getting-started rewritten around `intent/*` (carries FIX-502) | **direct** | — | — | Todo |
| [FIX-1048](https://linear.app/fixpoint-labs/issue/FIX-1048) | `FlowInstanceOptions.webhooks/chat/schedules/mcp` either apply at instance creation or stop type-checking | **direct** | — | — | Todo |
| [FIX-1052](https://linear.app/fixpoint-labs/issue/FIX-1052) | `mergeDeclaredResources` stops mutating its target, so `ownDeclaredResources` stays a block's own (carries FIX-1051) | **direct** | — | — | Todo |
| [FIX-754](https://linear.app/fixpoint-labs/issue/FIX-754) | Four state-only handler definitions stop declaring an `outputSchema` and returning their input (BP-012/BP-014); settles whether `captureContext` stays exported; unblocks FIX-625 | **spec** | *not yet opened* | — | Backlog |

*Route is derived from each issue's Linear category on every refresh
([`orchestration.md`](../../docs/contributing/orchestration.md) → "Which issues get a spec"),
and this set is **mixed**. The three `direct` rows will never carry a spec PR — an empty Spec PR
cell there is correct by design, not a gap. **FIX-754 is the one `spec` row**: its Spec PR cell
is a real gap until that PR opens, and it is the only row with a spec-approval gate in front of
implementation. Each row's per-issue evidence and implementer notes live on its Linear issue,
not here.*

## 5. Open cross-cutting questions

- **Do the four dead `FlowInstanceOptions` fields get wired, or deleted?** Raised by review on
  this PR. It is theme 1's exception — a call about what the framework offers, not about how a
  fix is written. It comes to you here rather than in a spec because FIX-1048 is a direct-route
  row with no gate of its own; FIX-754's version of the same fork is settled at its spec gate
  instead. **With the product owner**, alongside the objective gate. **Blocks FIX-1048 only**;
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
    The four issues here are small and individually verified — one of them twice over, after
    review corrected it. Adding an unscoped infrastructure issue to that set is exactly the
    "does the whole overbuild" failure this epic-spec exists to catch, and filing it keeps it
    from being forgotten without holding this epic's objective open.
  - **What would change my mind.** If we're near a public launch of the docs site, the
    recurrence risk stops being theoretical and the guard becomes part of shipping them.
  - **Cost of being wrong.** Low and reversible either way. Fold it in and this epic grows an
    unbounded issue. Defer it and the worst case is a second doc-cleanup pass later — annoying,
    not expensive, and cheaper while we're pre-1.0 with no external consumers.

- **What FIX-754's spec owes — recorded here, but not an ask to you now.** Promoting the row
  moved this decision into a document, and it reaches you as that spec's approval gate rather
  than alongside the objective. Naming it here so the spec author inherits it and a sibling
  issue doesn't reopen it:

  - **The export, either way, in writing.** Either `captureContext` stays exported as a
    `.tap`-only block — and `apps/docs/docs/patterns/response-auditor.md:246-250` stops
    describing it as something an author can `.step()` into a custom pipeline — or it is
    unexported and that remix affordance is retracted for it. What the spec must not do is
    change the block and leave the page saying the old thing. This is also the FIX-1126 seam in
    theme 3; the page section has one owner and it is this spec.
  - **A changeset.** `@flow-state-dev/patterns` is publishable, so this row takes one under
    BP-022. Theme 2's changeset rule is about a *carrier* naming its passenger and doesn't reach
    here — FIX-754 carries nobody — but the plain requirement still applies, and the row was
    previously assumed changeset-free at its old scope.
  - **A dead import to clear while there.** `packages/patterns/test/response-auditor.test.ts:7`
    imports `captureContext` and never uses it.

  **Blocks nothing else.** The other three proceed regardless; only FIX-754 waits on its own
  gate.

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
  *(Partly superseded in round 2 — the conformance argument holds; "no observable harm" and the
  two-site scope do not.)*
- **After epic review (round 1)** — theme 1's compile-time-removal exception stopped being the
  implementer's call and became an open question with the product owner, because choosing it for
  FIX-1048 adds or retracts a capability rather than settling how a fix is written.
- **After epic review (round 1)** — FIX-1126 is scoped by semantically stale usage rather than
  by textual match, because the file count included pages that correctly teach the migration and
  excluded broken examples living outside `apps/docs/`.
- **After epic review (round 2)** — FIX-754's "zero observable effect" is **withdrawn**.
  `captureContext` is an export of a publishable package that the docs invite authors to remix,
  so dropping its output contract silently changes a third-party `.step()` to `undefined`, and
  `block_trace.output` changes for all four blocks. In-repo nothing breaks — `.tap()` passes
  `{ value }` through untouched — so the breakage is external only, and it is a contract change
  rather than a live migration.
- **After epic review (round 2)** — FIX-754's scope is **four handler definitions, not two**,
  because BP-012's second clause governs the handler definition and `.tapIf`/`.workIf` wiring
  satisfies only the first. The two bash handlers were wrongly cleared on their wiring; their
  definitions still declare `outputSchema` and return their input.
- **After epic review (round 2)** — FIX-754 moved from the **direct route to the spec route**
  and its Linear category from Bug to Improvement, because a fix that changes a contract other
  code depends on is promoted rather than passed through the ungated route
  (`orchestration.md:245-248`). The epic now has one spec-approval gate alongside the objective
  gate; §1 and §4 no longer say the set is uniformly direct.
- **After epic review (round 2)** — theme 3 stopped claiming the four are independent. FIX-754's
  export decision governs `response-auditor.md:246-250`, and FIX-1126 edits that same page, so
  the near-seam is a real constraint: FIX-1126 leaves that section alone, or the two coordinate.
