# Epic-spec — flow instance addressing

**In one line:** a flow instance is addressed by a global `id`; kind is the
shape; every delivery has an explicitly declared recipient instance; isolation
and durable ownership follow that instance — so a second copy of the same kind
is a real copy, not a silent alias of the first.

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

**This-cycle floor (Proof) is [D-10](https://github.com/Fixpoint-labs/flow-state-dev/issues/1616)
(#1616).** Architect + Cycle PM agreed 2026-09-07; recorded without Jake.
Jake + Architect already locked the shape the same day. The cut: cardinality,
global id address, no first-wins, isolation on instance id, envelope carries
`flow.id` — ship with [#1600](https://github.com/fixpoint-labs/flow-state-dev/pull/1600)
/ Atlas slice 1 / FIX-1315 reshape. Architect revised-clear the same day:
direction holds; the shared contract was incomplete until themes 4–6
(ownership, migration, kind/id collision) landed here.

**Owner recipient decision (2026-09-07):** declare the target flow instance.
Chat does not shape or gate this epic: the owner wants it removed in separate
work, not optimized here. INST-2 owns only the minimal compatibility needed
for instance addressing. Message boards remain outside scope.

**Later, not this-cycle Proof (D-10):** Devtool instance switcher; Workforce
hire/mint as collection kinds (L2, not Conductor Proof). Full epic-as-one is
cut.

**Linear parent:** [FIX-1320](https://linear.app/fixpoint-labs/issue/FIX-1320).
Floor children FIX-1321..1323; later FIX-1324 / FIX-1325. Decision of record:
[D-10](https://github.com/Fixpoint-labs/flow-state-dev/issues/1616) /
[FIX-1319](https://linear.app/fixpoint-labs/issue/FIX-1319). This file lives on
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
> **3. Theme 1 — declared recipient and exact-id precedence.** Matching an
> action handler does not select its recipient instance. Check that the
> declared id wins, including collisions, without inventing a chat-routing
> feature; otherwise another copy can receive work meant for one instance.

---

## 1. Purpose & objective *(the gated sign-off surface)*

**Objective.** Make multi-instance flows first-class and addressable, without
the bare-kind first-wins bug (FIX-1315). The public dispatch address is a
universal flow instance `id`. Kind is the shape. Isolation and durable
ownership follow the instance.

Today you can register two instances of one kind and the runtime will still
treat them as one: dispatch picks the first, "isolated" user/org state is
keyed on kind, and sessions record only the kind, so both copies share the
bucket and can enter each other's work. When this epic's floor lands, naming
an explicitly declared instance runs that instance, a bare kind that would be
ambiguous refuses, isolated state does not leak across copies, and a session
owned by one instance refuses the other.

**Holistic necessity.** Three this-cycle issues. INST-1 (cardinality +
registry) and INST-2 (dispatch / envelope / ownership stamp) are the same lie
on two doors: if either keeps `get(kind)` first-wins, FIX-1315 is not closed.
**INST-3 stays on the floor.** Architect closed the Proof fork
(2026-09-07): D-10 already locked isolation-on-instance-id as Proof. A
collection kind that isolates on `kind` still shares the bucket — addressing
without isolation is a successful lookup into the wrong durable cell. Do not
cut INST-3 to later.

Declared recipients, ownership, migration, and kind/id collision complete
that same floor. They are shared contract (themes 1, 4, 5), not a fourth issue
and not left for each INST spec to invent. INST-2 owns recipient addressing.
[D-10](https://github.com/Fixpoint-labs/flow-state-dev/issues/1616)
already cut the other inflation: **full epic-as-one (Devtool + mint in the
same ship) is not this cycle.** Devtool (INST-4) is how an operator looks at
instances, not whether dispatch is true. Workforce hire/mint (INST-5) is an
L2 consumer, not the Conductor floor. The floor unblocks both; it does not
build them.

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

**Lead measure.** The set's goal-proven floor issues, named each report.

**Kill line.** If the only reason to register two instances of one kind is a
product we have decided not to build, this is a rename of `get` and the epic
should stop after INST-1 documents the refuse. That is not where we are:
Conductor already hits the first-wins bug (FIX-1315), and [#1600](https://github.com/fixpoint-labs/flow-state-dev/pull/1600)
already ships cross-flow dispatch whose address is kind-only.

**Not doing this cycle:**

- **Devtool instance list/switch/sessions.** INST-4, later. Debug, not Proof.
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
- **A fourth floor issue for recipients or ownership.** INST-2 owns addressing;
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
around chat are folded below. **Objective approval remains pending**; these
decisions do not authorize child specs or implementation to start.

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

6. **Proof is the floor. Later issues do not gate wrap.** [D-10](https://github.com/Fixpoint-labs/flow-state-dev/issues/1616)
   cut the full epic-as-one. INST-1..3 are the Conductor / `#1600` /
   FIX-1315 cluster. INST-4 (Devtool) and INST-5 (mint + Workforce hire)
   stay in this epic's index so the direction is one place; they are
   **not** this-cycle Proof. The epic may wrap when the floor has
   merged. Workforce, when it comes: a hireable member is a `collection`
   kind plus minted global ids; a seat binds a worker **flow id**, not a
   kind. No issue in this epic invents that surface early.

7. **Invent kill — four things, not a mood.** No new Team / Channel /
   MessageBoard L1. No durable public `(kind, id)` address. No second
   registry. No second Agent. An issue that finds itself designing any
   of these has hit a cross-cutting question — comment up here rather
   than deciding it locally.

8. **Sequencing: INST-1 merges first.** INST-2 and INST-3 spec in
   parallel against the cardinality, resolve, ownership, and migration
   rules; they cannot merge first. `#1600` can land before INST-2 — it
   already says FIX-1315 owns instance addressing. INST-2 then reshapes
   that address. INST-4 and INST-5 do not start this cycle unless the
   owner pulls them.

---

## 4. Running index

Linear parent [FIX-1320](https://linear.app/fixpoint-labs/issue/FIX-1320).
Placeholder names INST-1..5 remain the epic labels; the filed ids are below.

### This-cycle floor — Proof (with the #1600 cluster)

| Issue | What it delivers | Route | Spec PR | Impl PR | State |
| --- | --- | --- | --- | --- | --- |
| [FIX-1321](https://linear.app/fixpoint-labs/issue/FIX-1321) INST-1 | Cardinality on `defineFlow` + registry: `singleton` \| `collection`; id rules; reject duplicate global ids; exact-id index; custom-id-without-collection refuse; no first-wins `get(kind)` | spec | — | — | Needs spec |
| [FIX-1322](https://linear.app/fixpoint-labs/issue/FIX-1322) INST-2 | Dispatch / envelope: explicitly declared recipient instance; exact-id precedence then bare-kind refuse; minimal instance-address compatibility, no chat redesign; persist owning instance id on sessions/requests; adoption/re-entry check; same-kind cross-instance = `#1600` cross-flow; carry `flow.id` (align #1600); reshape FIX-1315 | spec | — | — | Needs spec |
| [FIX-1323](https://linear.app/fixpoint-labs/issue/FIX-1323) INST-3 | Isolation: scope-keys + resource `flowIsolation` key on instance id; dual-read only where owner is known (theme 5) | spec | — | — | Needs spec |

### Later — not this-cycle Proof

| Issue | What it delivers | Route | Spec PR | Impl PR | State |
| --- | --- | --- | --- | --- | --- |
| [FIX-1324](https://linear.app/fixpoint-labs/issue/FIX-1324) INST-4 | Devtool: list/switch/sessions by instance id; kind as grouping | spec | — | — | Later (debug, not Proof) |
| [FIX-1325](https://linear.app/fixpoint-labs/issue/FIX-1325) INST-5 | Mint-on-bare-kind for collection kinds + Workforce hire helper | spec | — | — | Later (L2 slice 2/3) |

FIX-1315 stays related until INST-2 files; it is reshaped, not implemented as
written. `#1600` is related, not owned. Decision of record:
[D-10](https://github.com/Fixpoint-labs/flow-state-dev/issues/1616). Adjacent:
[D-8](https://github.com/Fixpoint-labs/flow-state-dev/issues/1530) (cross-flow
this cycle), [D-9](https://github.com/Fixpoint-labs/flow-state-dev/issues/1562),
[D-4](https://github.com/Fixpoint-labs/flow-state-dev/issues/1436).

---

## 5. Open cross-cutting questions

- **~~Is INST-3 this-cycle Proof?~~** *Resolved (Architect, 2026-09-07):*
  yes. Stays on the floor with INST-1/2. Do not cut.

- **~~Kind / id collision precedence?~~** *Resolved here (theme 1):* exact
  global-id match wins; otherwise apply bare-kind rules. Register and
  dispatch honor the same rule.

- **~~Is INST-5 this epic or later?~~** *Resolved by [D-10](https://github.com/Fixpoint-labs/flow-state-dev/issues/1616):*
  later. Not this-cycle Proof.

- **~~Is Devtool (INST-4) this-cycle Proof?~~** *Resolved by D-10:* no.

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
  message boards are excluded, and objective approval remains pending.
