# Epic — Reconcile the two durable-storage primitives (symmetry, not merger)

| | |
|---|---|
| **Epic issue** | [FIX-1157](https://linear.app/fixpoint-labs/issue/FIX-1157/reconcile-the-two-durable-storage-primitives-symmetry-not-merger) (`Epic` · `Enabler`) |
| **Project** | Framework simplification & cleanup |
| **Branch / doc** | `epic/durable-storage-symmetry` · `spec/_epics/durable-storage-symmetry.md` |
| **PR** | [#1365](https://github.com/fixpoint-labs/flow-state-dev/pull/1365) — never merged, never deleted; open for the life of the epic |
| **Gate** | An approving human comment or review on the epic PR, or the owner's `epic approved` label, signs off §1 only |
| **Status** | **Converged** — objective and themes are settled. Further feedback routes to the children as implementer notes, not into this document |

---

## 1. Purpose & objective *(the gated sign-off surface)*

**Objective.** FSD stores durable data two ways at session scope and above — the scope-state
bag (`ctx.session.state`) and resources (`ctx.resources.<name>`). Today a developer picks
between them by **which API happens to carry the verb they need**, not by where the data
belongs: an atomic increment or an array append means scope state, per-key versioning and
collision detection means resources. When this epic lands, the verb list stops driving that
choice wherever it safely can — and where a difference remains, it is recorded with its reason
rather than left for a developer to discover. The operating rule is **symmetry where it is
safe, and the asymmetry stated once where it is not**: one mutation contract wherever the two
primitives can share one without
importing each other's semantics, and where they cannot, the reason written down in a single
place a reader hits *before* reaching for the wrong import rather than after.

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

- **FIX-1154** (the mutation surface — increment and append on resources; the remaining
  differences mapped in its own spec) *is* the epic. Without it nothing here delivers.
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

Whether one substantive issue plus a lodger is an epic at all — rather than one issue and a
standalone bug — is the second live fork in §5. It is the product owner's call, not this
document's.

**Not doing:** merging the two primitives; deleting or deprecating either one at any scope;
re-attempting the org-state removal; cross-record atomicity (FIX-854); and resource-specific
surface with no state analogue at all — content, `client`, `reactTo`, `edges`, collections.
**Nor is any verb reconciled beyond increment and append.** Every other difference — a verb one
primitive lacks, or a verb they nominally share whose shape differs — is **mapped by FIX-1154,
not closed by it**. Out of scope by construction, not deferred. **No child deprecates, removes, or
migrates a primitive** — every one of them fixes, generalizes, or documents. A child that
finds itself proposing a removal has hit the rejected framings in §2 and comments up on this
PR rather than deciding locally.

## 2. Themes & long-horizon direction

Three cross-cutting decisions. A constraint that binds exactly one issue is not a theme; the
two that have nowhere else to live are recorded below the themes, and labelled as such.

1. **The two CAS drivers cannot be shared, only eliminated — and this epic eliminates
   nothing.** `stores/cas.ts` and `stores/resource-cas.ts` drive the same load → mutate →
   persist shape, but resource state has three semantics scope state does not: deletion,
   create-if-absent, and cancellation. `resource-cas.ts`'s module header carries an eight-row
   policy table naming the failure a shared driver would produce in each case — resurrecting
   a tombstoned resource, overwriting a create-if-absent winner, persisting after
   cancellation, silently dropping a deliberate write as a no-op. Every row traces to one
   root: **resources have a lifecycle, scope records do not.** A session always exists, so
   absent-vs-deleted never arises there.

   **Constrains:** FIX-1154's "shared driver seam" question resolves to *state the divergence
   once*, not *reconcile the drivers*; no issue in this set may propose unifying them. **The
   eight-row table stays in `resource-cas.ts`'s header** — the gap is a missing guard at the
   point of temptation, not a misplaced table. FIX-1154 closes it with a doc comment on
   `createScopeStateOps` (exported from `stores/index.ts` and the package root — the surface
   people actually autocomplete) and a weaker one on `createScopePersist` (internal to
   `createExecutionContext`), and re-cites the header's stale `cas.ts` references by **symbol
   rather than line number**. The evidence behind the reversal is FIX-1154's spec's to carry.

2. **Delta verbs generalize to resources through a held `expectedVersion`, never through the
   commutative downgrade.** `DeltaStoreOps` (`stores/types.ts`) already takes
   `expectedVersion: ExpectedVersion` — `number | "any" | "absent"` — on every verb, so the
   verbs are not inherently versionless. Scope state opts out of the version check at exactly
   one line, `scope-persist.ts:60` (`commutative ? "any" : expectedVersion`), and that is safe
   for scope state only because the blob is a bag of independent keys. Resources pass **their
   held version** instead.

   **Unproven — do not treat this as settled.** That *every row of the resource policy table
   survives* under a held version is a **type-level read no code has exercised**. FIX-1154
   proves it on the real resource path — a characterization test or a `settle-claim` covering
   tombstone, lost create-if-absent, and verified no-op — **before** locking it. If it fails,
   this theme changes, not just FIX-1154's design. It is the epic's most load-bearing
   technical claim and the least evidenced.

   **Constrains:** no issue in this set may reach for `"any"` on the resource path.
   `"absent"` throws on the delta verbs by contract, so create-if-absent stays a separate op
   — which is how resources already model it. **Extend the seams that exist; do not invent a
   new core `MutationContract` type until a second consumer appears.** *Tier 1* — caller-visible
   **increment and append**, `ResourceRef.incState` / `pushState` via `runResourceCAS` read-modify-write on
   the existing `set` path — is the deliverable. *Tier 2* — store-native `incField` /
   `pushToArray` on `ResourceStateStore` across every adapter plus conformance — is
   **deferred and explicitly not required for epic wrap**. If Tier 2 ever lands it must **not**
   reuse `createScopePersist` or commutative hints: that is precisely how `"any"` re-enters
   the resource path.

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

- **FIX-1155 retains store-level CAS.** It adds local serialization around the cross-context
  boundary; it does **not** switch request scope to the in-memory mutex. A resumed or
  BullMQ-reclaimed writer holds a **distinct `StateContainer`** and so does not share the FIFO
  mutex — a lock-only fix would repair same-context task-board fan-out while letting a stale
  writer overwrite newer durable request state. That cross-context concurrency is established
  in *Rejected framings* below; the earlier "serializes through the FIFO mutex" framing
  contradicted it and is corrected here and in §3 and §4.
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

## 3. Shape of the whole

**No end-state POC.** The assembled end state here is a contract-and-documentation shape, not
a runtime one, so a throwaway harness would print what the table below already states.

The objective is *symmetry where safe*, so the assembled end state is a claim about **which
asymmetries remain deliberate and where each one is written down.**

| Asymmetry between the two primitives | After the set lands | Where its reason lives |
|---|---|---|
| Two CAS drivers — `cas.ts` vs `resource-cas.ts` | **Survives — deliberate** (theme 1) | The eight-row policy table, staying in `resource-cas.ts`'s header; **FIX-1154** adds the missing guard on `createScopeStateOps` / `createScopePersist` |
| `0` means *live record* for scope state and *no live row* for resources; scope stores accept `"absent"`, `ResourceStateStore` rejects it | **Survives — deliberate**, same lifecycle root | Already in `state-and-scopes.md` → "CAS and Concurrency" |
| Resource-only surface — content, `client`, `reactTo`, `edges`, collections | **Survives — not an asymmetry.** No state analogue exists to be symmetric with | FIX-1154's scope boundaries |
| Mutation surfaces differ in several ways — verbs one primitive lacks, and differences in shape among the verbs they nominally share | **Increment and append close** (**FIX-1154**, Tier 1). The remainder is **mapped, not closed** — each difference recorded as closed, as deliberate asymmetry with a reason, or as deferred | **FIX-1154's spec.** The epic states the shape of the answer; the inventory is the child's deliverable |
| Return contract — `Promise<boolean>` vs `Promise<void>` | **Survives — deliberate.** Scope state's `boolean` exists because its `state_change` notification gate needs it; resources gate `resource_change` on an internally verified no-op. FIX-1154 closes the **increment/append** gap only | Settled at epic altitude — §5, resolved |
| Adapter delta verbs reachable from scope state only | **Tier 1 closed** by **FIX-1154** — `incState` / `pushState` on the existing resource CAS path. **Tier 2 deferred:** store-native `incField` / `pushToArray` on `ResourceStateStore` is **not required for wrap**. `patchField` and `deleteField` scoped out with a reason (resources already have depth-1 `patchState`; removing a record is a lifecycle op, not a state mutation — theme 1) | Theme 2 + the adapter conformance suite |
| Cross-flow schema validation covers state but not resources | **Closed** by **FIX-1158**, keyed by `(scope, ref, flowIsolation)`. *Unintended* — the doc already promises symmetry here | `state-and-scopes.md` → the cross-flow conflict table, which the fix makes true |
| Request-scope CAS vs block-scope mutex | **Still open at wrap** unless FIX-1155 ramps — it is at Backlog and out of the active set. If it ramps, store-level CAS is **retained** | `state-and-scopes.md` still describes request scope as keeping `runWithCAS` |

**Why the surfaces differ *in kind*.** The epic asserts the kind of divergence, not an inventory
of it. A precise mutator claim was made and narrowed twice, and each narrowing was found
incomplete by the next review round; the enumeration is therefore **FIX-1154's deliverable**, not
this document's. The kinds below are stable, and deliberately **not a complete list**.

- **Some differences are naming, not a missing mechanism.** Scope state's `atomicState` and
  `ResourceRef.updateState` run the same mechanism — re-run a mutator against state refreshed on
  every retry (`context/resource-registry.ts:797–816`). Their signatures then diverge in shape: a
  shallow-merged `Partial` versus the whole state returned, and the resource updater may be
  `async` where the scope mutator may not (`types/state.ts:47`, `types/resource.ts:272`).
  Renaming a shipped contract is out of scope (§1); classifying which of these shape differences
  matter is FIX-1154's.
- **Some differences are addressing shape.** `setStateRecord` / `deleteStateRecord` address a
  depth-2 sub-path inside one record — `state[field][key]`, hints `patchField` / `deleteField`
  (`stores/state-container.ts:336–385`) — so a writer can touch one slot of a blob many writers
  share without rewriting the rest. A resource **is** the per-key row, so the store id already
  does that addressing. **Not "no referent":** a resource whose own state nests a map still
  reaches it through `updateState`. The distinction is **addressing, not commutativity** —
  `patchState(key, literal)` is commutative too (`state-container.ts:242`), so `setStateRecord`
  is not the sole commutative verb.
- **Some cut the other way.** `getOrPatchState` is resource-only with no scope analogue, so
  "resources are behind by N verbs" is the wrong shape of summary in the first place — which is
  the reason a count was retired rather than corrected.

**The epic can wrap with the last row still open**, and that is stated rather than discovered.
If FIX-1155 stays at Backlog, the set delivers the state-vs-resources half of the objective
and leaves an asymmetry *within* scope state standing — along with the live
`ConcurrentModificationError` under a >4-wide fan-out over a request-backed task board. That
is a real outcome to sign off or reject, not a gap. It is put as a decision in §5.

## 4. Running index

| Issue | What it delivers | Route | Spec PR | Impl PR | State |
|---|---|---|---|---|---|
| [FIX-1154](https://linear.app/fixpoint-labs/issue/FIX-1154) | *Scope state and resources split one mutation surface across two APIs* — increment and append close on the resource path (`ResourceRef.incState` / `pushState`, Tier 1), and the **remaining differences are mapped in its spec**: each one closed, deliberate with a reason, or deferred | spec | — | — | Todo |
| [FIX-1158](https://linear.app/fixpoint-labs/issue/FIX-1158) | Cross-flow resource schema validation actually runs, keyed by `(scope, ref, flowIsolation)` | **bug** | — | — | Todo |
| [FIX-1207](https://linear.app/fixpoint-labs/issue/FIX-1207) | Cross-flow validation compares exact refs, so overlapping collection keyspaces slip through — the scope excluded from FIX-1158, filed separately | **bug** | — | — | Backlog *(blocked by FIX-1158; not in the active set)* |
| [FIX-1155](https://linear.app/fixpoint-labs/issue/FIX-1155) | Request-scope state adds local serialization across the cross-context boundary while **retaining store-level CAS**; wide fan-out stops throwing `ConcurrentModificationError` | spec | — | — | Backlog *(not in the active set)* |
| [FIX-1153](https://linear.app/fixpoint-labs/issue/FIX-1153) | ~~Deprecate scope state at session/user/org; delete org state~~ | — | — | [#1291](https://github.com/fixpoint-labs/flow-state-dev/pull/1291) *(closed unmerged)* | **Canceled** |

*A bug carries no spec PR by design — it routes straight to implementation
([`orchestration.md`](../../docs/contributing/orchestration.md) → "Which issues get a spec").
An empty Spec PR cell on the `bug` row is correct, not a gap.*

*FIX-1153 is kept in the index rather than dropped. Its cancellation and the closed PR are the
epic's most expensive finding — see* Rejected framings *in §2 — and a reader who cannot see it
here has no way to know the framing was tried.*

## 5. Open cross-cutting questions

- **Is one substantive issue plus a lodger an epic at all?** FIX-1154 *is* the objective;
  FIX-1158 would ship standalone. Raised independently by two reviewers on this PR, and
  correct on the reasoning — the shared-doc argument that used to answer it is withdrawn (§1).
  The alternatives are: keep the epic as one issue plus an honest lodger, or dissolve it into
  one issue and a related bug. Blocks nothing — both children proceed either way — but it
  decides whether this coordination artifact should exist. **The owner's call**, put to them
  as a decision on the epic PR.
- **Does this epic deliver its objective with the request-scope concurrency asymmetry still
  standing?** FIX-1155 is a child but sits at Backlog and out of the active set. Raised by
  this epic-spec at authoring; blocks nothing today — the other two proceed either way — but
  it decides what "wrapped" means. Put to the owner as a decision on the epic PR (§3, last
  table row).
- **~~Do resources grow a committed `boolean`, or is the `Promise<boolean>` vs
  `Promise<void>` split deliberate?~~** *Resolved: deliberate, and only the increment/append gap
  closes.*
  Scope state returns `boolean` because callers branch on it to suppress a redundant
  `state_change`; resources verify the no-op internally and gate `resource_change` on that,
  so the value has no caller to serve. Forcing them to match would be symmetry for its own
  sake — the opposite of this epic's thesis, which is symmetry *where it is safe* and the
  asymmetry stated once where it is not. This is that statement. Raised by review on this PR,
  decided here at epic altitude so FIX-1154 does not pick either way on its own.

---

## Epic evolution

- **Epic re-founded (2026-08-20)** — the "collapse to one primitive" thesis was tested and
  abandoned; FIX-1153 cancelled and PR #1291 closed unmerged. Objective became *symmetry
  where safe, asymmetry stated once where not*, because the two CAS drivers turned out to be
  load-bearing rather than accidental: resources have a lifecycle and scope records do not.
- **Theme reversed (2026-08-22)** — the epic-spec had settled on relocating the eight-row CAS
  policy table into `state-and-scopes.md`. Checking the evidence reversed it: the doc already
  banks the discoverability gain, the staleness rationale is void on both sides, and what is
  genuinely unguarded is the trap export a developer autocompletes off. FIX-1154 adds that
  guard instead of moving anything. The evidence itself now belongs to FIX-1154's spec.
- **After epic review, round 1 (2026-08-22)** — §2 compressed from seven themes to three
  (three simplify passes agreed the artifact outweighed the work it coordinates; #1249 set the
  precedent). The shared-`state-and-scopes.md` argument was **withdrawn as membership proof**
  and FIX-1158 renamed an honest lodger, because doc paragraph ownership is process coupling.
  Theme 2's "every policy row survives" was marked **unproven** and given a proof obligation
  before FIX-1154 locks it. Added the Tier 1 / Tier 2 guard against over-building a
  `MutationContract`. Settled the return-contract asymmetry at epic altitude rather than
  leaving FIX-1154 to pick. Recorded two issue-local constraints with no other home —
  FIX-1155 retains store-level CAS, FIX-1158 keys by `(scope, ref, flowIsolation)` — and
  corrected the running-index row that had promised FIX-1155 would replace CAS with the mutex.
- **After epic review, round 2 (2026-08-22)** — the **"7 vs 4 mutator gap" framing is retired**,
  because round 1 constrained FIX-1154 to Tier 1: that closes increment and append, not seven into
  four, so the count promised a parity the scoped work does not deliver. §3 was rewritten to give
  a reason per non-shared verb (`setStateRecord` / `deleteStateRecord` address a sub-path inside a
  shared blob; `atomicState` and `ResourceRef.updateState` run one mechanism under two names;
  `getOrPatchState` cuts the other way). **The claim narrowed; the work did not** — expanding
  FIX-1154 to map every verb would undo exactly the thinning round 1 folded. **Epic-spec
  converged** at two rounds; anything further routes to the children as implementer notes.
  *(The replacement claim was itself falsified — superseded by the entry below.)*
- **Parity claim withdrawn to the child spec (2026-08-22)** — an uncontested factual correction
  to an already-converged document, which is why it sits outside the two-round budget rather
  than opening a third. The mutator-parity claim was narrowed **twice** — "7 vs 4" retired for
  Tier 1 scoping, then "the only genuinely missing capability is increment and append" — and each
  narrowing was falsified by the next round, which found further shape differences among the
  verbs the two primitives nominally share (scope `patchState`'s keyed-updater overload;
  `updateState`'s async whole-state updater against `atomicState`'s synchronous partial mutator).
  The claim is now withdrawn entirely: FIX-1154 maps the mutation surface in its own spec, and
  the epic states only the *kinds* of divergence. **The reason is the lesson — the epic kept
  asserting an inventory it could not keep accurate.** An epic states the shape of an answer; a
  derivation that must be re-derived to stay true belongs to the child that owns the work.
