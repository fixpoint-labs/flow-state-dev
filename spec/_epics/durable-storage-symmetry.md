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
belongs: an atomic increment or an array append means scope state (`incState` / `pushState` on
`ScopeStateHandle`, `core/src/types/state.ts`), per-key versioning and collision detection
means resources — `ResourceRef` carries no delta verb at all
(`core/src/types/resource.ts`). The operating rule is **symmetry where it is
safe, and the asymmetry stated once where it is not**: one mutation contract wherever the two
primitives can share one without
importing each other's semantics, and where they cannot, the reason written down in a single
place a reader hits *before* reaching for the wrong import rather than after.

**This cycle delivers the second half of that rule and none of the first** — decided by the
owner in [D-6](https://github.com/fixpoint-labs/flow-state-dev/issues/1446), Ask 1 = **B**. No
resource delta verb ships: `ResourceRef.incState` / `pushState` are **cut from this cycle**,
because no consumer driving the release needs them, every current use is compound,
`updateState` is the working substitute, and unused public surface cannot be taken back once
shipped. What lands instead is the **gap write-up** — every difference between the two mutation
surfaces recorded with its reason. So the verb list still drives the choice when this epic
wraps; what changes is that a developer meets the reason *before* the wrong import instead of
after. Narrower outcome, same rule.

*Code citations are against `origin/main` at `6aa1bea`.*

**This epic does not merge the two primitives and does not delete either one.** It originally
proposed collapsing them by deprecating scope state at session/user/org. That thesis was
tested and abandoned (see *Rejected framings* in §2); the trial removal PR
[#1291](https://github.com/fixpoint-labs/flow-state-dev/pull/1291) was closed unmerged and
FIX-1153 was cancelled. The divergence turned out to be load-bearing rather than accidental
(theme 1). What changed is the conclusion drawn from the overlap — not *delete the bag*, but
*stop making callers pick a primitive by its verb list*.

**Holistic necessity — one substantive issue and one lodger. The set is thin, and that is
the honest description of it.**

- **FIX-1154** (the mutation surface — **the gap write-up**: every difference between the two
  mutation surfaces mapped in its own spec, each one deliberate-with-a-reason or deferred, and
  **no verb closed**) *is* the epic. Without it nothing here delivers.
- **FIX-1158** (cross-flow resource validation never runs) is a **same-subsystem
  unintended-asymmetry lodger** — the epic's own thesis pointed at itself, where the
  architecture doc already promises the two primitives behave alike and the code silently
  doesn't. **It would ship independently and needs no epic parentage.** It is kept on that
  footing and no other. The earlier membership argument — that all the children edit one
  markdown file — is **withdrawn**: doc paragraph ownership is cheap to rebase, which makes
  it process coupling, not product coupling. Shared-surface coordination is still real, but
  it is a convention for the children (theme 3), not proof that they are a set.
- **FIX-1155** (request-scope CAS vs block-scope mutex) is an asymmetry *inside* scope state,
  completing FIX-492 for the one scope it deferred; it would read identically if resources
  did not exist. Held at Backlog and **not in the active set**. Its membership is a live fork
  in §5.
- **FIX-1207** (overlapping collection keyspaces slip past the cross-flow check) is
  FIX-1158's **spun-off remainder** — scope deliberately excluded from that bug and blocked
  on it. At Backlog and **not in the active set**; carried in §4 so the set is complete. It
  changes no theme and adds no decision at this altitude.
- **FIX-1258** (a deleted resource revived by a request that never saw it) is the version-`0`
  hole in theme 1's tombstone row — found by FIX-1154's spec review and reproduced on the real
  path. **Not in the active set**, on the reasoning that already keeps FIX-1155 out and spun
  FIX-1207 off: **epic membership is not a severity queue.** It is a live bug that should be
  scheduled on its own merits, plausibly before this epic wraps, but holding the epic open does
  not make it get fixed any sooner — and taking it in would make this epic's boundary "resource
  concurrency bugs we found", which is how a set stops being a set.

**The active set is FIX-1154 plus the FIX-1158 lodger.** FIX-1155, FIX-1207 and FIX-1258 are
carried in §4 so the record is complete; **wrap does not wait for any of them.**

Whether one substantive issue plus a lodger is an epic at all — rather than one issue and a
standalone bug — was asked twice by review and is **decided: it stays an epic** (§5, resolved).
An engineering call, not the owner's, because both outcomes are cheap and reversible.

**Not doing:** merging the two primitives; deleting or deprecating either one at any scope;
re-attempting the org-state removal; cross-record atomicity (FIX-854); and resource-specific
surface with no state analogue at all — content, `client`, `reactTo`, `edges`, collections.
**Nor is any verb reconciled at all — increment and append included** (D-6). Every difference —
a verb one primitive lacks, or a verb they nominally share whose shape differs — is **mapped by
FIX-1154, not closed by it**. Two different reasons sit behind that one word, and collapsing
them is how a reader concludes the wrong thing: most of these differences are out of scope **by
construction** and are not coming back, while **increment and append are deferred** — the one
pair that was going to close, now cut from this cycle and explicitly not dropped (theme 2,
Decision 2). **No child deprecates, removes, or
migrates a primitive** — every one of them fixes, generalizes, or documents. A child that
finds itself proposing a removal has hit the rejected framings in §2 and comments up on this
PR rather than deciding locally.

## 2. Themes & long-horizon direction

Three cross-cutting decisions. A constraint that binds exactly one issue is not a theme; the
two that have nowhere else to live are recorded below the themes, and labelled as such.

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
   Because absence also reads as `0`, the same write lands when the row is *gone*. **That is not
   a bag-side hole** — a version-`0` write into an empty slot **is** a create, and refusing it
   would break first touch or require tombstones on scope records, which unifies the drivers
   this theme keeps apart. The resource side differs precisely because it *has* a tombstone and
   a deleted-stays-deleted bet, so its predicate intends to refuse and misses `0`. The scope-side
   case that *is* real — work still running when a delete lands, writing into a session after it
   was emptied — is already filed as **FIX-1000**, a FIX-992 residual **outside this set** and not
   a member of §4's index. So the divergence is **tombstoned generations versus hard-deleted,
   recreatable records.**

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

   **No new entry point to the hole is added this cycle, and the hole is still open.** The two
   facts are independent and both survive D-6. `updateState` does exactly this on `main` today,
   with no new verb involved — so the hole exists whatever this epic ships. What *would* have
   added fresh entry points to it, `incState` and `pushState` routing through the same
   `runResourceCAS` read-modify-write at held version `0`, is now **cut** (theme 2), so the
   count of ways in is unchanged rather than raised. The limitation is still *pinned at the
   child* rather than left implicit — FIX-1154's characterization POC carries a row named
   *"CURRENT BEHAVIOUR (defect D5): a version-0 context REVIVES a tombstone"*
   (`spec-poc/FIX-1154-resource-mutation-verbs/policy-rows.poc.test.ts`, PR
   [#1445](https://github.com/fixpoint-labs/flow-state-dev/pull/1445)) that asserts today's
   wrong behaviour and **fails when the fix lands**, which is the intended signal.
   **FIX-1258** owns closing it, and is carried **outside the active set** (§1), so this epic
   can wrap before it lands.

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
   one line, `scope-persist.ts:60` (`commutative ? "any" : expectedVersion`), and that is safe
   for scope state only because the blob is a bag of independent keys. Resources pass **their
   held version** instead.

   **Unproven, and now unproven for longer.** That *every row of the resource policy table
   survives* under a held version is a **type-level read no code has exercised**, and it stays
   that way. With the verbs cut (D-6) there is nothing left this cycle for a proof to gate, so
   **FIX-1154 carries no proof obligation** — an obligation attached to a deliverable that is
   not shipping costs a child real work and proves nothing. The proof rides **Decision 2's
   deferred native deltas** instead, as the epic-theme rewrite next to FIX-992, and it is that
   rewrite's first task: a characterization test or a `settle-claim` on the real resource path
   covering tombstone, lost create-if-absent and verified no-op, **before** any delta verb is
   locked. If it fails, this theme changes rather than one issue's design. It remains the
   least-evidenced claim in this document — it is simply no longer *this cycle's* risk,
   because this cycle writes no code against it.

   **Constrains:** no issue in this set may reach for `"any"` on a resource **delta or
   read-modify-write** path. That qualifier is load-bearing and was missing: `"any"` already
   travels the resource path on one intent by design — `runResourceCAS` passes it for
   `replace`, the deliberate unconditional overwrite behind `create({ replace: true })`
   (`resource-cas.ts:73`, `:220`) — so this is a constraint on new mutation work, not a claim
   that `"any"` is absent. `"absent"` throws on the delta verbs by contract, so create-if-absent
   stays a separate op — which is how resources already model it. **Extend the seams that
   exist; do not invent a new core `MutationContract` type until a second consumer appears.**

   **Neither tier ships this cycle, and the two are stopped in different ways (D-6).** *Tier 1*
   — caller-visible **increment and append**, `ResourceRef.incState` / `pushState` via a
   `runResourceCAS` read-modify-write on the existing `set` path — **was** the deliverable and
   is **cut**: not built, not shipped, not required for wrap. *Tier 2* — store-native
   `incField` / `pushToArray` on `ResourceStateStore` across every adapter plus conformance —
   remains **deferred and explicitly not dropped** (Decision 2). Both return, if they return,
   through the same door: the epic-theme rewrite next to FIX-992, where the deferred native
   deltas are scoped as one body of work rather than two tiers of one issue. If a delta verb
   ever lands it must **not** reuse `createScopePersist` or commutative hints: that is
   precisely how `"any"` re-enters the resource path.

   **With Tier 1 cut, the whole mutation-surface asymmetry stands when the epic wraps** — the
   caller-visible half as well as the adapter half. Nothing closes; what ships is the map.
   `patchField` and `deleteField` stay scoped out of the deferred work as well, with a reason:
   resources already have depth-1 `patchState` (`types/resource.ts:270`), so `patchField` would
   only earn its place for nested paths, and removing a record is a lifecycle op rather than a
   state mutation.

3. **`docs/architecture/state-and-scopes.md` is a shared surface, and each child names the
   paragraph it owns.** FIX-1154 rewrites what the doc says about the two primitives' mutation
   surface — the mutator sets, the return contract, and which writers carry a version — while
   leaving the policy-table pointer sentence alone (theme 1). FIX-1158 makes true what its
   cross-flow conflict table already promises. FIX-1155, if it ramps, changes its
   request-scope statement and corrects the two orchestration docstrings that call task
   mutations "CAS-guarded" where block containers in fact take the mutex.

   **Constrains:** no issue silently rewrites a neighbour's paragraph, and if two land close
   together the second rebases the doc edit rather than resolving a conflict by preference.
   **There is no sequencing** — the children are independent and can be specced, built and
   merged in any order. The only collision seam is `createScopePersist`, and it exists only
   if FIX-1155 ramps while FIX-1154 is in flight.

### Constraints on individual children

Not themes. Both are recorded here for want of anywhere else: the first corrects something
this document previously promised, and the second belongs to a `direct`-route bug that has no
spec of its own.

- **FIX-1155 retains store-level CAS. The two mechanisms cover different writers, and neither
  covers the other's.** The in-memory queue serializes **same-context** writers; **store-level
  CAS** is what protects **cross-context** writers. `withScopeLock` keys its FIFO queue on the
  `StateContainer` object itself (a `WeakMap`, `stores/scope-lock.ts`) and its own contract says
  *"mutators on different containers are independent"* — so it cannot reach across contexts at
  all, and a resumed or BullMQ-reclaimed writer holding a **distinct `StateContainer`** is
  outside it by construction. FIX-1155 therefore adds serialization **within** a context and
  **does not** switch request scope to the in-memory mutex: a lock-only fix would repair
  same-context task-board fan-out while letting a stale writer overwrite newer durable request
  state. That cross-context concurrency is established in *Rejected framings* below. **Do not
  read this as an instruction to widen the lock** — making it process-wide or distributed is the
  lock-only design this constraint exists to prevent; the cross-context job is already CAS's.
- **FIX-1158 keys cross-flow checks by `(scope, ref, flowIsolation)`, not by accessor name.**
  Accessors are explicitly not storage identity: a flow can expose the same shared user/org
  resource under different accessors, or reuse one accessor for different `ref`s, so reading
  the flat `flow.resources` map alone does not identify the durable slot that needs a
  compatibility check. Effective resource isolation is evaluated **independently of the
  flow-level state-isolation flag**, because a resource can override that flag in either
  direction. The parked regression states the same keying
  (`packages/engine/test/flow-isolation.test.ts:127`, `it.skip` at `:130`). Without both, the
  repaired check still misses incompatible schemas sharing storage *and* rejects schemas that
  are genuinely isolated.

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
| [FIX-1154](https://linear.app/fixpoint-labs/issue/FIX-1154) | *Scope state and resources split one mutation surface across two APIs* — **the mutation-surface gap write-up** (D-6): every difference mapped in its spec as deliberate-with-a-reason or deferred. **No verb closes this cycle** — `ResourceRef.incState` / `pushState` are cut, so increment and append are mapped like the rest | spec | [#1445](https://github.com/fixpoint-labs/flow-state-dev/pull/1445) | — | In Spec Review |
| [FIX-1158](https://linear.app/fixpoint-labs/issue/FIX-1158) | Cross-flow resource schema validation actually runs, keyed by `(scope, ref, flowIsolation)` | **bug** | — | [#1444](https://github.com/fixpoint-labs/flow-state-dev/pull/1444) | In Review |
| [FIX-1258](https://linear.app/fixpoint-labs/issue/FIX-1258) | A write from a context that **never observed** a resource does not revive it after a delete, while the ordinary first touch of a never-written resource is unchanged — the version-`0` hole in theme 1's tombstone row | **bug** | — | — | Todo *(not in the active set; wrap does not wait for it)* |
| [FIX-1207](https://linear.app/fixpoint-labs/issue/FIX-1207) | Cross-flow validation compares exact refs, so overlapping collection keyspaces slip through — the scope excluded from FIX-1158, filed separately | **bug** | — | — | Backlog *(blocked by FIX-1158; not in the active set)* |
| [FIX-1155](https://linear.app/fixpoint-labs/issue/FIX-1155) | Request-scope state serializes **same-context** writers in the in-memory queue while **retaining store-level CAS** for cross-context ones; wide fan-out stops throwing `ConcurrentModificationError` | spec | — | — | Backlog *(not in the active set)* |
| [FIX-1153](https://linear.app/fixpoint-labs/issue/FIX-1153) | ~~Deprecate scope state at session/user/org; delete org state~~ | — | — | [#1291](https://github.com/fixpoint-labs/flow-state-dev/pull/1291) *(closed unmerged)* | **Canceled** |

*A bug carries no spec PR by design — it routes straight to implementation
([`orchestration.md`](../../docs/contributing/orchestration.md) → "Which issues get a spec").
An empty Spec PR cell on a `bug` row is correct, not a gap.*

*FIX-1153 is kept in the index rather than dropped. Its cancellation and the closed PR are the
epic's most expensive finding — see* Rejected framings *in §2 — and a reader who cannot see it
here has no way to know the framing was tried.*

**Surfaced by this epic, owned elsewhere — two live defects on `main`, neither fixed here.**
FIX-1154's spec review promoted two findings from *gaps in a proposed guard* to *defects
already shipped*, and both are being filed separately:

- A **`.catch()`-wrapped state schema stores its fallback and erases untouched fields.** An
  inner refinement violation never makes `safeParse` fail, so the fallback is what gets
  stored: the write succeeds, the version advances, and a field the caller never touched comes
  back as the schema default. Nothing throws.
- A **schema transform can produce a value the adapters store differently.** The memory store
  keeps `Infinity` (it clones with `structuredClone`); every JSON-backed adapter flattens it to
  `null`, which then fails the schema on the next durable read. Two deployments hold different
  data from the same call, and neither raises.

Both share **FIX-1260's root**: `normalizeResourceState` stores the **output** of `safeParse`
rather than validating the candidate and storing the candidate, so any schema that rewrites its
input on parse changes what lands. **The root has two copies, not one** — the same function
exists independently in `routes/route-utils.ts` and in `context/resource-registry.ts`, and it is
the registry copy that runs on both ends of every read-modify-write. A fix that lands in one
place leaves the other standing. *These are **not** members of this set and wrap does not wait
on them: the epic found them, it does not own them. They are recorded here because a reader who
sees the epic's characterization rows asserting today's wrong behaviour needs to know those rows
are tracked work, not an epic deliverable.*

## 5. Open cross-cutting questions

**One live fork remains, and it is the owner's.** It is stated in full here rather than only on
the epic PR — the PR closes when the epic wraps; this document outlives it.

- **Does this epic finish with the task-board fan-out crash still live?** *Raised by this
  epic-spec at authoring; blocks nothing today — the active children proceed either way — but
  it decides what "wrapped" means.*

  **Plain terms.** FIX-1155 fixes a real failure: a fan-out wider than about four concurrent
  writers over a **request-backed** task board throws `ConcurrentModificationError` with no
  application-level cause. **No shipped pattern reaches it on its defaults** — this fork
  previously said four of them did, and that was wrong. `planAndExecute` defaults to
  `maxConcurrency: 1` (`patterns/src/plan-and-execute/index.ts:614`) and `supervisor` to `3`
  (`patterns/src/supervisor/index.ts:280`), so each needs a caller to raise it past four.
  `blackboard` no longer exists — it is now `routedSpecialists`, whose collection is
  **sequencer-backed** (`backing: "sequencer"`, `patterns/src/routedSpecialists/index.ts:202`)
  and so never touches request-scope CAS at all. `goalSeekLoop` takes a **caller-supplied**
  board (`orchestration/src/task-board/goal-seek-loop.ts:102`) and reaches this only when that
  board is request-backed and driven wide. So the crash takes a deliberate configuration, not a
  default. It is a child of this epic but sits at Backlog, outside the active set.

  **The trade-off.** Including it means the epic delivers a user-visible reliability fix, at
  the cost of a third workstream and a file-collision risk with FIX-1154. Leaving it out means
  the epic wraps clean on its actual thesis, but the asymmetry stays standing and the crash
  waits for a separate ticket to be scheduled.

  **My recommendation: leave it out, and schedule it as its own issue soon.** It is an
  asymmetry *inside* scope state, completing FIX-492 for the scope it deferred — it would read
  identically if resources did not exist. Carrying it here makes the epic's boundary
  "concurrency things we noticed", which is how a set stops being a set. **The corrected
  exposure above strengthens this**, and you should know it cuts that way: when the fork was
  written it claimed four shipped patterns hit this by default, and none of them do.

  **What would change my mind:** if a real app is hitting it — which now means one that has
  raised `maxConcurrency` past four over a request-backed board, not merely one using these
  patterns. Then it is a reliability fix that should not wait on scheduling.

  **What being wrong costs: low and reversible either way** — a delay until it is scheduled,
  or one workstream of coordination overhead.

- **~~Is this an epic, or one issue and a standalone bug?~~** *Resolved: it stays an epic, with
  FIX-1158 named an honest lodger rather than dressed up as a member.* Raised independently by
  two reviewers, and correct that the shared-doc argument for membership was process coupling —
  which is why it is withdrawn (§1) rather than defended. **Decided as an engineering call, not
  put to the owner:** both outcomes are cheap and reversible, which is precisely the shape a
  reader of `asking-for-decisions.md` should not be spending attention on. Kept because the
  cross-cutting calls — the CAS divergence, never `"any"` on the resource path, the
  return-contract asymmetry, and three separate corrections to theme 1's justification — are
  exactly what gets re-derived expensively, and this epic has already paid once for re-deriving
  one (#1291, closed unmerged). An epic's real cost here is a coordination doc somebody
  maintains; its return is that those calls have one home a future third consumer can find.
- **~~Does this cycle add public resource verbs, or document the gap?~~** *Resolved by the
  owner in [D-6](https://github.com/fixpoint-labs/flow-state-dev/issues/1446) — closed
  completed, `Decision`: **document the gap.*** `ResourceRef.incState` / `pushState` do not
  ship this cycle (Ask 1 = **B**): no consumer driving the release needs them, every current
  use is compound, `updateState` is the working substitute, and the foundation-honesty rule
  refuses unused public surface that cannot be taken back. **Decision 2 — defer, not drop:**
  later native deltas are an epic-theme rewrite next to FIX-992, not a silent abandonment.
  **Decision 3 — map as docs:** the write-up is the deliverable, not a delivery vehicle for
  unused methods. Recorded here so no sibling reopens it: the epic's **objective is
  unchanged**; its *this-cycle scope* is narrower.
- **~~Do resources grow a committed `boolean`, or is the `Promise<boolean>` vs
  `Promise<void>` split deliberate?~~** *Resolved: deliberate — and since D-6, nothing closes
  beside it either. The split stands, and the increment/append gap next to it is documented
  rather than closed.*
  Scope state returns `boolean` because callers branch on it to suppress a redundant
  `state_change`; resources verify the no-op internally and gate `resource_change` on that,
  so the value has no caller to serve. Forcing them to match would be symmetry for its own
  sake — the opposite of this epic's thesis, which is symmetry *where it is safe* and the
  asymmetry stated once where it is not. This is that statement. Raised by review on this PR,
  decided here at epic altitude so FIX-1154 does not pick either way on its own.

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
  queue and a fork stated only on the PR dies when the PR closes.
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

