# Epic — Reconcile the two durable-storage primitives (symmetry, not merger)

| | |
|---|---|
| **Epic issue** | [FIX-1157](https://linear.app/fixpoint-labs/issue/FIX-1157/reconcile-the-two-durable-storage-primitives-symmetry-not-merger) (`Epic` · `Enabler`) |
| **Project** | Framework simplification & cleanup |
| **Branch / doc** | `epic/durable-storage-symmetry` · `spec/_epics/durable-storage-symmetry.md` |
| **PR** | [#1365](https://github.com/fixpoint-labs/flow-state-dev/pull/1365) — never merged, never deleted; open for the life of the epic |
| **Gate** | An approving human comment or review on the epic PR, or the owner's `epic approved` label, signs off §1 only |

Code citations are against `origin/main` at `6aa1bea`.

---

## 1. Purpose & objective *(the gated sign-off surface)*

**Objective.** FSD stores durable data two ways at session scope and above — the scope-state
bag (`ctx.session.state`) and resources (`ctx.resources.<name>`). Today a developer picks
between them by **which API happens to carry the verb they need**, not by where the data
belongs: an atomic increment or an array append means scope state, per-key versioning and
collision detection means resources. When this epic lands, that choice is about the data
again. The two primitives offer one mutation contract, and every place they genuinely
*cannot* be symmetric has its reason written down once — somewhere a reader finds it
**before** reaching for the wrong import rather than after.

**This epic does not merge the two primitives and does not delete either one.** It originally
proposed collapsing them by deprecating scope state at session/user/org. That thesis was
tested and abandoned (see *Rejected framings* in §2); the trial removal PR
[#1291](https://github.com/fixpoint-labs/flow-state-dev/pull/1291) was closed unmerged and
FIX-1153 was cancelled. The finding that killed it is now the epic's foundation: **resources
have a lifecycle and scope records do not**, so the divergence is load-bearing rather than
accidental. What changed is the conclusion drawn from the overlap — not *delete the bag*, but
*stop making callers pick a primitive by its verb list*.

**Holistic necessity — three live children, and the honest question is whether this is one
issue with two lodgers.**

- **FIX-1154** (the mutation contract) *is* the objective. Without it the epic delivers
  nothing.
- **FIX-1158** (cross-flow resource validation never runs) is the epic's own thesis pointed
  at itself: an **unintended** asymmetry, where the architecture doc already promises the two
  primitives behave the same and the code silently doesn't. **Kept** — it would be fixed
  regardless, and holding it here costs nothing, but it is the weaker membership case of the
  two defects.
- **FIX-1155** (request-scope CAS vs block-scope mutex) is an asymmetry, but **not this
  epic's asymmetry** — it sits *inside* scope state, completing FIX-492 for the one scope it
  deferred, and it would read identically if resources did not exist. It is held at Backlog
  and is **not in the active set**. Its membership is the live fork in §5.

What holds the three together is not a build order — none of them depends on another. It is
that all three write to **one document**, `docs/architecture/state-and-scopes.md`, each
correcting a different paragraph of it. That collision is invisible from any
single issue and is why these three share a parent. See §3.

**Not doing:** merging the two primitives; deleting or deprecating either one at any scope;
re-attempting the org-state removal; cross-record atomicity (FIX-854); and resource-specific
surface with no state analogue at all — content, `client`, `reactTo`, `edges`, collections.
Those are out of scope by construction, not deferred.

## 2. Themes & long-horizon direction

1. **Symmetry where it is safe; the asymmetry stated once where it is not.** This is the
   objective as an operating rule, and it decides every fork in the set. Where the two
   primitives can offer the same surface without importing each other's semantics, they
   should. Where they cannot, the reason belongs in **one place** — not split across two
   module headers pointing at each other.

2. **The two CAS drivers cannot be shared, only eliminated — and this epic no longer
   proposes eliminating anything.** `stores/cas.ts` and `stores/resource-cas.ts` drive the
   same load → mutate → persist shape, but resource state has three semantics scope state
   does not: deletion, create-if-absent, and cancellation. `resource-cas.ts`'s module header
   carries an eight-row policy table naming the failure a shared driver would produce in each
   case — resurrecting a tombstoned resource, overwriting a create-if-absent winner,
   persisting after cancellation, silently dropping a deliberate write as a no-op. Every row
   traces to one root: **resources have a lifecycle, scope records do not.** A session always
   exists, so absent-vs-deleted never arises there.

   **Constrains:** FIX-1154's "shared driver seam" question resolves to *state the divergence
   once*, not *reconcile the drivers*. No issue in this set may propose unifying them.

3. **The policy table stays in `resource-cas.ts`'s module header. The gap is a missing guard
   at the point of temptation, not a misplaced table.** This theme previously settled the
   opposite — lift the eight-row table into `docs/architecture/state-and-scopes.md`. It was
   reversed on evidence, and the evidence is recorded here because a child would otherwise
   re-derive it.

   **The discoverability gain the move was meant to buy is already banked.**
   `state-and-scopes.md` does not merely mention the table; it carries the altitude-appropriate
   version of its content — the *"Six of `runWithCAS`'s decisions do not transfer"* summary, a
   five-row error-taxonomy table, and a by-name warning that `createScopeStateOps` and
   `createScopePersist` are the natural reach and the wrong one. The eight-row table is the
   *derivation* of that summary. Moving it up would put implementation-altitude detail above
   the fold in an orientation document, which is BP-039 backwards. Folded summary in the doc,
   derivation beside the code, is the correct split and it already exists.

   **The staleness rationale is void in both directions.** Four of the header's seven source
   citations are *already* wrong on `origin/main` @ `6aa1bea`: `cas.ts:96-104` cites `wait()`
   but lands on `RunWithCASOptions`' fields (`wait()` is at `:107`); `cas.ts:143-145` cites the
   no-op `committed: false` return, which is at `:155`; `cas.ts:147` cites *"the only version
   check"* and is a blank line; `cas.ts:158-159` cites the stale-cache fallback, which is near
   `:170`. The mechanism is the point — the header sits beside the driver it *governs*
   (`resource-cas.ts`) while every stale citation points at code it *contrasts with*
   (`cas.ts`), and editing `cas.ts` brings nobody near this header. The doc sentence names
   `cas.ts` as the file whose edits cause the rot and is not beside `cas.ts`. So staleness is
   placement-neutral and already paid: it argues neither for the move nor against it.

   **What the failure actually needs.** The warning is wired into three places — the
   architecture doc, `cas.ts`'s header, and `resource-cas.ts`'s own header. The fourth, where
   a developer about to make the mistake actually stands, is bare: `createScopeStateOps`
   (`state-container.ts:219`) and `createScopePersist` (`scope-persist.ts:40`) each carry **no
   doc comment at all**, while both are exported and re-exported from `stores/index.ts` and the
   package root. Someone autocompleting `patchState` off `createScopeStateOps` reads none of
   the three places the warning lives.

   **Constrains:** FIX-1154 does not move the table and does not copy it —
   `state-and-scopes.md`'s pointer sentence stays as written. It closes the gap where the gap
   is: doc comments on `createScopeStateOps` and `createScopePersist` naming the resource path
   as out of bounds and pointing at `resource-cas.ts`, which also settles their standing BP-007
   violation. While in the header it corrects the four stale citations and re-cites **symbols
   rather than line numbers**, so the next `cas.ts` edit cannot rot them. A pointer is not a
   copy; theme 1's "one place" is unaffected — one table, several pointers.

4. **Adapter delta verbs generalize to resources through `expectedVersion`, not through the
   commutative downgrade.** `DeltaStoreOps` (`stores/types.ts`) already takes
   `expectedVersion: ExpectedVersion` — `number | "any" | "absent"` — on every verb, so the
   verbs are not inherently versionless. Scope state opts out of the version check at exactly
   one line, `scope-persist.ts:60` (`commutative ? "any" : expectedVersion`), and that is safe
   for scope state only because the blob is a bag of independent keys. Resources pass **their
   held version** instead, so every row of the resource policy table survives intact:
   deletion stays terminal, a lost create-if-absent stays terminal, a no-op stays verified.

   **Constrains:** no issue in this set may reach for `"any"` on the resource path.
   `"absent"` throws on the delta verbs by contract, so create-if-absent stays a separate op —
   which is how resources already model it.

5. **No issue in this epic deprecates, removes, or migrates a primitive.** Every child fixes,
   generalizes, or documents. An issue that finds itself proposing a removal has hit the
   rejected framings below and should comment up on this PR rather than deciding locally.

6. **`docs/architecture/state-and-scopes.md` is a shared surface, and all three issues edit
   it.** FIX-1158 makes true what its cross-flow conflict table already promises; FIX-1154
   rewrites what it says about the two primitives' mutation surface — the mutator sets, the
   return contract, and which writers carry a version — while leaving the policy-table
   pointer sentence alone (theme 3); FIX-1155 (if it ramps)
   changes its statement that request scope keeps `runWithCAS`, and corrects the two
   orchestration docstrings that claim task mutations are "CAS-guarded" where block containers
   in fact take the mutex.

   **Constrains:** each issue states which paragraph it owns and edits that one. No issue
   silently rewrites a neighbour's. If two land close together, the second rebases the doc
   edit rather than resolving a conflict by preference.

7. **Sequencing: none.** The three children are independent and can be specced, built and
   merged in any order. The only collision risk is the `createScopePersist` seam — FIX-1154's
   delta-verb work and FIX-1155's rewiring touch the same region of `scope-persist.ts` — and
   it only exists if FIX-1155 ramps while FIX-1154 is in flight.

### Rejected framings (do not re-derive)

These were tested and abandoned. They are recorded here because re-deriving them is the most
expensive thing this epic has already paid for.

- **Collapse to one primitive by deprecating session/user/org state.** Killed by two findings.
  *(a)* The two CAS drivers cannot be shared — only eliminated — for the reasons in theme 2.
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

**No end-state POC was built, and the reason is the section's own test.** The thing only this
altitude can check is *what the set looks like once every issue has landed* — and here that
end state is a **contract-and-documentation shape**, not a runtime one. Nothing this set ships
changes an observable execution transcript except FIX-1155's fan-out fix, whose evidence
already exists in FIX-1155's own body (`DEFAULT_MAX_RETRIES = 3` against a default
`maxConcurrency: 4`). A throwaway end-state harness would print what the table below already
states, so the assembled surface is stated and checked by reading.

The objective is *symmetry where safe*, so the assembled end state is a claim about **which
asymmetries remain deliberate and where each one is written down.**

| Asymmetry between the two primitives | After the set lands | Where its reason lives |
|---|---|---|
| Two CAS drivers — `cas.ts` vs `resource-cas.ts` | **Survives — deliberate** (theme 2) | The eight-row policy table, staying in `resource-cas.ts`'s header; **FIX-1154** adds the missing guard on `createScopeStateOps` / `createScopePersist` (theme 3) |
| `0` means *live record* for scope state and *no live row* for resources; scope stores accept `"absent"`, `ResourceStateStore` rejects it | **Survives — deliberate**, same lifecycle root | Already in `state-and-scopes.md` → "CAS and Concurrency" |
| Resource-only surface — content, `client`, `reactTo`, `edges`, collections | **Survives — not an asymmetry.** No state analogue exists to be symmetric with | FIX-1154's scope boundaries |
| Mutator sets — 7 on scope state, 4 on resources | **Closed** by **FIX-1154** | The shared mutation contract |
| Return contract — `Promise<boolean>` vs `Promise<void>` | **Closed, or stated once** by **FIX-1154** | The shared mutation contract |
| Adapter delta verbs reachable from scope state only | **Closed** by **FIX-1154** for `incField` / `pushToArray`; `patchField` scoped out with a reason (resources already have depth-1 `patchState`) | The shared contract + the adapter conformance suite |
| Cross-flow schema validation covers state but not resources | **Closed** by **FIX-1158.** *Unintended* — the doc already promises symmetry here | `state-and-scopes.md` → the cross-flow conflict table, which the fix makes true |
| Request-scope CAS vs block-scope mutex | **Still open at wrap** unless FIX-1155 ramps — it is at Backlog and out of the active set | `state-and-scopes.md` still describes request scope as keeping `runWithCAS` |

Two things this assembled view shows that no single issue does.

**The set has no build order but converges on one file.** All three children edit
`docs/architecture/state-and-scopes.md`, each a different paragraph: FIX-1154 rewrites what it
says about the two primitives' mutation surface, FIX-1158 makes its cross-flow conflict table
true, and FIX-1155 (if it ramps) changes its request-scope CAS statement. Read alone, each
issue's doc edit looks local. Read together they are a shared surface, which is theme 6 and the
strongest reason these three sit under one parent.

**The epic can wrap with the last row still open**, and that is stated rather than discovered.
If FIX-1155 stays at Backlog, the set delivers the state-vs-resources half of the objective
and leaves an asymmetry *within* scope state standing — along with the live
`ConcurrentModificationError` under a >4-wide fan-out over a request-backed task board. That
is a real outcome to sign off or reject, not a gap. It is put as a decision in §5.

## 4. Running index

| Issue | What it delivers | Route | Spec PR | Impl PR | State |
|---|---|---|---|---|---|
| [FIX-1154](https://linear.app/fixpoint-labs/issue/FIX-1154) | One shared state-mutation contract across scope state and resources; delta verbs reachable from the resource path | spec | — | — | Todo |
| [FIX-1158](https://linear.app/fixpoint-labs/issue/FIX-1158) | Cross-flow resource schema validation reads the flat `flow.resources` map, so the check actually runs | **bug** | — | — | Todo |
| [FIX-1155](https://linear.app/fixpoint-labs/issue/FIX-1155) | Request-scope state serializes through the FIFO mutex; wide fan-out stops throwing `ConcurrentModificationError` | spec | — | — | Backlog *(not in the active set)* |
| [FIX-1153](https://linear.app/fixpoint-labs/issue/FIX-1153) | ~~Deprecate scope state at session/user/org; delete org state~~ | — | — | [#1291](https://github.com/fixpoint-labs/flow-state-dev/pull/1291) *(closed unmerged)* | **Canceled** |

*A bug carries no spec PR by design — it routes straight to implementation
([`orchestration.md`](../../docs/contributing/orchestration.md) → "Which issues get a spec").
An empty Spec PR cell on the `bug` row is correct, not a gap.*

*FIX-1153 is kept in the index rather than dropped. Its cancellation and the closed PR are the
epic's most expensive finding — see* Rejected framings *in §2 — and a reader who cannot see it
here has no way to know the framing was tried.*

## 5. Open cross-cutting questions

- **Does this epic deliver its objective with the request-scope concurrency asymmetry still
  standing?** FIX-1155 is a child but sits at Backlog and out of the active set. Raised by
  this epic-spec at authoring; blocks nothing today — the other two proceed either way — but
  it decides what "wrapped" means. Put to the owner as a decision on the epic PR (§3, last
  table row).

---

## Epic evolution

- **Epic re-founded (2026-08-20)** — the "collapse to one primitive" thesis was tested and
  abandoned; FIX-1153 cancelled and PR #1291 closed unmerged. Objective became *symmetry
  where safe, asymmetry stated once where not*, because the two CAS drivers turned out to be
  load-bearing rather than accidental: resources have a lifecycle and scope records do not.
- **Theme 3 reversed (2026-08-22)** — the epic-spec had settled on relocating the eight-row
  CAS policy table into `state-and-scopes.md`. Checking the evidence reversed it. The doc's
  pointer sentence already banks the discoverability gain, and the staleness rationale is void
  on *both* sides: four of the header's seven citations into `cas.ts` are already stale on
  `main`, because the header sits beside the driver it governs and not beside the file it
  contrasts with. What the epic actually wants to prevent — someone reaching for
  `createScopeStateOps` on the resource path — is unguarded at the one place that reader
  stands, since both trap functions are exported with no doc comment. FIX-1154 now adds that
  guard instead of moving anything. §5's open question about the citations surviving the move
  is retired with it; the citation fix became a constraint in theme 3.
- **Epic-spec drafted** — recorded the three settled cross-cutting decisions (themes 2–4) and
  the rejected framings, so no child re-derives them. Added theme 6 (`state-and-scopes.md` as
  a shared surface all three issues edit) and theme 7 (no sequencing), both of which are only
  visible at epic altitude. Surfaced FIX-1155's membership as the open decision in §5.
