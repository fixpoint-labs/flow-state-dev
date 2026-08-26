# Epic — Reconcile the two durable-storage primitives (symmetry, not merger)

| | |
|---|---|
| **Epic issue** | [FIX-1157](https://linear.app/fixpoint-labs/issue/FIX-1157/reconcile-the-two-durable-storage-primitives-symmetry-not-merger) (`Epic` · `Enabler`) |
| **Project** | Framework simplification & cleanup |
| **Branch / doc** | `epic/durable-storage-symmetry` · `spec/_epics/durable-storage-symmetry.md` |
| **PR** | [#1365](https://github.com/fixpoint-labs/flow-state-dev/pull/1365) — never merged, never deleted; open for the life of the epic |
| **Gate** | An approving human comment or review on the epic PR, or the owner's `epic approved` label, signs off §1 only |
| **Status** | **Converged** — objective and themes are settled, so **below-the-bar, child-local** feedback routes to the children as implementer notes rather than into this document. **Two things are still recorded here:** an owner's resolution of a §5 fork, and a post-convergence epic-level correction — an uncontested factual fix, or a cross-cutting decision no single child can own. Convergence bounds *folding*, not the epic's durable record |

---

## 1. Purpose & objective *(the gated sign-off surface)*

**Objective.** FSD stores durable data two ways at session scope and above — the scope-state
bag (`ctx.session.state`) and resources (`ctx.resources.<name>`). Today a developer picks
between them by **which API happens to carry the verb they need**, not by where the data
belongs: a named increment or append verb means scope state (`incState` / `pushState` on
`ScopeStateOps`, `core/src/types/state.ts`), per-key versioning and collision detection
means resources — the resource handles carry no delta verb at all
(`core/src/types/resource.ts`). The operating rule is **symmetry where it is
safe, and the asymmetry stated once where it is not**: one mutation contract wherever the two
primitives can share one without
importing each other's semantics, and where they cannot, the reason written down in a single
place a reader hits *before* reaching for the wrong import rather than after.

**This cycle closes the increment/append gap and maps the rest** — decided by the owner in
[D-6](https://github.com/fixpoint-labs/flow-state-dev/issues/1446), Ask 1 = **A** (amended
2026-08-26; it read **B**, *document the gap*, from 2026-08-25). `incState` /
`pushState` **ship** (FIX-1269): the bag already carries these verbs, two live callers cross the
primitives, and a documented gap is a worse foundation than the two methods that close it.
Decision 3 follows — the write-up becomes **API documentation**, not a withheld-gap story. Every
*other* difference is still **mapped, not closed** (FIX-1154).

**What ships is API symmetry, not a contention win.** Tier 1 adds the two verbs to the handle types
and touches no store interface: **no store-native delta verb and no contention improvement** —
concurrent increments still resolve by CAS retry as `updateState` does today.
**CAS atomicity is preserved**, because the verbs ride the read-modify-write *inside* the CAS
loop, which re-runs the mutator against the winner's row on every conflict.
**Nor does the deferred store-native half win contention**
— under this epic's held-version constraint it buys smaller writes, not fewer
conflicts (theme 2, Decision 2).

*Citations are against **`origin/main`**, read explicitly (`git show origin/main:<path>`) — never
this branch's checkout, which is cut from `6aa1bea` and never moves. **Cite by symbol; a line number
is a hint.** No commit is pinned: a spec is implemented against `main`.*

**This epic does not merge the two primitives and does not delete either one.** It originally
proposed collapsing them by deprecating scope state at session/user/org. That thesis was
tested and abandoned (see *Rejected framings* in §2); the trial removal PR
[#1291](https://github.com/fixpoint-labs/flow-state-dev/pull/1291) was closed unmerged and
FIX-1153 was cancelled. The divergence turned out to be load-bearing rather than accidental
(theme 1). What changed is the conclusion drawn from the overlap — not *delete the bag*, but
*stop making callers pick a primitive by its verb list*.

**Holistic necessity — two substantive issues, one lodger, two parented bugs. That is the
honest description of a small set.**

- **FIX-1154** (the mutation surface — **the map**: every remaining difference between the two
  mutation surfaces recorded in its own spec, each one deliberate-with-a-reason or deferred)
  *is* the epic. Without it nothing here delivers.
- **FIX-1269** (the handle verbs — `incState` / `pushState`) is what D-6 = **A**
  added. **Tier 1 only**: the handle surface, not the store interface.
- **FIX-1158** (cross-flow resource validation never runs) is a **same-subsystem
  unintended-asymmetry lodger** — the epic's own thesis pointed at itself, where the
  architecture doc already promises the two primitives behave alike and the code silently
  doesn't.
  **It would ship independently and needs no epic parentage — and it has:**
  PR [#1444](https://github.com/fixpoint-labs/flow-state-dev/pull/1444) merged, the issue is
  Done. It is kept on that footing and no other. *That does not reopen the
  epic-classification fork (§5, resolved): the condition stated there was FIX-1158 merging
  before FIX-1154 was **specced**, and FIX-1154 has been in spec review since before this
  merge.* Shared-surface coordination is a convention for the children (theme 3), never proof
  that they are a set.
- **FIX-1155** (request-scope CAS vs block-scope mutex) is an asymmetry *inside* scope state,
  completing FIX-492 for the one scope it deferred; it would read identically if resources
  did not exist. **Shipped** — PR [#1388](https://github.com/fixpoint-labs/flow-state-dev/pull/1388)
  merged (`864fdfa2`, 2026-08-22) without the epic ever taking it on as a workstream, which
  **answers §5's fork by events** rather than by a decision.
- **FIX-1207** (overlapping collection keyspaces slip past the cross-flow check) is FIX-1158's
  **spun-off remainder** — no theme, no decision at this altitude.
- **FIX-1258** (a deleted resource revived by a write issued after the delete — the version-`0` hole
  in theme 1's tombstone row) and **FIX-1260** (a resource **mutation** write stores `safeParse`
  *output*, so a transforming schema drifts what lands), both from FIX-1154's
  spec review, are **parented children this epic surfaced, not work the objective needs**. The
  boundary rule — **epic membership is not a severity queue** — is why FIX-1259 and FIX-1207 are
  not children at all; it lost the argument for these two, so they are ordinary children with
  everything that follows (§4).

**What the objective needs is FIX-1154 and FIX-1269.** The FIX-1158 lodger and FIX-1155 have both
shipped. **The four surfaced bugs split two and two:** FIX-1259 and FIX-1207 are unparented and out
of the index; **FIX-1258 and FIX-1260 stay children.** The unparent write was skipped and is not
being re-asked (§5), so **the Linear graph is the only ledger** — a parented, non-terminal child is
dispatched like any other child and holds wrap open until it is fixed or cancelled (§4).

Whether this is an epic at all was asked twice and is **decided: it stays an epic** (§5, resolved)
— an engineering call, since both outcomes are cheap and reversible.

**Not doing:** merging the two primitives; deleting or deprecating either one at any scope;
re-attempting the org-state removal; cross-record atomicity (FIX-854); and resource-specific
surface with no state analogue — content, `client`, `reactTo`, `edges`, collections.
**One pair of verbs closes; the rest is only mapped** (D-6, above) — and most of it is out of
scope **by construction**. The one thing **deferred rather than absent** is the
**store-native** delta layer (`incField` / `pushToArray`) — FIX-1267, next to FIX-992 (theme 2,
Decision 2). Do not read the shipping handle verbs as that work.
**No child deprecates, removes, or
migrates a primitive** — every one of them fixes, generalizes, or documents. A child that
finds itself proposing a removal has hit the rejected framings in §2 and comments up on this
PR rather than deciding locally.

## 2. Themes & long-horizon direction

Three cross-cutting decisions. **A constraint that binds exactly one issue is not a theme and is
not recorded here** — it belongs on that issue's spec or PR
([`epic-spec-template.md`](../../docs/contributing/epic-spec-template.md) → *Out of scope*). The
epic carrying a second copy is how a shipped child's design drifts: the two that used to sit
below the themes had both gone stale against the code that merged.

1. **The two CAS drivers cannot be shared, only eliminated — and this epic eliminates
   nothing.** `stores/cas.ts` and `stores/resource-cas.ts` drive the same load → mutate →
   persist shape, but their conflict *policy* differs on three counts, and `cas.ts`'s own
   header states them: a conflict against a deleted resource and a losing create-if-absent are
   **terminal** on the resource driver where the scope driver retries every conflict; the
   resource driver suppresses a no-op against a **re-read** version where the scope one decides
   before `persist`; and only the resource driver takes an `AbortSignal`. `resource-cas.ts`'s
   module header carries an eight-row policy table naming the failure a shared driver would
   produce in each case — overwriting a create-if-absent winner, persisting after cancellation,
   silently dropping a deliberate write as a no-op, and, against a tombstone, **retrying until
   the budget is exhausted and throwing a generic `ConcurrentModificationError`** where the
   resource driver fails immediately with a distinct `ResourceDeletedError`.

   **The root is that the two stores model *deletion* differently — not that only one of them
   has a lifecycle.** Both delete, and both have create-if-absent: resources encode it as
   version `0`, scope stores as the `"absent"` sentinel (`session-routes.ts:194` wins the
   create race with it). What differs is whether a delete stays **visible to a version check**.
   Resource state tombstones, so a stale writer holding a live version is refused.
   `SessionStore.delete` is a **hard delete with no tombstone**: a recreated id may reuse
   versions, and an observer holding a pre-delete version can match the record that replaced
   it. `SessionStore.set`'s contract (`stores/types.ts`) states exactly that and declines to defend
   it — *"this store's versions are not a substitute for identity"* — and `handleDeleteSession` is a live caller
   (`routes/session-routes.ts:231`). **Nothing on the scope write path supplies that identity
   either.** `checkScopeWriteVersion` (`stores/scope-write-predicate.ts`) compares the stored
   version against `expectedVersion` and reads nothing else — and its numeric branch reads an
   **absent record as version `0`**. Numeric `0` is what a container's first CAS state write
   passes (`MemoryStateContainer`'s `initialVersion` defaults to `0`, `stores/state-container.ts`);
   on the ordinary path the record already exists at v0, created through `"absent"`
   (`ensure-session-record.ts:48`) or `"any"` (`createExecutionContext.ts`, the user / org / request
   record creates), so `0` matches a **live** row as intended.
   Because absence also reads as `0`, the same write lands when the row is *gone*.

   **This document previously called that "not a bag-side hole", and the reason was wrong** —
   which is why **FIX-1259 was reopened** after being cancelled on it. It sits at
   **Backlog · High and outside this set**,
   unparented and re-filed as a FIX-1000 leftover (§5). The old
   reasoning was that refusing a version-`0` write would break first touch, so the behaviour had
   to stay. First touch is not spelled `0`: it is spelled **`"absent"`**, and the predicate's own
   header says `0` could not express create-if-absent "without breaking the first CAS write of
   every new scope record". The writer that actually reaches this is a **held-then-lost writer,
   not a first-touch one** — it read the record at a live version, lost the race to a delete, and
   is then *handed* `0` by the retry path: `checkScopeWriteVersion` reports `currentVersion =
   current?.version ?? 0` = `0` for the now-absent row (`scope-write-predicate.ts:66`), and
   `runWithCAS` commits that into the container before retrying (`cas.ts:169-171`). Its next
   attempt passes `0`, the numeric branch matches absence, and the hard-deleted record is
   **recreated by a writer that did observe it**. Those two writers are distinguishable, so
   refusing this one costs first touch nothing. **The conclusion below is untouched:** the
   divergence is still **tombstoned generations versus hard-deleted, recreatable records**, and
   the fix is FIX-1259's, not this epic's.

   The resource side differs precisely because it *has* a tombstone and
   a deleted-stays-deleted bet, so its predicate intends to refuse and misses `0`. A neighbouring
   scope-side case — work still running when a delete lands, writing into a session after it
   was emptied — is filed as **FIX-1000**, a FIX-992 residual **outside this set** and not
   a member of §4's index.

   **`lineageId` is not the missing discriminator** — the epic said so and was wrong. It is the
   inherited **storage address** for `sharedToWorkstream` session-scoped resources (FIX-1068,
   `resources/lineage-scope.ts`): it decides *where* such a resource stores, so a background
   session and its parent address the same rows. No file on the scope write path references it,
   and scope CAS never compares it. Recording it here because the opposite reading — that a
   fresh lineage on recreate protects a stale scope write — is the natural misreading of
   `session-routes.ts:181-184`, and this document made it.

   **The header's tombstone row names the wrong outcome, and FIX-1154 fixes it in place.** That
   row says a shared driver's retry lands because *"the tombstone's version matches"*. A version
   match is necessary, not sufficient: `checkWriteVersion` requires `isLive && row.version ===
   expectedVersion` for **every positive** expected version (`resource-state-predicate.ts:145-156`),
   and a tombstone is not live. So `runWithCAS` refreshes to the tombstone's retained version
   (`cas.ts:170-171`), conflicts again on every attempt, and exhausts its budget into
   `ConcurrentModificationError`. **Nothing is resurrected on a positive version** — that outcome
   belongs only to version `0` (next paragraph), and the two were conflated. The rationale is
   untouched and still good: a distinct terminal error beats a retry storm ending in a generic
   one. **This correction is FIX-1154's to land, not this branch's** — the header is shipped code
   and the epic PR is docs-only and never merges, so it rides the re-citation pass above or it
   does not ship at all. The neighbouring rows were checked while here: create-if-absent
   overwrite, persist-after-cancellation and the dropped no-op all hold.

   **What that correction moved.** The *conclusion* is unchanged and slightly stronger: the
   drivers stay separate, and no issue in this set may propose unifying them. It gets stronger
   because a shared driver would now have to serve two stores that **both** delete and
   **disagree about whether a delete is visible to a version check** — a sharper conflict than
   one store having a lifecycle the other lacks. What was resting on the wrong reason is the
   justification alone: *"resources have a lifecycle, scope records do not; a session always
   exists, so absent-vs-deleted never arises there"* was false on both clauses, and it is the
   wording that must not be copied anywhere (see **Constrains**).

   **The tombstone row is incomplete for version `0` — a known hole in this rule, not a second
   rule.** The row is true for a writer holding a live version, and that writer is already
   refused. It is false for version `0` — and **the condition is the version the write begins with,
   not what the context has observed.** `runResourceCAS` sends the container's version as the
   `mutate` intent's `expectedVersion` (`runResourceCAS`), and `checkWriteVersion` accepts
   `0` against a tombstone as create-if-absent, "satisfied by a tombstone as well as a key that never
   existed" (`resource-state-predicate.ts`). **Two *mutations* arrive holding `0`.** One never
   observed the key. The other observed it and **lost the version**: `deleteResourceKey` pairs its
   durable delete with an *in-place live-cache delete* (`resource-registry.ts`), so a context still
   holding a `ResourceRef` re-seeds from the absent row and writes at `0`. The second is the
   **held-then-lost** writer this theme already describes on the scope side for FIX-1259 — the same
   shape on the other primitive, which is why the two issues carry a `related` link. The product bet
   is unchanged — deleted stays deleted — it is simply not enforced on that path.

   **This cycle adds two new entry points to the hole, and the hole is still open — say so
   rather than discovering it later.** `updateState` already does exactly this on `main` today
   with no new verb involved, so the hole exists whatever this epic ships. But D-6 = **A** ships
   `incState` and `pushState` onto the **same resource write path** `updateState` already takes,
   at held version `0` (theme 2), so the count of ways in goes from one to three. That is a known,
   accepted cost of Ask 1 = A and not a reason to reopen it: the verbs inherit the defect of the
   path they reuse rather than introducing one, and closing it once at the predicate fixes all
   three. **FIX-1269 must not grow its own version handling to route around this** — a local
   workaround in the new verbs would leave `updateState` broken and put the fix in the wrong
   layer.

   **Constrains FIX-1258 — the predicate is the right place, and getting there requires splitting
   intent first.** The *where* above is unchanged; what it cannot do is simply tighten the rule it
   enforces today. `checkWriteVersion(row, expectedVersion)` takes **no operation intent**
   (`resource-state-predicate.ts`), and by the time it runs the two cases are indistinguishable:
   `runResourceCAS` derives `expectedVersion` as a literal `0` for the `create` intent and
   `container.getVersion()` for `mutate`, which *is* `0` for a key never read or one whose cache
   entry a delete evicted, so both collapse to the same value at that expression (`resource-cas.ts`;
   the driver's header states the general form — *"by the time a value reaches the store the caller's
   intent is gone"*). So refusing `0` against a tombstone outright would also refuse **explicit
   recreation after a delete** — and that behaviour is **intentional prior art, tagged FIX-992**,
   not incidental. It is pinned in **two** suites (*"classifies a create over another context's
   delete as a create"*, `resource-cas-registry.test.ts`; *"…as created, not updated (FIX-992)"*,
   `test/context/resource-registry.spec.ts`) and published as contract in
   `docs/architecture/state-and-scopes.md` (*"`0` means no live row, so it is create-if-absent and a
   tombstone satisfies it"*). **That documentation is correct as written and is not stale**, and a
   naive predicate change would reverse a decision someone already made deliberately — those pinned
   tests are the record of it, not obstacles to route around. **The constraint:** `create` keeps its
   tombstone-accepting behaviour, a mutation that began at the absent-row seed is refused, and the
   split happens **before the shared predicate**. **Which mechanism achieves that is FIX-1258's** —
   this bounds the fix, it does not design it. Verified against `origin/main`; evidence in
   [comment `5430745011`](https://github.com/fixpoint-labs/flow-state-dev/pull/1365#issuecomment-5430745011).

   **Scope state already carries the vocabulary the resource side lacks** — a genuine asymmetry
   between the two primitives, and one this epic hit through a defect rather than through
   FIX-1154's map, which is why it is recorded in this theme. `checkScopeWriteVersion`
   (`scope-write-predicate.ts`) has an **`"absent"` sentinel distinct from numeric `0`**, and its
   comment names the exact problem: *"An absent record reads as version `0` — the pinned behaviour
   that leaves `0` unable to mean 'must not exist'."* That is a precedent for the **shape** — a
   distinct `ExpectedVersion` value carrying intent — and **not a value to copy across**. The
   semantics are opposite where it counts: scope's `"absent"` *refuses* an existing record, where
   resource `create` must keep *accepting* a tombstone; and `ResourceStateStore` already rejects
   `"absent"` rather than aliasing it (`assertExpectedVersion`), precisely so the sentinel never
   acquires a second meaning. **This epic does not unify the two `ExpectedVersion` vocabularies.**
   Stating an asymmetry is this document's job; proposing the merger is the move theme 1 exists to
   refuse, and a child that reads the precedent as "port `"absent"` to resources" has taken it. The limitation is still *pinned at the
   child* rather than left implicit — FIX-1154's characterization POC carries a row named
   *"CURRENT BEHAVIOUR (defect D5): a version-0 context REVIVES a tombstone"*
   (`spec-poc/FIX-1154-resource-mutation-verbs/policy-rows.poc.test.ts`, PR
   [#1445](https://github.com/fixpoint-labs/flow-state-dev/pull/1445)) that asserts today's
   wrong behaviour and **fails when the fix lands**, which is the intended signal.
   **FIX-1258** owns closing it, and **no theme waits on it** — that is the only exemption this
   document can grant. It is a child of FIX-1157, so it is dispatched like any other child and it
   gates wrap (§4).

   **Constrains:** FIX-1154's "shared driver seam" question resolves to *state the divergence
   once*, not *reconcile the drivers*; no issue in this set may propose unifying them. **The
   eight-row table stays in `resource-cas.ts`'s header** — the gap is a missing guard at the
   point of temptation, not a misplaced table. FIX-1154 closes it with a doc comment on
   `createScopeStateOps` (exported from `stores/index.ts` and the package root — the surface
   people actually autocomplete) and a weaker one on `createScopePersist` (internal to
   `createExecutionContext`), and re-cites the header's stale `cas.ts` references by **symbol
   rather than line number**. The evidence behind the reversal is FIX-1154's spec's to carry.

   **The guard comment states the divergence as tombstoned generations vs hard-deleted,
   recreatable records — never as "scope records have no lifecycle".** That wording is false
   (`SessionStore.set`, `stores/types.ts`), and this directive is the one place in the epic where a
   sentence gets *copied into shipped API documentation*: a guard comment on an exported symbol
   reads as a published concurrency invariant, and a wrong one there is worse than no guard at
   all, because the next reader trusts it. Two clauses are safe to carry: resource state
   tombstones so a delete stays visible to the version check, and scope state hard-deletes so
   its versions are not identity — the store's own contract says both.

2. **Delta verbs generalize to resources through a held `expectedVersion`, never through the
   commutative downgrade.** `DeltaStoreOps` (`stores/types.ts`) already takes
   `expectedVersion: ExpectedVersion` — `number | "any" | "absent"` — on every verb, so the
   verbs are not inherently versionless. Scope state opts out of the version check at exactly
   one line, `scope-persist.ts:60` (`commutative ? "any" : expectedVersion`). Resources pass
   **their held version** instead, and the reason is the **resource lifecycle, not the shape of
   the blob**.

   **Bag shape does not distinguish the two primitives, and this document used to say it did.**
   Resource state is a JSON object with field-level mutations too — `updateObjectState`
   (`context/resource-registry.ts`) spreads the current state and merges the update, exactly
   like a scope-state patch. What distinguishes them is **deletion**: `checkWriteVersion`
   returns "admit the write" for `"any"` **before it ever tests liveness**
   (`resource-state-predicate.ts:143`), so an `"any"` write lands on a tombstone — while the
   whole resource-state bet is that a delete stays visible to the version check (*"a tombstone
   keeps its version, so an observer from before a delete can never match the row that replaces
   it"*, `docs/architecture/state-and-scopes.md`). Scope state has no tombstone to defeat: its
   delete is hard (theme 1).

   **FIX-1267 must carry the lifecycle reason, not the shape one.** The shape argument collapses
   the moment Tier 2 gives resources field-scoped writes — a native `incField` leaves siblings
   alone, which is all "bag of independent keys" ever asked for. The tombstone argument does not
   collapse, because `"any"` skips the liveness test however small the write is. A child that
   inherits the shape reasoning will conclude `"any"` became safe once Tier 2 landed, and revive
   deleted resources.

   **Unproven, and it stays unproven — including after D-6 = A.** That *every row of the
   resource policy table survives* under a held version is a **type-level read no code has
   exercised**. The obligation rides **Decision 2's deferred native deltas** — the epic-theme
   rewrite next to FIX-992 (**FIX-1267**), which owns discharging it against the running resource
   path rather than against the types. **How and when it does that is FIX-1267's spec's call**, not
   this document's ([`epic-spec-template.md`](../../docs/contributing/epic-spec-template.md) →
   *Out of scope*: a single issue's approach and test plan). What is epic-level is the consequence:
   **if the claim fails, this theme changes rather than one issue's design**, so FIX-1267 comments
   up on this PR rather than re-scoping locally.

   **The shipping handle verbs do not discharge that obligation and do not inherit it.** This is
   the distinction the whole theme turns on: **Tier 1 does not touch the store interface**, so it
   never hands a held `expectedVersion` to a **store delta verb** — the thing this theme's claim
   is actually about, and true however FIX-1269 chooses to build it. FIX-1269 therefore
   proves nothing here and owes nothing here, and it is the *store interface*, untouched this
   cycle, that still rests on an unexercised read. Loading the obligation onto FIX-1269 would
   cost a child real work against a path it never takes.

   **Constrains:** no issue in this set may reach for `"any"` on a resource
   **delta or read-modify-write** path. That qualifier is load-bearing and was missing: `"any"` already
   travels the resource path on one intent by design — `runResourceCAS` passes it for
   `replace`, the deliberate unconditional overwrite behind `create({ replace: true })`
   (`resource-cas.ts:73`, `:220`) — so this is a constraint on new mutation work, not a claim
   that `"any"` is absent. `"absent"` throws on the delta verbs by contract, so create-if-absent
   stays a separate op — which is how resources already model it. **Extend the seams that
   exist; do not invent a new core `MutationContract` type until a second consumer appears.**

   **One tier ships and one stays deferred — keeping them apart is what stops this epic
   overclaiming (D-6).**

   - ***Tier 1 — the handle surface. Ships this cycle (FIX-1269).*** Caller-visible
     **increment and append** on the public resource handle types, adding **no store-interface
     surface**. **It wins no contention** — concurrent writers still resolve by CAS retry exactly as
     `updateState` does today. What it buys is API symmetry, so a developer stops picking a
     primitive by its verb list.

     **The surface promise covers `ResourceContext`, not only `ResourceRef` — "the handle surface"
     is two types.** `ResourceContext<TState>` (`core/src/types/resource.ts`) is a **separate public
     type** declaring its own `state` / `patchState` / `setState` / `updateState`, and on
     `origin/main` it carries **no** `incState` or `pushState`. It is public rather than incidental
     by two named exports: `DefinedResource.ContextType` resolves to it, and so does
     `ContextOf<T, "resource">`. It is also the type our own documentation *sends people to* —
     `docs/architecture/resources-and-client-data.md` says *"`defineResource` exposes `StateType` and
     `ContextType` helpers for typing shared helper functions"* and works the example with an
     `addStep(ctx: PlanContext, …)` whose body calls `ctx.updateState(...)`. So a developer following
     our documented pattern for shared resource helpers reaches the one type the new verbs would have
     skipped — **the gap this epic exists to close, reopened one type over.** An epic whose objective
     is symmetry cannot ship an asymmetric surface, which is why the requirement is fixed here rather
     than left to a child to notice.

     **Do not describe it as adding a store-native delta verb or as reducing contention — and
     do not describe it as non-atomic.** The verbs ride the same read-modify-write *inside* the
     CAS loop that `updateState` already takes: on a conflict `runResourceCAS` refreshes the
     container to the winner's row and **re-runs the mutator against it**
     (`stores/resource-cas.ts`; `persistResourceState` in `context/resource-registry.ts` hands
     the caller's updater in as that mutator). So a successful call is a single CAS-guarded
     mutation rather than a client-side read-modify-write — the definition
     `docs/architecture/state-and-scopes.md` already uses for the bag's `incState` / `pushState`
     under *Atomicity Guarantees*. **This is the one claim FIX-1269's documentation must not get
     backwards.** Decision 3 makes that documentation user-facing, and a caller told these verbs
     are not atomic will wrap them in an external read-then-write — the genuinely unsafe pattern
     they exist to remove. *(The version-`0` tombstone hole is a **deletion-semantics** defect,
     not an atomicity one — theme 1, FIX-1258.)*

     **How it is built is FIX-1269's spec's call**
     — this document fixes the tier boundary, **which public types the promise covers**, the
     no-contention claim and the atomicity claim, not the mechanism, the persistence path, a size,
     or whether the two types share a base or declare the verbs separately.
   - ***Tier 2 — the store interface. Still deferred (FIX-1267).*** Store-native `incField` /
     `pushToArray` on `ResourceStateStore` across every adapter plus conformance — the tier
     carrying this theme's unproven claim, the liveness gating, and the constraint amendment
     above. **It wins no contention either** — this document promised that it would, and the
     retraction is below. **Deferred and explicitly not dropped** (Decision 2), returning through
     the epic-theme rewrite next to FIX-992.

   **Neither tier wins contention, and the reason is this theme's own constraint.**
   `DeltaStoreOps` states it outright — a delta verb's *"concurrency contract is identical to
   `set`: the write applies only when the current stored version equals `expectedVersion`"*
   (`stores/types.ts:446-449`). So under a held version a native verb admits exactly one writer
   and the loser conflicts and retries, which is the full-record `set` it replaces. Run rather
   than read: `patchField`, `incField` and `pushToArray` each carry a passing *conflict on a stale
   `expectedVersion`* row (`packages/engine/test/store-delta-verbs.test.ts` — `patchField`'s is
   worded *"returns conflict with current value…"*, the other two *"returns conflict on…"*). What Tier 2
   buys is the same docstring's opening line — *"to avoid full-record UPDATEs on single-field
   scope-state writes"* — **write amplification, not concurrency.**

   **The bag's contention win is the `"any"` downgrade, and this epic credited it to the verbs.**
   `scope-persist.ts:60` hands `effectiveVersion` — `"any"` on every commutative hint —
   to all four verbs, while the `set` fallback keeps the caller's version. The routing suite's
   own describe block is named *"commutative ops bypass CAS"*, and its control row is
   *"updater-form patchState uses numeric expectedVersion (RMW, CAS path)"* — the one bag shape
   that keeps the gate, and keeps the conflicts with it
   (`packages/engine/test/scope-persist-routing.test.ts`). Verb and downgrade are a **pair**:
   `"any"` is non-lossy only because a field-scoped write leaves siblings alone (*"incField on
   one field does not disturb others"*), where a full `set` at `"any"` would clobber them. This
   theme forbids the downgrade half for resources, so the pair cannot travel — and neither can
   the win.

   **This does not un-defer Tier 2 and does not reopen Decision 2.** FIX-1267 stays deferred.
   What moved is its *justification* — from a concurrency fix to a write-amplification one — and
   that is a finding for **FIX-1267 to carry**, not a scope change here. It also sharpens the
   Tier 1 / Tier 2 split rather than blurring it: the two tiers now differ in *what* they buy,
   not in *how much* of one thing.

   If a store-native delta verb ever lands it must **not** reuse `createScopePersist` or
   commutative hints: that is precisely how `"any"` re-enters the resource path.

   **The adapter half of the mutation-surface asymmetry stands when the epic wraps; the caller-visible half closes.**
   **Which verbs Tier 2 carries is FIX-1267's to scope, and this document's old exclusion is withdrawn**
   — it had `patchField` and `deleteField` scoped out,
   and both reasons die with the contention claim above.

   *`patchField`:* the reason was that resources already have depth-1 `patchState`, so it would
   only earn its place for nested paths. That answers a **capability** question, and the tier's
   justification is now **write size**. `patchState` materializes the *whole* state object —
   `updateObjectState` spreads the current state and merges the update
   (`context/resource-registry.ts`) — and persists it through a
   full-record `ResourceStateStore.set` (`mutateResourceKey`, `createExecutionContext.ts`). So a native
   depth-1 `patchField` buys exactly the smaller write that justifies native `incField` /
   `pushToArray`. *`deleteField`:* the reason was that "removing a record is a lifecycle op
   rather than a state mutation" — but `deleteField` does not remove a record. It removes a
   value **inside the record's `state` slice** (`stores/types.ts`, `deleteField`), which is a
   state mutation by the contract's own words. The argument described a different verb than the
   one it excluded.
   **FIX-1267 picks the verb set on the write-amplification test; the epic holds only this
   theme's `"any"` constraint above.**

3. **`docs/architecture/state-and-scopes.md` is a shared surface, and each child names the
   paragraph it owns.** FIX-1154 rewrites what the doc says about the two primitives' mutation
   surface — the mutator sets, the return contract, and which writers carry a version — while
   leaving the policy-table pointer sentence alone (theme 1). FIX-1158 makes true what its
   cross-flow conflict table already promises. FIX-1155 **already landed** its edit (#1388).

   **FIX-1269 and FIX-1154 now share one paragraph, and that is this theme's live seam.**
   Decision 3 makes the docs follow the verbs, so FIX-1269 owns the **reference** half — the two
   new methods on the resource handle types, their signatures and their return contract — and FIX-1154 owns
   the **comparison** half, the paragraph explaining how the two mutation surfaces line up.
   **Both halves inherit theme 2's atomicity ruling**, and the comparison half is where it is
   easiest to get wrong: the two surfaces differ in verb list and in return type, **not** in
   whether a write is atomic. A comparison row reading "scope state atomic / resources not"
   would be false in the doc's own vocabulary — resource writes are CAS-guarded
   read-modify-writes too.
   FIX-1154's map must describe increment and append as **closing** — shipping as FIX-1269 —
   not as a deliberate gap; the spec's old "resources deliberately lack these verbs" framing is
   withdrawn by D-6 and does not survive into the doc. **"Closing", not "shipped":** the spec's
   map rows already read that way, and until FIX-1269 lands, a page that says *shipped*
   publishes a surface that does not exist.

   **Constrains:** no issue silently rewrites a neighbour's paragraph, and if two land close
   together the second rebases the doc edit rather than resolving a conflict by preference.
   **FIX-1269 precedes FIX-1154's documentation.** D-6's Decision 3 says the docs *follow* the
   verbs, and this document's earlier "merged in any order" claim contradicted a stamped owner
   decision — that claim is withdrawn, not qualified. What waits is **publication**, not the
   writing: FIX-1154's map can be specced, reviewed and written whenever, and if the order breaks
   anyway its §8 rule is the fallback — state the absence at writing time rather than publish a
   surface that does not exist.

   **The fallback's restore has an owner: whichever child lands second.** Stating the absence
   writes a paragraph that FIX-1269's merge then falsifies, and nothing else here assigned the
   correction — so the epic could wrap with the architecture doc still describing the gap this
   cycle closes. **FIX-1154 owns it by default**, since it owns the comparison half. **If FIX-1154
   publishes first, FIX-1269 owns it** — a one-paragraph correction of a statement its own merge
   made false, not a transfer of FIX-1154's documentation scope. It re-cuts nothing: the FIX-1269 /
   FIX-1154 boundary, FIX-1154's §11 target set and the corpus checker are unchanged, FIX-1154 is
   not split, and Decision 3 is not reopened.

   **The prerequisite binds the conceptual half only, and FIX-1269 still documents what it ships.**
   JSDoc on the new exports, or a one-line README method entry, travels with FIX-1269's PR as
   ordinary implementer hygiene — it is **not** the architecture/guide corpus, not §11, and not a
   reason to thin FIX-1154's target set. *(The contingent restore above is the one exception, and
   only in the branch where FIX-1154 published the absence first.)* The carve-out is stated because without it an implementer
   reading "FIX-1269 precedes FIX-1154's documentation" can conclude they are forbidden from
   documenting their own exports, which the prerequisite was never about. That FIX-1269's methods
   merge before the comparison paragraph publishes is the **accepted cost of Decision 3**, not a
   defect in it: both children sit under FIX-1157 and gate wrap together, so the window closes
   inside the epic.

   **This ordering is prose and stays prose. Do not encode it as a Linear blocker, and do not
   split FIX-1154 to make an encoding possible.** The lifecycle carries **one phase and one
   `blockedBy` per issue row**, and a `blockedBy` parks the *whole* row — `pendingAction` returns
   `null` on it and `allocate` diverts the row into its `blocked` bucket before any dispatch
   ([`epic-wake.js`](../../.agents/workflows/epic-wake.js), by symbol for the reason §4 gives)
   — so a blocker would park FIX-1154's map
   half too, which is the opposite of what Decision 3 asked for. The encoding for "half an issue
   waits" does not exist, and that is fine: a child issue is not reshaped to fit a status table.
   The next reader who notices the gap should read this paragraph, not add the blocker.
   The `createScopePersist` seam is closed: FIX-1155 has merged, so nothing this cycle touches it.

### Rejected framings (do not re-derive)

These were tested and abandoned. They are recorded here because re-deriving them is the most
expensive thing this epic has already paid for.

- **Collapse to one primitive by deprecating session/user/org state.** Killed by two findings.
  *(a)* The two CAS drivers cannot be shared — only eliminated — for the reasons in theme 1.
  *(b)* Removing scope state does not collapse the machinery anyway: request scope uses the
  same stack and has a real consumer (`packages/tools/src/mcp/capability.ts:63` contributes
  `requestStateSchema`), so `state-container.ts`, `cas.ts`, `scope-persist.ts`,
  `scope-write-predicate.ts`, the conformance suite and every adapter's delta verbs survive
  regardless. What deprecation *would* delete is the client-facing half — scope `clientData`,
  `useClientData` subscriptions, the `mergeStateChangeIntoSnapshot` reducer — and two of six
  state generics: roughly a third of the prize, in exchange for three scopes with state and
  three without.

- **Split by scope range** — state at request and below, resources at session and above, on
  the theory that request scope is single-writer and needs no CAS. **Rejected on facts:**
  request scope is genuinely multi-writer. Suspend does not drain the work pool
  (`execution-and-errors.md:411`) while resume builds a fresh context on the same request id;
  BullMQ reclaim compounds it.

- **Split by persistence** — "scopes are in-process, resources are cross-process." **False in
  both directions:** session/user/org state persists to `SessionStore`/`UserStore`/`OrgStore`
  and survives process restarts, and request state persists too. The only genuinely
  in-process tier is sequencer/block state.

## 4. Running index

| Issue | What it delivers | Route | Spec PR | Impl PR | State |
|---|---|---|---|---|---|
| [FIX-1154](https://linear.app/fixpoint-labs/issue/FIX-1154) | *Scope state and resources split one mutation surface across two APIs* — **the map**: every *remaining* difference recorded in its spec as deliberate-with-a-reason or deferred, plus the API documentation that follows the verbs (D-6 Decision 3). Drops the "resources deliberately lack these verbs" framing | spec | [#1445](https://github.com/fixpoint-labs/flow-state-dev/pull/1445) | — | In Spec Review · nothing about this issue is blocked. Its docs **publish** after FIX-1269 lands — a prose ordering, deliberately not a Linear blocker (theme 3) |
| [FIX-1269](https://linear.app/fixpoint-labs/issue/FIX-1269) | **Tier 1 — the handle verbs.** `incState` / `pushState` on **both** public resource handle types, `ResourceRef` and `ResourceContext`. API symmetry only: **wins no contention** and adds no store-interface surface — but **CAS atomicity is preserved**, so its docs describe the verbs as atomic (theme 2). *(Approach is its spec's, not the epic's)* | spec | — | — | Todo · Medium *(added by [D-6](https://github.com/fixpoint-labs/flow-state-dev/issues/1446) = **A**)* |
| [FIX-1158](https://linear.app/fixpoint-labs/issue/FIX-1158) | Cross-flow resource schema validation actually runs, comparing shared declarations on `(scope, ref)` — the durable cell, not the accessor name | **bug** | — | [#1444](https://github.com/fixpoint-labs/flow-state-dev/pull/1444) *(merged)* | **Done** |
| [FIX-1258](https://linear.app/fixpoint-labs/issue/FIX-1258) | **A write issued after the delete does not revive the resource.** The condition is the **version the write begins with, not what the context observed** — a context that never saw the key and one whose held version the delete evicted both arrive at the create-if-absent seed of `0`, so a fix written for the never-observed case alone leaves the defect live. Same **held-then-lost** shape FIX-1259 fixes on the scope side (`related`). The ordinary first touch of a never-written resource is unchanged, **and so is explicit recreation after a delete** (FIX-992 behaviour, pinned in two suites; theme 1 constrains the fix) — the version-`0` hole in theme 1's tombstone row | **bug** | — | — | Todo · High *(parented child — dispatchable and **gates wrap**; note below)* |
| [FIX-1260](https://linear.app/fixpoint-labs/issue/FIX-1260) | A transforming or defaulting resource state schema stops drifting the stored value. **Scoped by operation, not by a count of call sites:** a **post-creation mutation** write stores the **candidate**, because the caller supplied a complete value and expects it back — `persistResourceState` and `persistNamespaceInstanceState`. A **creation** write keeps **`parsed.data`**, because the caller supplied a partial and schema defaults are what fill it — `create` / `create({ replace: true })`, whose own comment says so. **Reads keep `parsed.data`** too: that is how a row written before the schema gained a defaulted field acquires it on load. `upsert` is one of each, by branch. **The split is the right axis and is not sufficient on its own** — the constraint that goes with it, the measured evidence ([comment `5430501537`](https://github.com/fixpoint-labs/flow-state-dev/pull/1365#issuecomment-5430501537)) and the choice of mechanism are [FIX-1260](https://linear.app/fixpoint-labs/issue/FIX-1260)'s, on its issue and its PR | **bug** | — | — | Todo · High *(parented child — dispatchable and **gates wrap**; note below)* |
| [FIX-1155](https://linear.app/fixpoint-labs/issue/FIX-1155) | Request-scope state serializes **same-context** writers in the in-memory queue while **retaining store-level CAS** for cross-context ones; wide fan-out stops throwing `ConcurrentModificationError` | spec | — | [#1388](https://github.com/fixpoint-labs/flow-state-dev/pull/1388) *(merged `864fdfa2`, 2026-08-22)* | **Done** |
| [FIX-1153](https://linear.app/fixpoint-labs/issue/FIX-1153) | ~~Deprecate scope state at session/user/org; delete org state~~ | — | — | [#1291](https://github.com/fixpoint-labs/flow-state-dev/pull/1291) *(closed unmerged)* | **Canceled** |

*A bug carries no spec PR by design — it routes straight to implementation
([`orchestration.md`](../../docs/contributing/orchestration.md) → "Which issues get a spec").
An empty Spec PR cell on a `bug` row is correct, not a gap.*

*FIX-1153 is kept in the index rather than dropped. Its cancellation and the closed PR are the
epic's most expensive finding — see* Rejected framings *in §2 — and a reader who cannot see it
here has no way to know the framing was tried.*

**This index exempts nothing, and it is not the wrap predicate.** Wrap, routing and dispatch are
decided by [`.agents/workflows/epic-wake.js`](../../.agents/workflows/epic-wake.js), run against the
**Linear parent→children query**. That script is the authoritative carrier and this section no
longer restates it: a copied predicate has been carried here three times and corrected three times,
and a second carrier of executable semantics goes stale the moment the workflow changes. Two
consequences a reader here does need. A non-terminal child **left out of this table is discovered
from that scan and entered as a row**, so omission exempts nothing. And a parented child is
**dispatched, routed and gated on the same terms as any other** — so **FIX-1258 and FIX-1260 are
eligible for dispatch on the next approved wake, and this epic cannot wrap until they are fixed or
cancelled.** FIX-1259 and FIX-1207 are not children, so they are neither dispatched nor counted; the
boundary rule (§5) decides *membership*, never what happens to a child once it is one. Anything
finer — which conditions release a row, what parks one — is read from the workflow, not from here.

*Why FIX-1259 and FIX-1207 have no row here while FIX-1258 and FIX-1260 do — the boundary rule and
the disposition each of the four surfaced bugs got — is recorded once, in §5. **The rows above state
what each issue delivers and stop there:** how a defect works, and which mechanism closes it, belong
to that issue and its PR. §4 is a projection of the coordinator's status table and
[**a table, not prose**](../../docs/contributing/epic-spec-template.md) — nothing refreshes a
diagnosis parked inside it.*

## 5. Open cross-cutting questions

**No live fork remains.** The entries below are kept in full rather than only on the epic PR —
the PR closes when the epic wraps; this document outlives it.

- **~~Does FIX-1260 belong to this epic?~~** *Settled — **yes, it stays a child of FIX-1157**, and
  so does FIX-1258. The wrap-unparent write was skipped, it is not being re-asked, and no decision
  is being filed against it, so the Linear graph is the answer.* **Not an owner question, and it
  must not be sent back up as one:** parentage is *organization*, which sits below the decision bar
  — the owner sets objectives, not the shape of the issue graph. An earlier pass in this round put
  it to the owner as a live fork; that was wrong.

  **The argument that lost is worth keeping, because it is this epic's boundary rule:** *epic
  membership is not a severity queue.* FIX-1260 ships independently, no theme depends on it, and
  this epic *surfaced* the defect rather than coordinating the fix — coordination is the only thing
  membership buys. That reasoning is why FIX-1259 and FIX-1207 are unparented and unindexed, and it
  is still the reason neither comes back. It simply did not carry for the other two.

  **What membership costs is the whole lifecycle, not just the wrap gate.** A parented,
  non-terminal child is dispatched like any other and holds the epic open until its fix merges or it
  goes terminal (§4's wrap note), so the consequence gets stated rather than softened: FIX-1258 and FIX-1260 get
  worked, and this epic does not wrap until they are fixed or cancelled. That is what the graph
  means, not a defect to escalate. It also settles the second surface — a child belongs in §4's
  index, so FIX-1260 now has a row and the earlier "do not index it" ruling is withdrawn.

- **~~Does this epic finish with the task-board fan-out crash still live?~~** *Resolved by
  events, not by a decision: **FIX-1155 shipped** — PR
  [#1388](https://github.com/fixpoint-labs/flow-state-dev/pull/1388) merged to `main` as
  `864fdfa2` on 2026-08-22, before the fork was ever put to the owner.* The epic will not wrap
  with the crash live, and it did not have to take a third workstream to get there — the issue
  landed on its own merits without the epic taking it on as a workstream, which is exactly what
  the recommendation asked for. The reasoning is worth keeping because it is the epic's boundary rule: FIX-1155 is
  an asymmetry *inside* scope state, completing FIX-492 for the scope it deferred, and it would
  read identically if resources did not exist. Carrying it would have made the epic's boundary
  "concurrency things we noticed", which is how a set stops being a set. *(The exposure note
  that went with it also stands: no shipped pattern reached the crash on its defaults —
  `planAndExecute` defaults to `maxConcurrency: 1`, `supervisor` to `3`, `routedSpecialists` is
  sequencer-backed, and `goalSeekLoop` takes a caller-supplied board. An earlier draft claimed
  four patterns hit it by default, and that was wrong.)*

- **~~Is this an epic, or one issue and a standalone bug?~~** *Resolved: it stays an epic, with
  FIX-1158 named an honest lodger rather than dressed up as a member.* Raised independently by
  two reviewers, and correct that the shared-doc argument for membership was process coupling —
  which is why it is withdrawn (§1) rather than defended. **Decided as an engineering call, not
  put to the owner:** both outcomes are cheap and reversible, which is precisely the shape a
  reader of `asking-for-decisions.md` should not be spending attention on. Kept because the
  cross-cutting calls — the CAS divergence, never `"any"` on a resource **delta or
  read-modify-write** path, the
  return-contract asymmetry, and three separate corrections to theme 1's justification — are
  exactly what gets re-derived expensively, and this epic has already paid once for re-deriving
  one (#1291, closed unmerged). An epic's real cost here is a coordination doc somebody
  maintains; its return is that those calls have one home a future third consumer can find.
- **~~Does this cycle add public resource verbs, or document the gap?~~** *Resolved by the owner
  in [D-6](https://github.com/fixpoint-labs/flow-state-dev/issues/1446): **ship the verbs.***
  **Ask 1 = A, amended 2026-08-26** — it was **B** (*document the gap*) from 2026-08-25, and
  Jake flipped it in Decision Manager chat. `incState` / `pushState` **ship this
  cycle** as FIX-1269: the bag already carries these verbs, two live callers already cross the
  primitives, and the foundation-honesty rule cuts the *other* way once a gap is the thing being
  documented — an API you have to explain the absence of is worse than the two methods that
  remove the explanation. **Decision 2 — defer, not drop (unchanged):** store-native deltas stay
  later, next to FIX-992, tracked as FIX-1267; the handle verbs are **not** that work.
  **Decision 3 — docs follow the verbs:** API documentation, not a withheld-gap story, and
  FIX-1154's spec drops "resources deliberately lack these verbs". Recorded here so no sibling
  reopens it: the epic's **objective is unchanged**; what moved is which half of the rule this
  cycle delivers at the handle surface.
- **~~Do resources grow a committed `boolean`, or is the `Promise<boolean>` vs
  `Promise<void>` split deliberate?~~** *Resolved: deliberate — and D-6 = **A** makes it
  binding rather than academic, because FIX-1269 now has to pick a return type.*
  Scope state returns `boolean` because callers branch on it to suppress a redundant
  `state_change`; resources verify the no-op internally and gate `resource_change` on that,
  so the value has no caller to serve. Forcing them to match would be symmetry for its own
  sake — the opposite of this epic's thesis, which is symmetry *where it is safe* and the
  asymmetry stated once where it is not. This is that statement. Raised by review on this PR,
  decided here at epic altitude so no child picks either way on its own.

  **Constrains FIX-1269:** the shipping `incState` / `pushState` return **`Promise<void>`** on
  **both** handle types, matching the `patchState` / `setState` / `updateState` that `ResourceRef`
  and `ResourceContext` each already declare (`core/src/types/resource.ts`) — **not** the
  `Promise<boolean>` that `ScopeStateOps` returns (`core/src/types/state.ts`). The verbs are being
  added for API symmetry, which makes copying the bag's signature the tempting move and the wrong
  one: it would fork the resource side's own return contract to close a gap with the other
  primitive.

---

## Epic evolution

One line per turn, per
[`epic-spec-template.md`](../../docs/contributing/epic-spec-template.md) → *Epic evolution*. The log had
grown to 339 lines of theme and index mechanics restated in prose — a second technical carrier needing
reconciliation, the same failure as the §4 diagnosis and the child-only constraints. **Entries one
through three went with that trim**, so the numbered tally below starts visible at **Four**, not at one.
**Corrections are counted, not narrated:** the count is this epic's own measured signal, and where a
retraction taught something the themes do not already say, it earns a clause.

- **Epic re-founded (2026-08-20)** — objective became *symmetry where safe, asymmetry stated once
  where not*; FIX-1153 cancelled and #1291 closed unmerged, because the collapse-to-one-primitive
  thesis was tested and failed.
- **Theme reversed (2026-08-22)** — the CAS policy table stays in `resource-cas.ts` and FIX-1154
  guards the trap export instead, because the doc already banks the discoverability gain.
- **Epic review, rounds 1–2 (2026-08-22)** — §2 cut from seven themes to three, FIX-1158 renamed an
  honest lodger, theme 2's policy-row claim marked unproven, the Tier 1 / Tier 2 guard and the return
  contract settled, and the doc declared converged, because it had outgrown the work it coordinates.
- **Parity claim withdrawn to FIX-1154 (2026-08-22)** — the epic stopped asserting a mutator
  inventory at all, because it had narrowed the claim twice and been falsified both times.
- **FIX-1258 filed; the tombstone row qualified (2026-08-25)** — the row is marked incomplete for
  version `0`, because FIX-1154's spec review reproduced a never-observed write reviving a deleted
  resource on the real path.
- **FIX-1258 classified; §5's forks given all six parts (2026-08-25)** — because epic membership is
  not a severity queue and a fork stated only on the PR dies when the PR closes.
- **Theme 1's root corrected; the convergence rule narrowed (2026-08-25)** — the root is tombstoned
  generations vs hard-deleted, recreatable records, and convergence bounds folding rather than the
  durable record, because both clauses of the old reason were false.
- **`lineageId` withdrawn; three neighbours corrected (2026-08-25)** — it is a storage address for
  `sharedToWorkstream` resources, not a discriminator the scope write path consults; the adapter row
  and the FIX-1155 pattern list went with it, because each rested on code this set is **not
  changing**.
- **Width sweep (2026-08-25)** — every rule re-checked against its actual width: **one wrong** (scope
  `0` admits absence), seven held, because the recurring defect is a rule stated at the wrong width.
- **Theme 1's failure mode corrected (2026-08-25)** — a shared driver does not resurrect a tombstone
  on a positive version; it retries into `ConcurrentModificationError`, because `checkWriteVersion`
  requires a *live* row and a version match alone is not enough. *(The **third** supporting claim of
  theme 1 to be wrong while its conclusion held.)*
- **Epic-classification fork decided (2026-08-25)** — it stays an epic with FIX-1158 an honest
  lodger, taken as an engineering call, because both outcomes are cheap and reversible.
- **§3 removed (2026-08-25)** — *Shape of the whole* omitted per the template (no end-state POC), its
  two live pieces moved into themes 1 and 2, because a second carrier for decisions the themes own is
  a drift generator — that section's `0` row had been corrected twice.
- **FIX-1155's mechanism corrected (2026-08-25)** — the in-memory queue serializes **same-context**
  writers and store CAS covers cross-context ones, because `withScopeLock` keys its FIFO on the
  `StateContainer` and cannot reach past it. *(**Four** — and the pattern worth carrying: every claim this
  epic has retracted was a **mechanism** description, and the **decision** wrapped around it survived
  intact. Trust this document's decisions; re-derive its descriptions of the code from the code.)*
- **D-6 folded as B — no verbs this cycle (2026-08-25)** — `ResourceRef.incState` / `pushState` cut,
  Tier 2 deferred not dropped, theme 2's proof obligation moved off FIX-1154, because an obligation
  on a deliverable that is not shipping proves nothing. **Five surfaces carried the superseded
  answer** and were reconciled in one pass.
- **Theme 2's `"any"` constraint tightened (2026-08-25)** — it binds the **delta / read-modify-write**
  path, not "the resource path", because `runResourceCAS` already passes `"any"` for `replace` by
  design. *(**Five**.)*
- **D-6 reversed to A — the handle verbs ship (2026-08-26)** — `ResourceRef.incState` / `pushState`
  ship as **FIX-1269** and Decision 3 becomes API docs that follow the verbs; Decision 2 untouched,
  store-native deltas stay deferred as **FIX-1267** and keep theme 2's proof obligation, because a
  read-modify-write over `runResourceCAS` never hands a held `expectedVersion` to a store delta verb.
  **The Tier 1 / Tier 2 split is now the load-bearing distinction in this document.** Eight surfaces
  reconciled in one pass.
- **FIX-1155 recorded as shipped; its fork closed by events (2026-08-26)** — #1388 merged as
  `864fdfa2` four days before this document noticed, because **a fork whose subject shipped is not a
  decision**, and leaving it live spends the owner's attention on a question reality answered.
- **FIX-1259 reopened; theme 1's version-`0` reasoning retracted (2026-08-26)** — first touch is
  spelled `"absent"`, not `0`; the writer that revives a hard-deleted record is a **held-then-lost**
  writer *handed* `0` by the retry path, so refusing it costs first touch nothing. *(**Six**.)*
- **Tier 2's contention win retracted; the deferral untouched (2026-08-26)** — `DeltaStoreOps`'s
  contract is *"identical to `set`"*, so native verbs buy **write amplification**, not concurrency;
  the bag's real win is the commutative `"any"` downgrade this theme forbids generalizing. FIX-1267
  stays deferred with a rescoped justification. *(**Seven** — the mechanism claim was wrong, the decision (defer, don't drop) survived.)*
- **Sequencing declared; the any-order claim withdrawn (2026-08-26)** — **FIX-1269 precedes
  FIX-1154's documentation**, because D-6's Decision 3 says the docs *follow* the verbs and
  "merged in any order" contradicted a stamped owner decision.
- **FIX-1259 unparented and dropped from §4 (2026-08-26)** — the index is a projection of the Linear
  graph, not a second opinion about it.
- **"Wrap does not wait for it" retracted (2026-08-26)** — a parented, non-terminal child holds the
  epic open, because `mayWrap` builds its rows from the Linear parent→children query. *(**Eight** — the
  first about **our own tooling** rather than product code, which is why reading FSD never caught
  it.)*
- **FIX-1269's implementation specifics dropped to its spec (2026-08-26)** — the epic had fixed a
  mechanism, a persistence path and a line count for a child whose spec gate is still empty, which
  pre-empts the review surface meant to validate it. Only the *how* left; the cross-issue constraints
  stayed.
- **The Tier 2 verb-set exclusion withdrawn (2026-08-26)** — `patchField` and `deleteField` come back
  into FIX-1267's scope, because both exclusions died with the contention claim: `patchState`
  materializes the whole object, and `deleteField` removes a value inside `state`, not a record.
- **"Nothing becomes atomic" retracted — Tier 1 preserves CAS atomicity (2026-08-26)** —
  `runResourceCAS` re-runs the mutator against the winner's row, so a successful call is the single
  CAS-guarded mutation `state-and-scopes.md` already calls atomic. *(**Nine** — the first where the wrong
  claim was **actively harmful if believed**: Decision 3 would have published it, and a caller told
  these verbs are not atomic hand-rolls the unsafe read-then-write they exist to remove.)*
- **Theme 2's bag-shape rationale replaced by the lifecycle one (2026-08-26)** — "a bag of
  independent keys" does not distinguish the primitives (resource state merges fields too); deletion
  does, because `checkWriteVersion` admits `"any"` **before** testing liveness. Conclusion unchanged.
  *(The FIX-1259 shape: a right conclusion on a false reason — and this one would have **expired** the
  moment Tier 2 landed, handing FIX-1267 a licence to revive deleted resources.)*
- **The child-only constraints subsection removed (2026-08-26)** — two constraints binding one shipped
  child each, which the template routes to the child's own spec; **they had already drifted**, which is
  the argument. The record lives on #1388 and #1444.
- **The parentage question settled without the owner; FIX-1260 re-indexed (2026-08-26)** — the
  unparent write for FIX-1258 and FIX-1260 was skipped and is not being re-asked, so both stay
  children and both belong in §4. **Parentage is organization and sits below the owner-decision
  bar** — in one day this was written three ways (index it as inactive, escalate it, settle it) and
  only the third is right. *(**Ten** — the second wrong claim about a **mutable external graph** this
  document only mirrors; the fix both times was to execute the query.)*
- **FIX-1260's row inverted (2026-08-26)** — the row described the **defect** in the slot that tells
  an implementer what to build, so row and diagnosis said the same thing twice inside one section
  and contradicted each other **inside a single commit**.
- **FIX-1260's row split by direction (2026-08-26)** — *validate the candidate, store the candidate*
  is right for the write path and wrong for the reads: read normalization is how a historical row
  acquires a newly-defaulted field. *(**Eleven** — the decision survived, the **width** of the mechanism did
  not.)*
- **The active-set ledger dropped; dispatch accepted (2026-08-26)** — `epic-wake` cannot represent
  "parented but held back", so the next approved wake starts FIX-1258 and FIX-1260 whatever the prose
  says. The dual ledger was dropped rather than the two issues folded in, because folding them would
  make the boundary "concurrency bugs we found". *(**Twelve** — the third about our own tooling.)*
- **FIX-1154 kept whole; the docs ordering stated as unencodable (2026-08-26)** — a row carries one
  phase and one `blockedBy`, so a blocker would park the map half too. **An issue is not reshaped to
  fit a status table**; what waits is publication, not the writing.
- **Two carriers dropped to their owners (2026-08-26)** — theme 2 stopped prescribing FIX-1267's test
  plan and §4 stopped carrying a tally beside the table that projects it, because a reading in prose
  next to a status projection has no refresh trigger. Third removal of the two-carriers shape.
- **FIX-1260 has two write sites; the row said one (2026-08-26)** — `persistNamespaceInstanceState`
  carries its own inline `safeParse` on the collection-instance path. **The enumeration was of one
  function's call sites, not of the behaviour** — a right answer to a narrower question than the row
  claimed, committed *while correcting another instance of it*. *(**Thirteen**.)*
- **FIX-1260 covers the collection write site too (2026-08-26)** — decided here, because *which issue
  owns which write site* is a call no single child can make and the symptom is one symptom. FIX-1256
  owns the parse-**failure** branch of the same expression; opposite branches of one `if`, a
  merge-order note rather than a reason to merge the issues.
- **The wrap predicate restated: merging releases a row too (2026-08-26)** — §4 had required **every
  row Linear-terminal**, which told a coordinator to hold an epic open on a fix that had already
  landed. *(**Fourteen** — and the sharp part: the entry above it **introduced this while correcting the claim
  above that**, because the checking effort goes into the claim being retracted, not the sentence
  replacing it.)*
- **The commit anchor dropped; citations re-based on `origin/main` (2026-08-26)** — §1 had pinned
  citations to `6aa1bea`, this branch's **merge-base**, so every verification ran against a checkout
  `main` had left **267 commits** behind — 12 of 24 cited files had moved, one claim's substance had
  changed. §1 now states the rule: **cite by symbol; verify against `origin/main`**. *(The widest
  instance of the shape the retractions share — a claim stated at the width of the specimen
  examined, here the checkout itself.)*
- **The two-copy framing retracted (2026-08-26)** — `d20735e3` extracted a single shared
  `normalizeResourceState` (`resources/normalize-resource-state.ts`); at the anchor there were two
  definitions, one of them file-private to `resource-registry.ts`. On `main` there is **one function
  serving one mutation write and four reads**, so FIX-1260's problem is a **conflated contract**, not
  duplication, and its fix is a second function or an explicit parameter rather than a
  de-duplication. Duplication was never the finding. *(**Fifteen** — the one claim the 267-commit gap actually falsified.)*
- **FIX-1260 rescoped by operation, not by call site (2026-08-26)** — a **third** write path exists:
  `create` persists `safeParse(initial).data`, and storing the candidate there would break documented
  behaviour where **schema defaults fill partial creation input**, so "every resource write" was wrong
  in the other direction too; §4's row now states the axis and `upsert` is one of each by branch.
  *(**Sixteen** — the fourth re-scope of this claim, each earlier one narrowing by **enumerating
  harder**. A rule about operation semantics cannot be outrun by a call site nobody listed.)*
- **`phase === 'DONE'` restored as a third release (2026-08-26)** — *the wrap predicate restated*,
  above, collapsed `merged` and `DONE` into "one release on two fields". `mergeDerivedPhase` returns early for any row
  carrying `subPrs` (*"multiPrPhase owns these"*), and `multiPrPhase` sets `DONE` on all-sub-PRs-merged
  **plus** a passed assembled goal, never consulting `merged` — so for a multi-PR child `DONE` is
  genuinely independent, and collapsing it invites a later edit to delete a disjunct and strand
  completed rows. *(**Seventeen** — the fifth about our own tooling, the second **produced by a correction**, and
  the sharpest: the disqualifying sentence sat **one line below** the one that entry quoted.)*
- **FIX-1260's split confirmed necessary and *not sufficient* (2026-08-26)** — a POC on the real path
  measured **+1 transform per mutation surviving the rule** (from +2): the mutator is seeded from the
  **normalized read cache**, not the raw stored row. The **axis holds**; §4 carries the constraint and
  FIX-1260 picks the mechanism. *(**Eighteen** — the first settled by **running it**, and the first
  where only **sufficiency** was wrong; every earlier entry retracted a mechanism *description*.)*
- **§4's executable-lifecycle derivation removed (2026-08-26)** — wrap, discovery, routing and
  allocation are read from `epic-wake.js` rather than restated; *omission exempts nothing* and the two
  children holding wrap open stay. The log is the argument: this copy was corrected **three times**,
  so the retraction records stay while the derivation goes. *(Fourth two-carriers removal.)*
- **Theme 3's fallback given an owner (2026-08-26)** — whichever child lands **second** corrects the
  comparison paragraph, so **FIX-1269** owns the restore if FIX-1154 publishes the absence first.
  Unowned, the epic wraps with the architecture doc still describing the gap it closed. Boundary,
  §11 and Decision 3 untouched.
- **FIX-1258's condition widened to the held version (2026-08-26)** — the defect is a write that
  **begins at version `0`**, not one from a context that *never observed* the resource: `delete`
  evicts the live-cache entry, so a retained `ResourceRef` re-seeds from the absent row into the same
  create-if-absent branch. Stated narrowly, §4 buys a fix for half the defect. *(**Nineteen** — the
  identical **held-then-lost** correction landed for FIX-1259 on the scope side earlier the same day
  and was never carried across, while FIX-1154's own POC had been classifying that path as D5. **A
  correction is not finished when the path it was found on is fixed.**)*
- **FIX-1260's diagnosis dropped to its issue (2026-08-26)** — §4 keeps the row and the evidence
  link; the POC narrative, drift numbers, seed derivation and mechanisms go to the issue that owns
  them. Round 9 removed §4's `mayWrap` derivation and added this **in the same commit** — one carrier
  out, another in — pre-empting a review surface before its gate opened, two paragraphs below where
  §4 already forbids it. *(Fifth two-carriers removal.)*
- **FIX-1258's fix constrained: the predicate needs an intent split (2026-08-26)** — refusing `0`
  against a tombstone outright would also refuse **explicit recreation after a delete** — FIX-992
  behaviour, pinned in two suites and published. The intent is not missing, it is **discarded where
  `runResourceCAS` derives `expectedVersion`**, so a mutation seeded at absent and a `create`
  collapse to the same value before the predicate sees them. Theme 1 also records the asymmetry:
  scope's `"absent"` is the **shape** the resource side lacks, **not a value to copy**, and the two
  `ExpectedVersion` vocabularies stay separate. *(**Twenty** — the first correction to a fix this
  document **specified** rather than to a description of shipped code.)*
- **Tier 1's surface widened to `ResourceContext` (2026-08-26)** — `DefinedResource.ContextType` and
  `ContextOf<T, "resource">` resolve to it and the architecture doc sends shared helpers there, so verbs
  on `ResourceRef` alone reopen this epic's own gap one type over. *(**Twenty-one** — a **promise** stated
  at the wrong width; every earlier width error was a description.)*
- **`ScopeStateHandle` never existed (2026-08-26)** — the scope-side verbs live on **`ScopeStateOps`**
  (`core/src/types/state.ts`), mixed into each `*ScopeHandle`; the name was cited twice as if real.
  *(**Twenty-two** — cite-by-symbol cannot catch a symbol that was never a symbol.)*
