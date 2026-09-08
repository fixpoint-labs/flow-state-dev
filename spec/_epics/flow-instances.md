# Epic-spec — flow instance addressing

**In one line:** a flow instance is addressed by a global `id`; kind is the
shape; every delivery has an explicitly declared recipient instance; isolation
and durable ownership follow that instance; Devtool shows the selected copy's
own work — so a second copy is real, not a silent alias of the first.

## The 60-second version

`defineFlow` already mints instances (`id: options?.id ?? kind`). The registry
already stores them under `(kind, id)`. Dispatch does not use the id. It calls
`registry.get(kind)`, which returns the first registered instance of that kind
(`packages/engine/src/registry/flow-registry.ts`). A second instance is
reachable in memory and invisible on the wire.

That is [FIX-1315](https://linear.app/fixpoint-labs/issue/FIX-1315/dispatch-must-address-flow-instance-id-bare-kind-first-registered):
a dispatch from the non-default copy runs the default copy's config and board,
with no refusal.

Isolation has the same hole one layer down. User/org scope keys and resource
`flowIsolation` namespace on `flow.kind` only (`packages/engine/src/stores/scope-keys.ts`).
`flow.id` is unused in storage. Two collection instances that "isolate" share
the isolated bucket.

Ownership has the same hole one layer further. `SessionRecord` and
`RequestRecord` persist only `flowKind`. Adoption, re-entry, and `#1600`
child/reply/lineage treat "same flow" as "same kind." Two instances of one
kind can enter each other's sessions.

```text
  today                         after the floor
  ─────                         ───────────────
  dispatch("engineer")          dispatch("engineer-a")
       │                             │
       ▼                             ▼
  registry.get(kind)            exact id, else bare-kind rules
       │                             │
       ▼                             ▼
  first registered              the instance you named
  (FIX-1315)                    (or a loud refuse)
```

**Original this-cycle floor (Proof): [D-10](https://github.com/Fixpoint-labs/flow-state-dev/issues/1616)
(#1616).** Architect + Cycle PM agreed 2026-09-07; recorded without Jake.
Jake + Architect already locked the shape the same day. The cut: cardinality,
global id address, no first-wins, isolation on instance id, envelope carries
`flow.id` — ship with [#1600](https://github.com/fixpoint-labs/flow-state-dev/pull/1600)
/ Atlas slice 1 / FIX-1315 reshape. Architect revised-clear the same day:
direction holds; the shared contract was incomplete until themes 4–6
(ownership, migration, kind/id collision) landed here.

**Owner recipient decision (2026-09-07):** declare the target flow instance.
Chat does not shape or gate this epic: the owner wants it removed separately
in [FIX-1330](https://linear.app/fixpoint-labs/issue/FIX-1330/remove-the-framework-chat-chat-sdk-integration),
not optimized here. INST-2 owns only the minimal compatibility needed
for instance addressing. Message boards remain outside scope.

**EM delivery sequence (2026-09-07):** FIX-1321's registry/cardinality
semantic switch and FIX-1322's full consumer/owner cutover land atomically
in one shared future implementation PR, with FIX-1322 as the single
integration owner. Registry is a logical prerequisite, not a separately
merged step. FIX-1323 remains separate; safe rollout still requires the
complete floor proof, including isolation and the Devtool outcome below.

**Owner scope expansion (2026-09-07):** "I'm reading through the specs now.
BTW I think we also need to at least update Devtool. I'm not sure what other
"workplace helpers" were listed but Devtool needs to properly support viewing
different flow instances." Recorded on Linear FIX-1320 comment
`0c020ff0-433e-4a92-9e4b-68f1ef59e8c6`. Existing FIX-1324 is now the fourth
required outcome: distinguish/list same-kind instances, explicitly select one,
and inspect its own sessions and requests. This authorizes the scope addition
and its own spec/gate, not individual spec approval, implementation, or merge.

**Later, not this-cycle Proof:** only FIX-1325, Workforce hire/mint as
collection kinds (L2). Devtool no longer shares D-10's original deferral.

**Linear parent:** [FIX-1320](https://linear.app/fixpoint-labs/issue/FIX-1320).
Floor children FIX-1321..1324; later FIX-1325. Original decision of record:
[D-10](https://github.com/Fixpoint-labs/flow-state-dev/issues/1616) /
[FIX-1319](https://linear.app/fixpoint-labs/issue/FIX-1319), expanded by the owner above. This file lives on
branch `epic/flow-instances`; the PR never merges.

---

## Parts worth reviewing closely

> **1. Theme 4 — durable instance ownership.** Lookup plus isolation keys are
> not enough. Sessions and requests must persist the owning instance id and
> refuse a wrong-instance re-entry. Same-kind cross-instance child/reply/lineage
> is `#1600`'s cross-flow boundary, not "same kind, so same flow."
>
> **2. Theme 5 — migration without inventing owners.** Dual-read of a kind-only
> key cannot assign that data to a collection instance. Conductor already
> ships custom `id: boardId`; omit→singleton must not rewrite or guess that id.
>
> **3. Theme 6 — four outcomes, no lifecycle UI.** Does the Devtool view
> distinguish same-kind copies and keep inspection and existing controls on
> the selected instance? CLI proof cannot establish that UI result. Wrong
> scope either leaves operators on the wrong copy or invents admin tooling.

---

## 1. Purpose & objective *(the gated sign-off surface)*

**Objective.** Make multi-instance flows first-class and addressable, without
the bare-kind first-wins bug (FIX-1315). The public dispatch address is a
universal flow instance `id`. Kind is the shape. Isolation and durable
ownership follow the instance; Devtool makes the distinct copies inspectable.

Today you can register two instances of one kind and the runtime will still
treat them as one: dispatch picks the first, "isolated" user/org state is
keyed on kind, and sessions record only the kind, so both copies share the
bucket and can enter each other's work. When this epic's floor lands, naming
an explicitly declared instance runs that instance, a bare kind that would be
ambiguous refuses, isolated state does not leak across copies, and a session
owned by one instance refuses the other. An operator can list both copies,
select either explicitly, and inspect that instance's sessions and requests.

**Holistic necessity.** Four this-cycle issues. INST-1 (cardinality +
registry) and INST-2 (dispatch / envelope / ownership stamp) are the same lie
on two doors: if either keeps `get(kind)` first-wins, FIX-1315 is not closed.
They therefore land atomically in one implementation PR owned by FIX-1322,
while retaining separate issue acceptance, goal accountability, and spec
approval gates. A registry-only semantic switch cannot land ahead of its
live kind-addressed consumers.
**INST-3 stays on the floor.** Architect closed the Proof fork
(2026-09-07): D-10 already locked isolation-on-instance-id as Proof. A
collection kind that isolates on `kind` still shares the bucket — addressing
without isolation is a successful lookup into the wrong durable cell. Do not
cut INST-3 to later.

Declared recipients, ownership, migration, and kind/id collision complete
that same core floor. They are shared contract (themes 1, 4, 5), not extra
issues and not left for each INST spec to invent. INST-2 owns recipient addressing.
**INST-4 is now required by the owner:** correct execution alone is not enough
if Devtool hides the second copy or inspects the first copy's work. It owns
instance list/select/session/request viewing and the minimum existing
client/server read-path plumbing needed for it. Existing visible controls
must target the selected instance, not a different copy. It does not add
instance mint/create/rename/delete/admin lifecycle UX or a generic UI overhaul.
Workforce hire/mint (INST-5) remains the deferred L2 consumer.

**Proof.** INST-2 + INST-3 goal check, runnable, not an assertion: two
registered instances of one `collection` kind, each with `isolateUserState`.
Dispatch with A explicitly declared as recipient runs A, not B; changing the
declared recipient to B runs B, not A. Each copy's isolated user state is
distinct. A later state/resource read on A sees only A's writes; B
does not. A session minted under A refuses when B tries to re-enter it
(wrong-instance session refuse). A bare-kind dispatch against that pair
refuses unless some registered instance claims that exact id (theme 1).
Existing singleton flows (`id === kind`, cardinality omitted or `singleton`)
keep today's URLs and today's isolated buckets. Existing custom-id flows
(Conductor `id: boardId`) keep those ids via an explicit `collection`
declaration — the upgrade does not invent a singleton owner for them.

**Devtool Proof (INST-4), planned, not executed:** on the real Devtool UI
connected to two registered instances of one collection kind with distinct
sessions and requests, visually verify both instances are distinguishable.
Select A, inspect A's sessions and a request, switch to B and inspect B's work,
then return to A without wrong-copy lookup or stale B content. Exercise
existing visible controls affected by selection and verify their target is
that instance. Verify singleton viewing remains compatible. Capture actual
UI observations; a CLI core goal, API response, or mocked component is not
proof of the operator-facing result.

The shared INST-1 + INST-2 landing does not prove a safe partial rollout:
INST-3's isolation and migration prerequisites must be satisfied. Complete
epic rollout/wrap requires all four outcomes and both core and Devtool proofs.

**Lead measure.** The four goal-proven floor issues, named each report;
Devtool counts only with real-surface UI evidence, not the core CLI proof.

**Kill line.** If the only reason to register two instances of one kind is a
product we have decided not to build, this is a rename of `get` and the epic
should stop after INST-1 documents the refuse. That is not where we are:
Conductor already hits the first-wins bug (FIX-1315), and [#1600](https://github.com/fixpoint-labs/flow-state-dev/pull/1600)
already ships cross-flow dispatch whose address is kind-only.

**Not doing this cycle:**

- **Devtool instance lifecycle/admin UX or generic UI overhaul.** No new
  mint/create/rename/delete surface; existing controls remain correctly addressed.
- **Workforce hire helper, mint-on-bare-kind for collection kinds.** INST-5,
  later. L2 slice 2/3, not the Conductor floor.
- **A durable public `(kind, id)` address.** Jake rejected it (2026-09-07).
- **A second registry.** One registry; resolve by id.
- **Team / Channel / MessageBoard / a second Agent as L1.** Workforce
  consumes collection kinds. It does not invent new L1 nouns.
- **Chat optimization or removal.** Removal is separate future work, not a
  deprecation shipped by this epic. No chat-targeting feature, selection
  configuration, or broadcast-policy redesign; chat does not gate Proof.
- **Message-board delivery or a new fan-out mode.** Neither is in this epic.
- **An extra floor issue for recipients or ownership.** INST-2 owns addressing;
  themes 4–5 constrain INST-1..3.

**Provenance.** Shape: Jake + FSD Architect, 2026-09-07 (address, cardinality,
invent kill). Phase: [D-10](https://github.com/Fixpoint-labs/flow-state-dev/issues/1616),
Architect + Cycle PM the same day, recorded without Jake — not an owner
leftover. D-10's published objectives are Goal 1 (validate through real usage:
Conductor and Workforce multi-seat same-kind) and Goal 4 (keep the foundation
honest: no first-wins; isolation keys on instance id). Contract completion:
Architect revised-clear the same day — direction holds; themes 4–6 were the
missing shared contract.
The owner's recipient decision and subsequent instruction not to optimize
around chat are folded below. **Objective approved 2026-09-07** for the
three-issue floor (FIX-1321 / FIX-1322 / FIX-1323) at `e1d5b701`:
the owner said "I approve all 3" in-session, recorded on
[PR #1617](https://github.com/fixpoint-labs/flow-state-dev/pull/1617#issuecomment-5574969785)
and Linear FIX-1320 (comment `4a714d24-2f94-4066-af07-15a74e7355ab`).
This closes only the §1 objective gate under D-10 / FIX-1319.
It released child spec authoring and FIX-1322's pre-code route assessment;
it is **not individual spec approval or merge authorization**.
The owner subsequently added FIX-1324's Devtool outcome as the fourth
required issue (quote and durable record above), superseding only its earlier
deferral. The original objective approval stands. All four specs are published.
FIX-1321 is individually approved at `8b56dbde459a6081469bf6b9d2f9bb1f4a9f64c5`
by the [human comment](https://github.com/fixpoint-labs/flow-state-dev/pull/1631#issuecomment-5575463631);
its spec PR is closed and that approved snapshot remains frozen. FIX-1322,
FIX-1323 and FIX-1324 await individual approval. No implementation or goal proof exists.
All four specs must clear individual approval, then the owner must separately
authorize cross-spec coherence. `crossSpecCleared=false`.
EM's sequencing resolution changes no runtime contract. Neither it nor the
owner-directed scope/index folds is a review round: zero automatic rounds
spent; historic epic review counters remain unknown and are not reset.

---

## 2. Themes & long-horizon direction

> **The themes below are the cross-cutting decisions — the things that would be
> expensive to change once issues start landing. Skim the bold sentence of
> each; read the body only for the ones you want to challenge.**
>
> 1. Declared recipient and global instance id (exact-id precedence) ·
> 2. Cardinality · 3. Isolation follows the instance ·
> 4. Durable instance ownership · 5. Migration without inventing owners ·
> 6. Floor vs later · 7. Invent kill · 8. Sequencing

1. **The public address is the instance `id`. Kind is the shape. Exact
   global-id match wins; otherwise apply bare-kind rules.** Not a durable
   public `(kind, id)` pair — Jake's cut (2026-09-07): that is "two engineers
   of different kinds." FIX-1315's written desired outcome was `get(kind, id)`
   plus "bare-kind remains valid when only one instance is registered." The
   pair as a *public* address is what this epic supersedes. The registry may
   still *index* by kind internally. Callers, envelopes, and HTTP address by
   `id`. `#1600` related: a cross-flow address that names only a kind is the
   same hole on a second door.

   **Every delivery has an explicitly declared recipient instance.** Target
   declaration may be resolved at application/adapter binding; this does not
   require a new payload field or targeting API. Selecting an action handler
   is distinct from selecting its recipient. A match or an inherited
   subscription is not permission to choose the first copy or implicitly
   address every collection copy. INST-2 (FIX-1322) owns the instance-address
   contract and its minimal compatibility work; exact mechanics belong there.

   **Do not optimize around chat.** The owner intends to remove chat in
   separate work. Existing [chat architecture](../../docs/architecture/chat-transport.md#fan-out-semantics)
   intentionally broadcasts to matching subscriptions; the declared-recipient
   direction is a contract change, not a claim that today's runtime already
   selects one instance. The existing chat binding supplies the action handler,
   not an explicit recipient decision. This epic does not design a replacement
   chat model, selection configuration, or broadcast policy, and chat does not
   shape or gate its Proof. Message boards and new fan-out modes are out of scope.

   **One namespace, register and dispatch.** Duplicate global ids refuse at
   register — today's check is `(kind, id)` only, which still allows
   `engineer`/`a` and `billing`/`a` to collide once id is the public address.

   **Resolve an untagged string:**
   1. If a registered instance has that exact global `id`, that instance
      wins — even when the string is also some kind's name.
   2. Otherwise apply bare-kind rules to that string as a kind:
      - 0 instances: refuse on the floor (mint-new is INST-5, later).
      - \>1 instances: **refuse**, never first-wins (BP-030: do not keep the
        silent pick as a dual-read).
      - exactly one **singleton**: the id is the kind, so this is the id
        lookup.
      - a lone collection instance is still addressed by its minted id;
        bare kind does not pick it.

   Singleton bare-kind sugar stays — it is not a second address, and deleting
   it later would break every existing URL for no customer gain.

   **Collision example.** Kind `engineer` registers collection instances
   `engineer-a` and `engineer-b`. Kind `billing` registers collection
   instance id `engineer`.
   - Input `"engineer"` → exact-id match → the billing instance. Not a
     bare-kind refuse, even though kind `engineer` has two instances.
   - Input `"engineer-a"` → the engineer-a instance.
   - Input `"engineer"` with only `engineer-a` and `engineer-b` registered
     (no instance claims id `"engineer"`) → kind `engineer` has \>1 → refuse.

   The envelope, inbound host, and `#1600` cross-flow stamp `flowKind` today
   and resolve with `registry.get(kind)`. INST-2 makes the stamped address
   the instance id. `#1600`'s authored field may keep the name `flowKind`
   for a cycle if INST-2 dual-reads it as an id (singleton: same string); it
   may not keep first-wins. A miss is still a named refuse (`flow-not-found`
   / `no-entry`). HTTP `/:flowKind/...` is the same address slot — INST-2
   decides lookup, not a decorative rename.

2. **`defineFlow` declares `singleton | collection`.** Locked with Jake.
   Names may be bikeshed in INST-1's spec; the two cardinalities may not.
   Do not defer the enum off the floor. **Singleton:** instance `id` is
   forced equal to `kind` (already the default: `id: options?.id ?? kind`
   in `defineFlow`). Bare-kind dispatch is unambiguous because it *is* the
   id. Mint-once / get-or-create is fine. **Collection:** mint requires a
   unique **global** `id`. Dispatch primary is `id` only. Bare kind never
   means "pick an instance."

   **Omit → singleton only when ownership is already known.** BP-030:
   omit the field → `singleton` for every flow that exists today *and*
   uses the default `id === kind`. Conductor already uses custom
   `id: boardId` (`labs/conductor/src/flow.ts`). Omit→singleton must not
   rewrite that id to `kind`, must not guess a singleton owner, and must
   not invent collection. Preserve those ids via an **explicit
   `collection` declaration**. Custom `id` ≠ `kind` with cardinality
   omitted refuses at register (named: collection declaration required).

3. **Isolation follows the instance.** `resolveUserStorageKey`,
   `resolveOrgStorageKey`, and resource `flowIsolation` keys
   (`resolveResourceScopeId`) use instance `id`, not `kind`. Singletons
   keep today's buckets because `id === kind`. Session-scoped resources
   stay session-bound, as today — the instance check is which instance
   owns that session (theme 4), not a remapping of session resource keys.
   INST-3 owns the key change. Dual-read is theme 5, not "fall back to the
   kind bucket."

4. **Durable instance ownership.** An instance is an owner, not only a
   lookup key. Persist the owning instance id on sessions and requests
   (today `SessionRecord` / `RequestRecord` carry only `flowKind`). Check
   it on adoption and re-entry. A stored owner that does not match the
   instance being entered is a named refuse (wrong-instance session).
   Field name is INST-2; the persist + check is not.

   **Same-kind cross-instance is `#1600` cross-flow, not same-flow.**
   `#1600` currently means different **kinds**: child-session derivation,
   adoption (`evaluateAdoption` matches `flowKind`), reply/`id` delivery
   (`session-not-addressable` when `record.flowKind !== flow.kind`), and
   whether lineage is shared. Two instances of one kind fail that test
   today — they look like the same flow. After this floor, the owner is
   the instance id:
   - Same instance: today's child derivation, adoption, lineage inherit,
     and reply-to-session, plus the owner-id check (same id, so it
     passes).
   - Different instance ids, including two of the same kind: the same
     refusals `#1600` uses for different kinds. No shared child
     keyspace, no shared lineage, no same-session delivery. Owner
     instance id is part of expected adoption identity.

   Session resources stay session-bound. Enforce which instance owns
   that session; do not re-key session resources by instance.

5. **Migration without inventing owners.** Dual-read of records written
   under a kind-only key cannot invent an owner that was never stored.
   Blanket collection fallback to kind-owned data restores the share
   this epic kills. Copy-on-first-read duplicates the contents; it does
   not establish who owns them.

   - **Singleton legacy** where `id === kind`: the kind-only key *is*
     the instance key. Dual-read is identity. Those buckets stay.
   - **Ambiguous collection data** (old `user:<kind>` / kind-only
     session or request records, no stored owner): an explicit owner
     map (this legacy cell belongs to instance X) or a named
     `migration-required` refuse. Not a silent fallback to every
     instance of that kind.
   - **Existing custom-id flows** (Conductor `id: boardId`): theme 2.
     Preserve the id via explicit `collection`. Do not treat omit as
     singleton and guess.

   INST-3 owns isolation-key migration; INST-2 owns kind-only
   session/request records. Both obey this rule.

6. **Four required outcomes; Workforce helpers stay later.** The owner
   expanded D-10's original cut: INST-1..3 remain the Conductor / `#1600` /
   FIX-1315 core cluster; INST-4 adds correct Devtool viewing this cycle.
   Devtool consumes the same exact instance identity and durable-owner
   read paths, with kind for description/grouping, never wrong-copy selection.
   Minimal existing client/server read plumbing and correct addressing of
   existing visible controls belong to this outcome; new instance lifecycle
   or admin UX does not. The epic may wrap only when all four issues have
   merged and the full-floor core and real-Devtool UI goals are proven.
   The shared INST-1 + INST-2 PR alone is not a safe-rollout proof.
   Only INST-5 (mint + Workforce hire) remains deferred and does not gate wrap.
   Workforce, when it comes: a hireable member is a `collection` kind plus
   minted global ids; a seat binds a worker **flow id**, not a kind. No
   issue in this cycle invents that surface early.

7. **Invent kill — four things, not a mood.** No new Team / Channel /
   MessageBoard L1. No durable public `(kind, id)` address. No second
   registry. No second Agent. An issue that finds itself designing any
   of these has hit a cross-cutting question — comment up here rather
   than deciding it locally.

8. **Sequencing: INST-1 + INST-2 land atomically in one implementation PR;
   FIX-1322 is the single integration owner.** Registry/cardinality is a
   logical prerequisite for consumer addressing, not an earlier merge.
   The exact-id semantic switch cannot safely precede its live
   kind-addressed consumers: include the full consumer/owner cutover in
   the same landing. Retain separate FIX-1321 and FIX-1322 acceptance,
   goal accountability, and individual spec gates; do not dispatch
   duplicate implementation workers to land them independently.
   No alias, first-wins fallback, temporary collection ban, new child,
   or public `(kind, id)` pair bridges the sequence.

   INST-3 stays a separate issue/implementation PR. It requires the
   instance-identity and durable-owner prerequisites from the shared
   landing before its dependent paths can land. Specs may proceed in
   parallel; that is not permission to merge prerequisites separately.
   INST-4 is a separate required outcome consuming the same identity and
   durable-owner prerequisites; its spec owns the minimal Devtool changes.
   The later owner-gated cross-spec pass checks any shared read-path boundary.
   Full-floor proof includes INST-3 and INST-4 before rollout is complete.
   `#1600` can land before the shared PR — it already says FIX-1315 owns
   instance addressing, which INST-2 then reshapes. INST-5 does not start
   this cycle; the owner has pulled INST-4 only.

   ```mermaid
   flowchart TD
     A["FIX-1321 + FIX-1322: one atomic implementation PR; owner FIX-1322"]
     A --> B["FIX-1323: isolated state + attributable migration"]
     A --> C["FIX-1324: Devtool instance list/select/inspection"]
     B --> D["Complete floor: core proof + real Devtool UI proof"]
     C --> D
   ```

---

## 4. Running index

Linear parent [FIX-1320](https://linear.app/fixpoint-labs/issue/FIX-1320).
Placeholder names INST-1..6 remain the epic labels; the filed ids are below.
INST-6 (FIX-1331) was filed after the epic opened and is indexed here.

### This-cycle floor — Proof (with the #1600 cluster)

| Issue | What it delivers | Route | Spec PR | Impl PR | State |
| --- | --- | --- | --- | --- | --- |
| [FIX-1321](https://linear.app/fixpoint-labs/issue/FIX-1321) INST-1 | Cardinality on `defineFlow` + registry: `singleton` or `collection`; id rules; reject duplicate global ids; exact-id index; custom-id-without-collection refuse; no first-wins `get(kind)` | spec (Feature) | [#1631](https://github.com/fixpoint-labs/flow-state-dev/pull/1631) (closed; approved `8b56dbde`) | [#1640](https://github.com/fixpoint-labs/flow-state-dev/pull/1640) (shared with FIX-1322; integration owner FIX-1322) | Implemented inside #1640; never had its own impl PR. CI green, awaiting merge |
| [FIX-1322](https://linear.app/fixpoint-labs/issue/FIX-1322) INST-2 | Dispatch / envelope: explicitly declared recipient instance; exact-id precedence then bare-kind refuse; minimal instance-address compatibility, no chat redesign; persist owning instance id on sessions/requests; adoption/re-entry check; same-kind cross-instance = `#1600` cross-flow; carry `flow.id` (align #1600); reshape FIX-1315 | spec (Feature) | [#1633](https://github.com/fixpoint-labs/flow-state-dev/pull/1633) (closed; approved) | [#1640](https://github.com/fixpoint-labs/flow-state-dev/pull/1640) (integration owner of the atomic FIX-1321 + FIX-1322 landing; base `main`) | CI green on `6fd3bbcd`, mergeable clean, all review rounds folded. **Merges first.** Historical children re-keyed offline, no legacy-key adoption |
| [FIX-1323](https://linear.app/fixpoint-labs/issue/FIX-1323) INST-3 | Isolation: scope-keys + resource `flowIsolation` key on instance id; dual-read only where owner is known (theme 5) | spec (Feature) | [#1632](https://github.com/fixpoint-labs/flow-state-dev/pull/1632) (closed; approved) | [#1646](https://github.com/fixpoint-labs/flow-state-dev/pull/1646) (base `fix/fix-1322`) | CI green on `37f85255`, Codex cleared. **Merges second** |
| [FIX-1324](https://linear.app/fixpoint-labs/issue/FIX-1324) INST-4 | Devtool: distinguish/list same-kind instances; explicit instance selection; own sessions/request inspection; minimal read-path plumbing and correct existing-control addressing | spec (Feature) | [#1634](https://github.com/fixpoint-labs/flow-state-dev/pull/1634) (`733b0e042`; closed; approved) | [#1649](https://github.com/fixpoint-labs/flow-state-dev/pull/1649) (base `fix/fix-1323`) | CI green on `8dd0b452`, review round 1 folded across four reviewers. **Merges third.** Real UI proof run in Chromium against the shipped bundle — it caught a cross-instance stream misaddressing defect the unit suite could not see |
| [FIX-1331](https://linear.app/fixpoint-labs/issue/FIX-1331) INST-6 | Instance create-time config bag: optional `config` on `FlowInstanceOptions`, validated and frozen at mint against a definition-declared schema, read at `ctx.flow.config`. Filed after the epic opened | spec (Feature) | [#1648](https://github.com/fixpoint-labs/flow-state-dev/pull/1648) (`e1d13361`) | — | Spec converged over two review rounds; **awaiting the owner's spec-approval gate**. Blocked by FIX-1321 + FIX-1322 — not implementable until #1640 and #1646 merge |

FIX-1322's pre-code assessment promoted Bug → Feature because the work
changes the public and persisted owner contract; it therefore follows the
spec route.

**The implementation is a three-PR stack, merged in this order:**
[#1640](https://github.com/fixpoint-labs/flow-state-dev/pull/1640) (base `main`)
→ [#1646](https://github.com/fixpoint-labs/flow-state-dev/pull/1646) (base `fix/fix-1322`)
→ [#1649](https://github.com/fixpoint-labs/flow-state-dev/pull/1649) (base `fix/fix-1323`).
Each is CI-green with its review rounds folded; all three wait on the owner's
merge gate. Every spec PR closed unmerged at approval (BP-037). Two subtraction
POCs opened by review — [#1641](https://github.com/fixpoint-labs/flow-state-dev/pull/1641)
against #1640 and [#1650](https://github.com/fixpoint-labs/flow-state-dev/pull/1650)
against #1649 — had their subtractions folded into the target PR and close
unmerged once it lands.
Separate acceptance and goal accountability remain for all five issues.
FIX-1321 and FIX-1322 share only the future atomic implementation landing;
each has its own spec gate (FIX-1321 satisfied, FIX-1322 pending), followed
by the separately approved cross-spec pass before implementation.
FIX-1321's approved snapshot predates the Devtool scope expansion; its
historical deferral is superseded by this current epic and Linear FIX-1321
comment `340d9e06-f497-49a0-96fd-ea6df0d791e8`, without rewriting that snapshot.

**~~FIX-1322 row blocker~~** *Resolved before implementation:* historical
custom-ID cross-flow children are re-keyed in the offline cutover, with no
legacy-key adoption at runtime. An unattributed row under a collection kind
refuses as `migration-required` until an operator attributes it; the procedure
lives in `apps/docs/docs/persistence/overview.md`, written by #1640 and
extended in place by #1646. One procedure, one named stop condition.

**Current Linear edges (2026-09-07):** FIX-1323 is blocked by FIX-1321.
FIX-1322 is related to FIX-1321 and FIX-1323, with no hard blocked-by edge.
These recorded edges express neither a registry-first merge nor separate
implementation ownership. Theme 8 governs the atomic FIX-1321 + FIX-1322
landing and FIX-1323's required identity/owner prerequisites. The issue
relations and logical prerequisites do not turn one issue's pending spec
approval into another's gate.

### Later — not this-cycle Proof

| Issue | What it delivers | Route | Spec PR | Impl PR | State |
| --- | --- | --- | --- | --- | --- |
| [FIX-1325](https://linear.app/fixpoint-labs/issue/FIX-1325) INST-5 | Mint-on-bare-kind for collection kinds + Workforce hire helper | spec | — | — | Later (L2 slice 2/3) |

FIX-1315 is reshaped by INST-2, not implemented as written.
`#1600` is related, not owned. FIX-1330 remains separate chat-removal backlog,
not a child or blocker. Decision of record:
[D-10](https://github.com/Fixpoint-labs/flow-state-dev/issues/1616). Adjacent:
[D-8](https://github.com/Fixpoint-labs/flow-state-dev/issues/1530) (cross-flow
this cycle), [D-9](https://github.com/Fixpoint-labs/flow-state-dev/issues/1562),
[D-4](https://github.com/Fixpoint-labs/flow-state-dev/issues/1436).

---

## 5. Open cross-cutting questions

- **~~Is INST-3 this-cycle Proof?~~** *Resolved (Architect, 2026-09-07):*
  yes. Stays on the floor with INST-1/2. Do not cut.

- **~~May INST-1's registry semantic switch merge before INST-2?~~**
  *Resolved (EM sequencing, 2026-09-07):* no. Theme 8 requires one atomic
  FIX-1321 + FIX-1322 implementation PR with FIX-1322 as integration owner.
  Per-issue acceptance and spec gates stay separate; INST-3 stays on the
  floor with its prerequisites. This absorbed engineering call needs no
  renewed objective approval and grants no individual spec approval.

- **~~Kind / id collision precedence?~~** *Resolved here (theme 1):* exact
  global-id match wins; otherwise apply bare-kind rules. Register and
  dispatch honor the same rule.

- **~~Is INST-5 this epic or later?~~** *Resolved by [D-10](https://github.com/Fixpoint-labs/flow-state-dev/issues/1616):*
  later. Not this-cycle Proof.

- **~~Is Devtool (INST-4) this-cycle Proof?~~** *Resolved by owner expansion
  (2026-09-07):* yes. The quote above supersedes D-10's Devtool deferral,
  not the Workforce deferral. FIX-1324 has its own spec/approval gate;
  real Devtool UI verification is required proof, not claimed executed.

- **~~Must a recipient instance be declared, and should chat routing shape this epic?~~**
  *Resolved (owner, 2026-09-07), following [the inbound-chat review](https://github.com/fixpoint-labs/flow-state-dev/pull/1617#discussion_r3950802895):*
  "A flow instance must be declared (unless we are talking about a message board,
  in which case the message board must be indicated – but I dont think message
  boards are covered in this epic)". The owner then narrowed the response:
  "I actually want to remove chat. I think that implementation is creating
  friction and its not a good model for our framework anyway, so we will just
  deal with it the best we can for now (removing it is a separate task) but
  don't optimize around chat." Keep the general declared-instance contract;
  only minimal compatibility belongs to FIX-1322. No chat-targeting feature
  or chat-specific Proof gate. Message boards are excluded. Chat removal is
  separate future work, not an API deprecation delivered here.

- **`singleton | collection` as the exported names?** Raised in the owner
  lock ("name ok to bikeshed in issue specs"). Blocks nothing. INST-1
  proceeds on these two words. A rename that keeps the two cardinalities is
  not a theme change; a third cardinality is. The enum stays on the floor.

- **Does singleton bare-kind sugar stay forever?** Decided here (theme 1):
  yes. For a singleton it *is* the id.

- **Does `#1600` rename `flowKind` this cycle, or dual-read it as an id?**
  INST-2 decides the field name; theme 1 constrains the outcome (carry
  instance id, exact-id precedence, no first-wins). Theme 4 constrains
  persist + check of the owner.

---

## Epic evolution

- **2026-09-07** — drafted. Jake + Architect lock; D-10 phase split;
  INST-1..3 floor / INST-4–5 later.
- **2026-09-07** — Architect revised-clear: direction holds; fold durable
  ownership, migration-without-inventing-owners, and exact-id collision
  precedence into the shared contract before INST-1..3 specs.
- **2026-09-07 — owner recipient answer, then scope clarification** — require
  an explicitly declared instance; keep only minimal instance-address
  compatibility in INST-2. Do not optimize around chat; removal is separate,
  message boards are excluded. Objective approval was still pending at that
  scope clarification.
- **2026-09-07 — owner objective approval** — "I approve all 3" approves
  the FIX-1321..1323 floor at `e1d5b701`, recorded on
  [PR #1617](https://github.com/fixpoint-labs/flow-state-dev/pull/1617#issuecomment-5574969785)
  and Linear FIX-1320. Individual spec approvals and merge authorization
  remain separate; no scoped decision changed.
- **2026-09-07 — EM delivery-sequencing resolution** — replace registry-first
  merge with one atomic FIX-1321 + FIX-1322 implementation PR owned by
  FIX-1322: exact-ID lookup cannot safely land ahead of kind-addressed
  consumers. Keep separate issue/spec/goal accountability and FIX-1323's
  prerequisite-dependent isolation delivery and full-floor proof. Objective
  and runtime contracts unchanged; zero automatic review rounds. FIX-1322's
  independent historical-child migration question remains unresolved.
- **2026-09-07 — owner adds Devtool outcome** — existing FIX-1324 joins
  FIX-1321..1323 as the fourth required outcome, with its own spec gate and
  planned real-Devtool UI proof. Only FIX-1325 remains deferred. Preserve the
  objective approval, atomic FIX-1321 + FIX-1322 plan, singleton compatibility,
  isolation floor and historical-child migration blocker. No individual
  approval or implementation authorization; zero automatic review rounds.
