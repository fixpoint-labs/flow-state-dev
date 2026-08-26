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
`ScopeStateHandle`, `core/src/types/state.ts`), per-key versioning and collision detection
means resources — `ResourceRef` carries no delta verb at all
(`core/src/types/resource.ts`). The operating rule is **symmetry where it is
safe, and the asymmetry stated once where it is not**: one mutation contract wherever the two
primitives can share one without
importing each other's semantics, and where they cannot, the reason written down in a single
place a reader hits *before* reaching for the wrong import rather than after.

**This cycle closes the increment/append gap and maps the rest** — decided by the owner in
[D-6](https://github.com/fixpoint-labs/flow-state-dev/issues/1446), Ask 1 = **A** (amended
2026-08-26; it read **B**, *document the gap*, from 2026-08-25). `ResourceRef.incState` /
`pushState` **ship** (FIX-1269): the bag already carries these verbs, two live callers cross the
primitives, and a documented gap is a worse foundation than the two methods that close it.
Decision 3 follows — the write-up becomes **API documentation**, not a withheld-gap story. Every
*other* difference is still **mapped, not closed** (FIX-1154).

**What ships is API symmetry, not a contention win.** Tier 1 adds the two verbs to the handle and
touches no store interface: **no store-native delta verb and no contention improvement** —
concurrent increments still resolve by CAS retry exactly as `updateState` does today.
**CAS atomicity is preserved**, because the verbs ride the read-modify-write *inside* the CAS
loop, which re-runs the mutator against the winner's row on every conflict.
**Nor does the deferred store-native half win contention**
— under this epic's held-version constraint it buys smaller writes, not fewer
conflicts (theme 2, Decision 2).

*Code citations are against `origin/main` at `6aa1bea`.*

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
- **FIX-1269** (the handle verbs — `ResourceRef.incState` / `pushState`) is what D-6 = **A**
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
  merge.* The earlier membership argument — that all the children edit one
  markdown file — is **withdrawn**: paragraph ownership rebases cheaply, so it is process
  coupling, not product coupling. Shared-surface coordination stays a convention for the
  children (theme 3), not proof that they are a set.
- **FIX-1155** (request-scope CAS vs block-scope mutex) is an asymmetry *inside* scope state,
  completing FIX-492 for the one scope it deferred; it would read identically if resources
  did not exist. **Shipped** — PR [#1388](https://github.com/fixpoint-labs/flow-state-dev/pull/1388)
  merged (`864fdfa2`, 2026-08-22) without the epic ever taking it on as a workstream, which
  **answers §5's fork by events** rather than by a decision.
- **FIX-1207** (overlapping collection keyspaces slip past the cross-flow check) is FIX-1158's
  **spun-off remainder** — no theme, no decision at this altitude.
- **FIX-1258** (a deleted resource revived by a request that never saw it — the version-`0` hole in
  theme 1's tombstone row) and **FIX-1260** (both resource **write** paths store `safeParse`
  *output*, so a transforming schema drifts what lands), both from FIX-1154's
  spec review, are **parented children this epic surfaced, not work the objective needs**. The
  boundary rule — **epic membership is not a severity queue** — is why FIX-1259 and FIX-1207 are
  not children at all; it lost the argument for these two, so they are ordinary children with
  everything that follows (§4).

**What the objective needs is FIX-1154 and FIX-1269.** The FIX-1158 lodger and FIX-1155 have both
shipped. **The four surfaced bugs split two and two:** FIX-1259 and FIX-1207 are unparented and out
of the index; **FIX-1258 and FIX-1260 stay children.** The unparent write was skipped and is not
being re-asked (§5), so **the Linear graph is the only ledger** — a parented, non-terminal child is
dispatched like any other child and holds wrap open until it is fixed or cancelled (§4). This
document keeps no second "active set" beside that graph: nothing in the lifecycle reads one, so it
could only drift from the thing that does.

Whether this is an epic at all was asked twice and is **decided: it stays an epic** (§5, resolved)
— an engineering call, since both outcomes are cheap and reversible.

**Not doing:** merging the two primitives; deleting or deprecating either one at any scope;
re-attempting the org-state removal; cross-record atomicity (FIX-854); and resource-specific
surface with no state analogue at all — content, `client`, `reactTo`, `edges`, collections.
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
   it. `stores/types.ts:537-540` states exactly that and declines to defend it — *"this store's
   versions are not a substitute for identity"* — and `handleDeleteSession` is a live caller
   (`routes/session-routes.ts:231`). **Nothing on the scope write path supplies that identity
   either.** `checkScopeWriteVersion` (`stores/scope-write-predicate.ts`) compares the stored
   version against `expectedVersion` and reads nothing else — and its numeric branch reads an
   **absent record as version `0`**. Numeric `0` is what a container's first CAS state write
   passes (`state-container.ts:58` starts it at `0`); on the ordinary path the record already
   exists at v0, created through `"absent"` (`ensure-session-record.ts:48`) or `"any"`
   (`createExecutionContext.ts:595`, `:704`, `:1275`), so `0` matches a **live** row as intended.
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
   refused. It is false for version `0`: a context that loaded a key *before it existed* keeps
   container version `0`, `runResourceCAS` sends it as the `mutate` intent's `expectedVersion`
   (`resource-cas.ts:219-220`), and `checkWriteVersion` accepts `0` against a tombstone as
   create-if-absent (`resource-state-predicate.ts:147-149`) — so a write from a context that
   **never observed** the resource revives it after a delete. The product bet is unchanged —
   deleted stays deleted — it is simply not enforced on that one path.

   **This cycle adds two new entry points to the hole, and the hole is still open — say so
   rather than discovering it later.** `updateState` already does exactly this on `main` today
   with no new verb involved, so the hole exists whatever this epic ships. But D-6 = **A** ships
   `incState` and `pushState` onto the **same resource write path** `updateState` already takes,
   at held version `0` (theme 2), so the count of ways in goes from one to three. That is a known,
   accepted cost of Ask 1 = A and not a reason to reopen it: the verbs inherit the defect of the
   path they reuse rather than introducing one, and closing it once at the predicate fixes all
   three. **FIX-1269 must not grow its own version handling to route around this** — a local
   workaround in the new verbs would leave `updateState` broken and put the fix in the wrong
   layer. The limitation is still *pinned at the
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
   (`stores/types.ts:537-540`), and this directive is the one place in the epic where a
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
     **increment and append** on `ResourceRef`, adding **no store-interface surface**.
     **It wins no contention** — concurrent writers still resolve by CAS retry exactly as
     `updateState` does today. What it buys is API symmetry, so a developer stops picking a
     primitive by its verb list.

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
     — this document fixes the tier boundary, the no-contention claim and the atomicity claim,
     not the mechanism, the persistence path, or a size.
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
   than read: `patchField`, `incField` and `pushToArray` each carry a passing *"returns conflict
   on stale expectedVersion"* row (`packages/engine/test/store-delta-verbs.test.ts`). What Tier 2
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
   (`context/resource-registry.ts:121-139`, `:1560-1574`) — and persists it through a
   full-record `ResourceStateStore.set` (`createExecutionContext.ts:1746-1777`). So a native
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
   new methods on `ResourceRef`, their signatures and their return contract — and FIX-1154 owns
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

   **This ordering is prose and stays prose. Do not encode it as a Linear blocker, and do not
   split FIX-1154 to make an encoding possible.** The lifecycle carries **one phase and one
   `blockedBy` per issue row**, and a `blockedBy` parks the *whole* row
   (`.agents/workflows/epic-wake.js:216`, `:1256-1280`) — so a blocker would park FIX-1154's map
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
| [FIX-1269](https://linear.app/fixpoint-labs/issue/FIX-1269) | **Tier 1 — the handle verbs.** `ResourceRef.incState` / `pushState` on the resource handle. API symmetry only: **wins no contention** and adds no store-interface surface — but **CAS atomicity is preserved**, so its docs describe the verbs as atomic (theme 2). *(Approach is its spec's, not the epic's)* | spec | — | — | Todo · Medium *(added by [D-6](https://github.com/fixpoint-labs/flow-state-dev/issues/1446) = **A**)* |
| [FIX-1158](https://linear.app/fixpoint-labs/issue/FIX-1158) | Cross-flow resource schema validation actually runs, comparing shared declarations on `(scope, ref)` — the durable cell, not the accessor name | **bug** | — | [#1444](https://github.com/fixpoint-labs/flow-state-dev/pull/1444) *(merged)* | **Done** |
| [FIX-1258](https://linear.app/fixpoint-labs/issue/FIX-1258) | A write from a context that **never observed** a resource does not revive it after a delete, while the ordinary first touch of a never-written resource is unchanged — the version-`0` hole in theme 1's tombstone row | **bug** | — | — | Todo · High *(parented child — dispatchable and **gates wrap**; note below)* |
| [FIX-1260](https://linear.app/fixpoint-labs/issue/FIX-1260) | A transforming or defaulting resource state schema stops drifting the stored value — **every resource write** validates the mutation output and then persists the **candidate**, instead of what `safeParse` returned. **Both write sites are in scope**, both in `context/resource-registry.ts`: single resources through `normalizeResourceState` (`:688`) and collection instances through `persistNamespaceInstanceState` (`:694-705`). **The read paths are out of scope and keep `parsed.data`** — that is how a row written before the schema gained a defaulted field acquires it on load. *(`routes/route-utils.ts` has no write path at all, so the earlier "both copies, fix both" framing stays withdrawn — it named the wrong second copy, not a second one too many.)* | **bug** | — | — | Todo · High *(parented child — dispatchable and **gates wrap**; note below)* |
| [FIX-1155](https://linear.app/fixpoint-labs/issue/FIX-1155) | Request-scope state serializes **same-context** writers in the in-memory queue while **retaining store-level CAS** for cross-context ones; wide fan-out stops throwing `ConcurrentModificationError` | spec | — | [#1388](https://github.com/fixpoint-labs/flow-state-dev/pull/1388) *(merged `864fdfa2`, 2026-08-22)* | **Done** |
| [FIX-1153](https://linear.app/fixpoint-labs/issue/FIX-1153) | ~~Deprecate scope state at session/user/org; delete org state~~ | — | — | [#1291](https://github.com/fixpoint-labs/flow-state-dev/pull/1291) *(closed unmerged)* | **Canceled** |

*A bug carries no spec PR by design — it routes straight to implementation
([`orchestration.md`](../../docs/contributing/orchestration.md) → "Which issues get a spec").
An empty Spec PR cell on a `bug` row is correct, not a gap.*

*FIX-1153 is kept in the index rather than dropped. Its cancellation and the closed PR are the
epic's most expensive finding — see* Rejected framings *in §2 — and a reader who cannot see it
here has no way to know the framing was tried.*

**What actually gates wrap — the Linear graph, not this table.** The coordinator's wrap predicate
requires every issue in its row set to be `linearTerminal || merged || phase === 'DONE'` — **two
independent releases, not one condition worded three ways.** A row is released by **Linear going
terminal** (`done` / `closed` / `cancelled` / `duplicate` / `dropped` / `won't do`) **or by its PR
merging**, which is the ordinary case for a fix that lands before the board catches up.
(`merged` and `phase === 'DONE'` are one release carried on two fields, kept in step in both
directions by `mergeDerivedPhase`.) That row set is built from the
**Linear parent→children query** plus any explicitly carried members — not from this index. Leaving
a child out of the table exempts nothing: a non-terminal sub-issue the carried rows omit is
**discovered** from the same scan and entered as a row, so the index and the predicate cannot
disagree for long. FIX-1259 and FIX-1207 are not children and are not counted.

**Parentage binds the lifecycle, not only the gate — this document cannot promise that a child
stays undispatched.** A discovered child enters the table from that same scan; every refresh
re-derives its route from the Linear category, so a Bug lands on the direct route at
`NEEDS_IMPLEMENTATION` and needs no spec and no approval; and `allocate` then dispatches every
actionable unblocked row up to the concurrency cap once the epic is approved. There is no state for *parented but held back*: the only things that park a row are a
Linear-terminal state, an open `blockedBy`, or an unanswered human blocker — and none of the three
is something prose here can assert. So **FIX-1258 and FIX-1260 are eligible for dispatch on the
next approved wake**, and **this epic cannot wrap until they are fixed or cancelled.** That is not
a scope expansion: staying parented already meant both, and what is being dropped is only the claim
that they sat outside it. The boundary rule still decides **membership** — it is why FIX-1259 and
FIX-1207 are not children at all — never what happens to a child once it is one.

*(Evidence: `TERMINAL_LINEAR`, the `discovered` filter, `mayWrap`, `routeFor`, `isDirectRoute` →
`{action: 'implement'}` in `pendingAction`, and the `blockedBy` / `advance` path in `allocate`, all
in [`.agents/workflows/epic-wake.js`](../../.agents/workflows/epic-wake.js) — read from source and
run against the parent→children set rather than off the page. **No tally of what is currently
non-terminal is kept here:** the State column above is the projection, and a count beside it drifts
the moment any child moves.)*

*Why FIX-1259 and FIX-1207 have no row here while FIX-1258 and FIX-1260 do — the boundary rule and
the disposition each of the four surfaced bugs got — is recorded once, in §5. How FIX-1260's defect
works belongs to that issue and its PR, not to this index: §4 is a projection of the coordinator's
status table, and nothing refreshes a diagnosis parked inside it.*

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
  Jake flipped it in Decision Manager chat. `ResourceRef.incState` / `pushState` **ship this
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

  **Constrains FIX-1269:** the shipping `ResourceRef.incState` / `pushState` return
  **`Promise<void>`**, matching `ResourceRef`'s existing `patchState` / `setState` /
  `updateState` (`core/src/types/resource.ts:280-282`) — **not** the `Promise<boolean>` that
  `ScopeStateHandle` returns (`core/src/types/state.ts:42-43`). The verbs are being added for
  API symmetry, which makes copying the bag's signature the tempting move and the wrong one: it
  would fork `ResourceRef`'s own return contract to close a gap with the other primitive.

---

## Epic evolution

- **Epic re-founded (2026-08-20)** — objective became *symmetry where safe, asymmetry stated
  once where not*; FIX-1153 cancelled and PR #1291 closed unmerged, because the
  collapse-to-one-primitive thesis was tested and failed.
- **Theme reversed (2026-08-22)** — the CAS policy table stays in `resource-cas.ts` and FIX-1154
  adds a guard on the trap export instead, because the doc already banks the discoverability
  gain and what is genuinely unguarded is the symbol a developer autocompletes off.
- **Epic review, round 1 (2026-08-22)** — §2 cut from seven themes to three, FIX-1158 renamed an
  honest lodger, theme 2's policy-row claim marked unproven, the Tier 1 / Tier 2 guard added and
  the return contract settled at epic altitude, because the artifact had outgrown the work it
  coordinates and the shared-doc argument was process coupling, not product coupling.
- **Epic review, round 2 (2026-08-22)** — the "7 vs 4 mutator gap" retired and the epic-spec
  declared converged, because Tier 1 scoping closes increment and append, not seven verbs into
  four.
- **Parity claim withdrawn to FIX-1154 (2026-08-22)** — the epic stopped asserting a mutator
  inventory at all, because it had narrowed the claim twice and been falsified both times: a
  derivation that must be re-derived to stay true belongs to the child that owns the work.
- **FIX-1258 filed; theme 1's tombstone row qualified (2026-08-25)** — the row is marked
  incomplete for version `0`, because FIX-1154's spec review reproduced a never-observed write
  reviving a deleted resource on the real path.
- **FIX-1258 classified; both owner forks completed (2026-08-25)** — it is carried outside the
  active set and §5's forks now carry all six parts, because epic membership is not a severity
  queue and a fork stated only on the PR dies when the PR closes. *("Outside the active set" was
  retired once it turned out to describe nothing the lifecycle can do — see* The active-set
  ledger dropped *below.)*
- **Theme 1's root corrected; convergence rule narrowed (2026-08-25)** — the root is now
  tombstoned generations vs hard-deleted, recreatable records, and convergence bounds folding
  rather than the durable record, because both clauses of the old reason were false and the old
  rule would have routed owner resolutions into child notes.
- **Four corrections; the `lineageId` claim withdrawn (2026-08-25)** — the reason was wrong but
  the conclusion stood (no bag analog of FIX-1258; FIX-1000 is the existing fence), the new verbs
  were restated as inheriting the hole, and the adapter row and FIX-1155 pattern list were
  corrected — because each rested on a claim about code this set is **not changing**, now six
  such falsifications and the dominant failure mode of this document.
- **Width sweep (2026-08-25)** — every rule and mapping re-checked against its actual width:
  **one wrong** (scope `0` admits absence), **seven held**, because the recurring defect here is
  not a wrong rule but a rule stated at the wrong width.
- **Theme 1's failure mode corrected (2026-08-25)** — a shared driver does not resurrect a
  tombstone on a positive version; it retries into `ConcurrentModificationError`, because
  `checkWriteVersion` requires a *live* row for every positive expected version and a version
  match alone is not enough — the **third** supporting claim of theme 1 to be wrong while its
  conclusion held.
- **Epic-classification fork decided (2026-08-25)** — it stays an epic with FIX-1158 an honest
  lodger, taken as an engineering call rather than left on the owner, because both outcomes are
  cheap and reversible and the fork's own trigger had expired once FIX-1154 entered spec review.
- **§3 removed; this log compressed (2026-08-25)** — *Shape of the whole* is omitted per the
  template (no end-state POC was built) with its two orphaned pieces moved into themes 1 and 2,
  because a second carrier for decisions the themes already own is a drift generator — that
  section's `0` row had to be corrected twice, in two separate rounds, for exactly that reason.
- **FIX-1155's mechanism corrected (2026-08-25)** — the in-memory queue serializes **same-context**
  writers and store-level CAS covers **cross-context** ones, where the constraint had the queue
  spanning that boundary, because `withScopeLock` keys its FIFO on the `StateContainer` itself and
  cannot reach past it. **Which makes four**, and the pattern is worth stating for whoever reads
  this next: every claim this epic has had to retract was a *mechanism* description — how the code
  behaves — and the **decision** wrapped around it survived each time intact. Trust this document's
  decisions; re-derive its descriptions of the code from the code.
- **D-6 folded — this cycle ships no verbs (2026-08-25)** — the owner decided Ask 1 as **B**:
  `ResourceRef.incState` / `pushState` are cut, FIX-1154 delivers the mutation-surface gap
  write-up, Tier 2 stays deferred rather than dropped, and theme 2's proof obligation moves off
  FIX-1154 onto the deferred work, because an obligation attached to a deliverable that is not
  shipping costs a child real work and proves nothing. Five surfaces carried the superseded
  answer and were reconciled in one pass (§1's objective, necessity bullet and *Not doing*;
  theme 1's entry-point paragraph; theme 2; the §4 row; §5) together with the epic PR's diagram
  and engineering calls — and the count is the point: this is the failure this document was
  warned about, arriving through a decision rather than a stale description.
- **Theme 2's `"any"` constraint tightened; two citations corrected (2026-08-25)** — the
  constraint now binds the **delta / read-modify-write** path rather than "the resource path",
  because `runResourceCAS` already passes `"any"` for the `replace` intent by design, which
  made the old wording read as a false claim about the code. The FIX-1258 POC row was re-cited
  under its real name (`defect D5`). **Which makes five** — and both were caught by the rule
  the line above states, applied to sentences this fold happened to touch.
- **D-6 reversed to A — the handle verbs ship (2026-08-26)** — the owner flipped Ask 1 from **B**
  to **A**, so `ResourceRef.incState` / `pushState` ship this cycle as **FIX-1269** and Decision 3
  becomes API docs that follow the verbs rather than a withheld-gap story. Decision 2 is
  untouched: store-native deltas stay deferred next to FIX-992 as **FIX-1267**, and theme 2's
  proof obligation stays on **that** rewrite — its old justification ("the verbs are cut") was
  replaced with the durable one, that a read-modify-write over `runResourceCAS` never hands a
  held `expectedVersion` to a store delta verb at all. **The Tier 1 / Tier 2 split is now the
  load-bearing distinction in this document** and is stated wherever the verbs are: Tier 1 is
  handle-surface API symmetry that **wins no contention**; Tier 2 is the store interface that
  would *(that second half is wrong — see* Tier 2's contention win retracted *below)*. Eight
  surfaces carried the superseded answer and were reconciled in one pass (§1's
  objective, necessity bullets, active-set line and *Not doing*; theme 1's entry-point
  paragraph; theme 2's three tier paragraphs; theme 3's shared-paragraph seam; the §4 rows; §5's
  D-6 and return-contract entries) together with the epic PR's diagram, asks and engineering
  calls.
- **FIX-1155 recorded as shipped; its §5 fork closed by events (2026-08-26)** — PR #1388 merged
  as `864fdfa2` on 2026-08-22, which this document had gone four days without noticing while
  still carrying the fan-out crash as a live owner fork and FIX-1155 as Backlog. The lesson is
  the index's: **a fork whose subject shipped is not a decision, and leaving it live spends the
  owner's attention on a question reality already answered.**
- **FIX-1259 reopened; theme 1's version-`0` reasoning retracted (2026-08-26)** — the issue was
  cancelled on the claim that refusing a version-`0` scope write "would break first touch". First
  touch is spelled `"absent"`, not `0`; the writer that revives a hard-deleted record is a
  **held-then-lost** writer *handed* `0` by the retry path (`scope-write-predicate.ts:66` reports
  `?? 0` for the absent row, `cas.ts:169-171` commits it), so the two writers are
  distinguishable and refusing one costs the other nothing. **Which makes six** — and it is the
  sixth consecutive case of the pattern two entries above: a *mechanism* description was wrong
  while the **decision** wrapped around it (the drivers stay separate; the divergence is
  tombstoned generations vs hard-deleted records) survived intact.
- **Tier 2's contention win retracted; the deferral untouched (2026-08-26)** — the epic had
  called store-native deltas *"the tier that would actually win contention"*. Under this theme's
  own held-`expectedVersion` constraint they win none: `DeltaStoreOps`'s contract is *"identical
  to `set`"* (`stores/types.ts:446-449`), and all three verbs have a passing *conflict on stale
  expectedVersion* row. What they buy is **write amplification**. The bag's real win is the
  commutative downgrade to `"any"` (`scope-persist.ts:60`) — the exact move theme 2 forbids
  generalizing — so the epic had been crediting the verbs with a benefit the downgrade produces.
  **FIX-1267 stays deferred and Decision 2 is not reopened**; its *justification* is rescoped,
  which is that issue's finding to carry. **Which makes seven** — and it is the pattern six
  entries above arriving through a *promise* rather than a description: the mechanism claim was
  wrong, the decision wrapped around it (defer, don't drop) survived intact.
- **Sequencing declared; the any-order claim withdrawn (2026-08-26)** —
  **FIX-1269 is a prerequisite of FIX-1154's documentation work**,
  because D-6's Decision 3 says the docs
  *follow* the verbs and "merged in any order" contradicted a stamped owner decision. FIX-1154's
  §8 writing-time rule survives as the fallback if the order breaks, not as an alternative to
  declaring it. The identical ruling went to #1445 round 26 — a spec and its epic disagreeing
  about ordering is worse than either answer.
- **FIX-1259 dropped from the index; FIX-1260's membership reopened as a fork (2026-08-26)** —
  FIX-1259 was unparented from FIX-1157 and banner-marked *"leftover, do not re-parent"*, so it
  leaves §4 entirely; the index is a projection of the Linear graph, not a second opinion about
  it. FIX-1260 went the other way and **should not have moved at all**: this fold first carried
  it as a "flagged inactive row", which is still indexing, and indexing it *is* the answer to
  the question of whether it is a member. The row was removed and §5 now carries the fork,
  because **resolving a pending owner question by writing an artifact is not a resolution** —
  the same overstep D-6 produced earlier the same day. §5 had also been declaring no live fork
  while §4 held one open; that contradiction is real, and it was §5 that was wrong. *(The row
  removal is reversed below — see* The parentage question settled the other way*: once the question
  is closed, a parented child is simply indexed.)*
- **"Wrap does not wait for it" retracted — the predicate says otherwise (2026-08-26)** — this
  document promised of FIX-1207, FIX-1258 and FIX-1260 that epic wrap would not wait on them.
  `mayWrap` requires **every row Linear-terminal** and builds its rows from the Linear
  parent→children query, so all three hold the epic open while parented and non-terminal. The
  regex was lifted from `.agents/workflows/epic-wake.js` and **executed** against all eight
  parented children rather than read. §4 now states the real condition and the three claim sites
  point at it. **Which makes eight** — and the first of the eight to be a promise about *our own
  tooling* rather than about product code, which is why nobody caught it by reading FSD. *(The
  predicate is three-way and this entry compressed it — corrected below, see* The wrap predicate
  restated: merging releases a row too*. The conclusion here survives either wording: a child that
  is neither merged nor terminal holds the gate.)*
- **FIX-1269's implementation specifics dropped to its spec (2026-08-26)** — the epic had fixed
  the mechanism, the persistence path and an approximate line count for a child whose spec gate
  is still empty, which pre-empts the review surface meant to validate it. The **cross-issue**
  constraints stay exactly as they were: Tier 1 is handle-surface API symmetry that wins no
  contention, Tier 2 is store-native and deferred, the two are never described as one, and
  FIX-1269 precedes FIX-1154's docs. Only the *how* left.
- **The Tier 2 verb-set exclusion withdrawn (2026-08-26)** — a direct consequence of the
  contention retraction above. `patchField` was excluded because resources already have depth-1
  `patchState`; that answers a capability question, and the tier is now justified by write size.
  `patchState` materializes the whole state object and persists it through a full-record
  `ResourceStateStore.set`, so a native `patchField` buys the same smaller write as `incField`.
  `deleteField`'s exclusion was worse — "removing a record is a lifecycle op" describes a verb
  that removes a **record**, and `deleteField` removes a value inside `state`. Scoping the verb
  set is FIX-1267's; the epic stopped pre-empting it.
- **All four surfaced bugs unparented; FIX-1260 settled without the owner (2026-08-26)** — one
  disposition for FIX-1259, FIX-1207, FIX-1258 and FIX-1260: **unparent, link `relates-to`**, on
  the boundary rule that epic membership is not a severity queue. The first two writes have
  landed and their rows are gone; the last two are pending and keep their rows and their wrap
  gate until then. *(The last two writes never landed — see* The parentage question settled the
  other way *below. Two and two, not four.)*
  **The lesson is where the question went, not what it answered.** In one day
  this paragraph was written three ways — index it as inactive, put it to the owner as a live
  fork, settle it — and only the third is right, because
  **parentage is organization and sits below the owner-decision bar.**
  Indexing it decided a question that was open; escalating it
  spent the owner's attention on the shape of an issue graph. A document is not the place to
  resolve a pending decision, and not every pending decision is the owner's.
- **"Nothing becomes atomic" retracted — Tier 1 preserves CAS atomicity (2026-08-26)** — the
  epic had narrowed "Tier 1 wins no contention" (true) into "nothing becomes atomic" (false) at
  §1 and, worse, into an instruction at theme 2 telling FIX-1269 not to call the verbs atomic —
  a claim Decision 3 would have carried into shipped user-facing docs. `runResourceCAS` refreshes
  to the winner's row on a conflict and **re-runs the mutator against it**
  (`stores/resource-cas.ts`), and `persistResourceState` hands the caller's updater in as that
  mutator (`context/resource-registry.ts`), so a successful call is the single CAS-guarded
  mutation `state-and-scopes.md` already calls atomic. **The cost of publishing it was the
  reason to catch it:** a caller told these verbs are not atomic hand-rolls an external
  read-then-write, which is genuinely unsafe and is the exact failure this epic exists to stop
  the docs from causing. **Which makes nine** — and the first where the retracted claim was not
  merely wrong but *actively harmful if believed*, which is what a guard comment or an API doc
  makes of every claim it carries.
- **Theme 2's bag-shape rationale replaced by the lifecycle one (2026-08-26)** — the epic
  distinguished the two primitives by "the blob is a bag of independent keys", which does not
  distinguish them: resource state is a JSON object with field-level merges too
  (`updateObjectState`). The real asymmetry is deletion — `checkWriteVersion` admits `"any"`
  **before testing liveness** (`resource-state-predicate.ts:143`), so an `"any"` write lands on
  a tombstone, and retention is the resource store's whole bet. The conclusion is unchanged
  (resources pass their held version); only the reason moved. **This is the FIX-1259 shape**: a
  right conclusion on a false reason, which the deferred implementation inherits — and here the
  shape argument would have *expired* the moment Tier 2 gave resources field-scoped writes,
  handing FIX-1267 a licence to revive deleted resources.
- **The child-only constraints subsection removed (2026-08-26)** — two constraints binding
  exactly one shipped child each (FIX-1155, FIX-1158) sat below the themes, which
  [`epic-spec-template.md`](../../docs/contributing/epic-spec-template.md) routes to the child's
  own spec or PR. **They had already drifted, which is the argument, not a bonus:** the FIX-1158
  bullet said the check keys on `(scope, ref, flowIsolation)`, while the code that merged in
  #1444 says effective isolation is *"a participation filter, not part of the index"*
  (`registry/flow-registry.ts`), and its citation to a parked `it.skip` pointed at a test #1444
  unskipped. A second durable carrier for a shipped child's design cannot stay true, because
  nothing updates it when the child changes. The record lives on #1388 and #1444.
- **The parentage question settled the other way; FIX-1260 re-indexed (2026-08-26)** — the
  wrap-unparent write for **FIX-1258 and FIX-1260 was skipped and is not being re-asked**, so both
  stay children of FIX-1157. This document had them leaving: *"all four surfaced bugs are
  unparented"*, *"pending the Linear write"*, and a §5 entry closing FIX-1260 as unparent-pending.
  All of that is retracted, and so is the earlier ruling — *FIX-1259 dropped from the index*, above
  — that FIX-1260 must not be indexed: a parented child belongs in §4, because the index is a
  projection of the Linear graph and not a second opinion about it. That ruling was right while the
  question was open and wrong once it closed. Re-verified against Linear rather than carried:
  **seven children, four
  non-terminal** (FIX-1154, FIX-1258, FIX-1260, FIX-1269), FIX-1207 and FIX-1259 unparented; with
  FIX-1260's new row the index and the graph now match one-for-one. The consequence is stated as
  fact rather than as a defect to escalate: **this epic cannot wrap until FIX-1258 and FIX-1260 are
  fixed or cancelled.** **Which makes ten** — and it is the second after the wrap retraction to be
  a wrong claim about *our own tooling's inputs* rather than about product code. The pattern is
  narrower than "mechanism descriptions drift": both were claims about a **mutable external graph**
  this document only mirrors, and the fix in both cases was to execute the query rather than reason
  from the last thing we wrote. **The boundary rule itself is untouched** — epic membership is not
  a severity queue, which is still why FIX-1259 and FIX-1207 stay out; it lost the parentage
  argument for the other two without being wrong.
- **FIX-1260's row inverted, and its 43-line diagnosis left §4 (2026-08-26)** — the row's *what it
  delivers* cell described the **defect** (`normalizeResourceState` stores `safeParse` output)
  in the slot that tells an implementer what to build, so following it would have changed nothing:
  both copies already return the parse output (`routes/route-utils.ts:250`,
  `context/resource-registry.ts:205`). The cell now states the delivery — validate the candidate,
  then store the candidate. *(That direction is right for the write path and wrong for the reads —
  corrected below,* FIX-1260's row split by direction*.)* **The diagnosis that sat under the index
  went with it**, to the issue
  that owns it;
  [`epic-spec-template.md`](../../docs/contributing/epic-spec-template.md) keeps §4 a status-table
  projection rather than prose, and a diagnosis parked there has no refresh trigger.
  **The two findings are one finding.** The row and the diagnosis said the same thing twice inside
  one section, which made two things to keep true, and they contradicted each other **inside a
  single commit** — the row prescribed what the diagnosis below it called the bug.
  That is the second removal of this shape after *the child-only constraints subsection*, above;
  there the two carriers took four days to drift, here one commit, because both copies were
  written in the same pass and only one of them was aimed at an implementer.
  **Not counted as a retraction:** the mechanism the row named was true. It was in the wrong slot,
  which is a different defect from a claim that does not hold.
- **FIX-1260's row split by direction (2026-08-26)** — the entry above fixed the row by prescribing
  *validate the candidate, then store the candidate*, and that is right for the **write** path and
  wrong for the four **read** paths. `normalizeResourceState` serves both: the registry copy is
  reached once from a mutation (`context/resource-registry.ts:688`, normalizing `await
  mutate(current)`) and once from a persisted seed (`:233`), while `routes/route-utils.ts`'s copy
  has **no write path at all** — both its call sites and `resource-routes.ts:112` normalize
  persisted values on the way out. Returning the candidate on a read is not merely unnecessary, it
  is a **new defect on every historical row**: read normalization is how a row written before the
  schema gained a defaulted field acquires it, which `defineResource` does to real resources today
  (`core/src/types/resource.ts:491` folds in `edges: edgeListSchema.default([])`). Run rather than
  reasoned — `safeParse({count:3})` against that schema returns `{count:3,edges:[]}`; the candidate
  is `{count:3}`. **Which makes eleven**, and the shape is the familiar one: the *decision* (stop
  the write path drifting the stored value) survived; the **width** of the mechanism did not.
  **The two-copy story reframes with it.** The copies are not two instances of one job that both
  need the same fix — the registry copy **conflates** a write and a read behind one function, and
  that conflation is what FIX-1260 has to split. Duplication was the smaller half of the finding.
- **The active-set ledger dropped; dispatch accepted (2026-08-26)** — this document had FIX-1258
  and FIX-1260 as parented children "not in the active set", i.e. members that gate wrap but that
  nobody would dispatch. **`epic-wake` cannot represent that.** It discovers every non-terminal
  Linear child, routes a Bug to `NEEDS_IMPLEMENTATION`, and `allocate` advances every actionable
  unblocked row once the epic is approved; the only things that park a row are Linear-terminal
  state, an open `blockedBy`, or an unanswered human blocker. So the next approved wake starts
  them, whatever the prose says. **Which makes twelve** — and it is the third claim about *our own
  tooling* rather than about FSD, after the wrap predicate and the Linear graph, which is now the
  clearest cluster in this log: every one was a promise about a mechanism nobody had executed.
  **Of the two bookkeeping options, the dual ledger was dropped rather than the two issues folded
  into what this cycle delivers.** Folding them in would have made the epic's boundary "concurrency
  bugs we found" — the exact thing the boundary rule exists to refuse — while the "active set" was
  a second ledger with nothing reading it, so it could only ever drift from the graph that does.
  Three drifts in, one ledger is enough. **This is not a scope expansion**: stay-parented plus
  `mayWrap` already meant both issues had to be fixed or cancelled before wrap. What was false, and is now
  dropped, is the claim that they sat outside the set while parented. The boundary rule itself is
  untouched and still explains why FIX-1259 and FIX-1207 are not children — it decides
  **membership**, never what happens to a child once it is one.
- **FIX-1154 kept whole; the docs ordering stated as unencodable (2026-08-26)** — "only the
  documentation half waits for FIX-1269" has no encoding: a row carries one phase and one
  `blockedBy`, and a blocker parks the whole issue, so encoding it would park the map half and
  leaving it unencoded starts both. The answer is neither a Linear blocker nor a split of FIX-1154
  into lifecycle-shaped slices — **an issue is not reshaped to fit a status table.** D-6's
  Decision 3 is honoured where it actually binds: what waits is **publication**, not the writing,
  and the §8 writing-time rule remains the fallback. Theme 3 now says the constraint is prose *and
  why it stays prose*, so the next reader does not add the blocker. **Not counted as a
  retraction:** the ruling held, only its assumed encoding did not exist.
- **Two carriers dropped to their owners (2026-08-26)** — theme 2 was prescribing FIX-1267's
  **first task**, its proof mechanism (`settle-claim` or characterization test) and the exact cases
  to cover, which is a single issue's test plan and belongs to its spec
  ([`epic-spec-template.md`](../../docs/contributing/epic-spec-template.md) → *Out of scope*); the
  epic keeps the cross-cutting half — the claim is unproven, FIX-1267 owns discharging it against
  the running path, and a failure changes **the theme**. Same class as the FIX-1269
  over-specification dropped earlier the same day. And §4 carried an executed count of what was
  non-terminal beside the table that already projects it; the **rule** (what `mayWrap` reads, and
  that omission exempts nothing) stays, the **reading** goes, because a tally in prose next to a
  status projection has no refresh trigger. That is the third removal of the two-carriers shape,
  after the child-only constraints and FIX-1260's diagnosis.
- **FIX-1260 has two write sites; the row said one (2026-08-26)** — §4 gave the write path as
  `context/resource-registry.ts:688`, *"the one write site."* True of `normalizeResourceState` and
  false of the defect. `persistNamespaceInstanceState` (`:694-705`) carries its own inline
  `safeParse` and persists `parsed.data` the same way, on the **collection-instance** write path
  reached from `:771`, `:787`, `:809` and `:1291`. Grepped at branch HEAD rather than carried.
  **The enumeration was of one function's call sites, not of the behaviour** — a right answer to a
  narrower question than the row was making a claim about, which is the shape BP-003 warns of as a
  green result from a check aimed at a neighbour of the claim. It was committed *while correcting
  another instance of it*, and the fact needed to catch it was already on the page: this document
  had established that collections carry their own inline `safeParse`-then-`{}` and that no shared
  normalizer spans both. The row now names the **behaviour** — every resource write validates the
  mutation output and stores the candidate — with both sites under it. **Which makes thirteen.**
- **FIX-1260 covers both write sites (2026-08-26)** — decided here rather than escalated, because
  *which issue owns which write site* is a cross-cutting call no single child can make, and neither
  outcome touches the objective. **The symptom is one symptom**: a transforming or defaulting schema
  drifts what lands. A fix reaching only single resources leaves `collection.upsert()` and the three
  instance verbs drifting in the same file, which reads as a wrong fix rather than a partial one.
  The collection half is also the **smaller** half — `persistNamespaceInstanceState` is write-only,
  so it is a one-expression change, while `normalizeResourceState` is the site that has to **split**
  a conflated write and read. Filing the remainder separately would put one decision on two
  carriers, the shape removed three times above, and the file already reasons across both sites:
  `:1260-1265` has `upsert` validating ahead of the helper *"rather than rely on
  `persistNamespaceInstanceState`'s safeParse-with-empty-fallback"*, so an implementer touching one
  has to keep a comment about the other true regardless. **The bare-`{}` fallback on FIX-1256 does
  not change the split; it argues for it.** The two are orthogonal on the same expression: FIX-1260
  owns what is stored when the parse **succeeds** (candidate vs `parsed.data`), FIX-1256 owns what
  is stored when it **fails** (`{}` vs the config default `normalizeResourceState` uses). Opposite
  branches of one `if` — a merge-order note for whichever lands second, not a reason to merge the
  issues or to narrow FIX-1260. **Not counted as a retraction:** no prior claim is withdrawn; the
  entry above widened the facts and this is the scope call that follows from them.
- **The wrap predicate restated: merging releases a row too (2026-08-26)** — §4 gave `mayWrap` as
  requiring **every row Linear-terminal**. The predicate is three-way —
  `issues.every((r) => r.linearTerminal || r.merged || r.phase === 'DONE')`
  (`.agents/workflows/epic-wake.js:3410`, read at HEAD) — and the dropped disjuncts are not
  synonyms for the first: **a child whose PR has merged releases the gate while its Linear status
  lags.** As written, the note told a coordinator to hold an epic open on a fix that had already
  landed. `merged` and `phase === 'DONE'` are one release on two fields, kept in step in both
  directions by `mergeDerivedPhase` (*"the merge decides"*), so the genuine second release is the
  merge. **Which makes fourteen** — and the sharp part is where it came from: *"Wrap does not wait
  for it" retracted*, entry eight, **introduced this compression while correcting the claim above
  it.** That entry executed `TERMINAL_LINEAR` against the children, which is a real check of one
  disjunct, and wrote the result up as though terminality were the whole rule. That makes four
  claims about *our own tooling* — entries eight, ten, twelve and this one — and the first where the
  wrong claim was **produced by a correction**, which is the failure a log of corrections is most
  exposed to: the checking effort goes into the claim being retracted, not into the sentence
  replacing it.

