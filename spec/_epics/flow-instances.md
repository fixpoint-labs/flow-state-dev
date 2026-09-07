# Epic-spec — flow instance addressing

**In one line:** a flow instance is addressed by a global `id`; kind is the shape;
isolation follows the instance — so a second copy of the same kind is a real
copy, not a silent alias of the first.

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

```text
  today                         after the floor
  ─────                         ───────────────
  dispatch("engineer")          dispatch("engineer-a")
       │                             │
       ▼                             ▼
  registry.get(kind)            registry by global id
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
/ Atlas slice 1 / FIX-1315 reshape.

**Later, not this-cycle Proof (D-10):** Devtool instance switcher; Workforce
hire/mint as collection kinds (L2, not Conductor Proof). Full epic-as-one is
cut.

> **Filing note (delete once the epic issue exists).** Convention:
> `spec/_epics/<name>.md` on branch `epic/flow-instances`, never-merged epic
> PR, Linear parent with the `Epic` label. Issue IDs below are placeholders
> (`INST-1` … `INST-5`) until the Linear epic is filed. Decision of record:
> [D-10](https://github.com/Fixpoint-labs/flow-state-dev/issues/1616) /
> [FIX-1319](https://linear.app/fixpoint-labs/issue/FIX-1319).

---

## How to review this

*(Paste verbatim into the epic PR description's collapsed `<details>` block.)*

This is an **epic-spec**: the shared objective and cross-cutting decisions for a *set* of
issues. It is not an implementation plan and it is not any one issue's design.

**In scope to challenge:**

- The objective — is this body of work worth doing, and is the outcome the right one?
- **Whether the set overbuilds.** Each issue can earn its place while the whole is too much.
- A cross-cutting decision in §2 — shared surface, naming, sequencing, contracts.
- A missing issue the objective implies, or one in the set that doesn't serve it.

**Out of scope — owned by the individual issue specs:**

- Any single issue's approach, architecture, file layout, or test plan.
- Anything that touches exactly one issue. It belongs on that issue's spec PR.
- **Any POC files on this branch, entirely.**

Feedback in the second list is routed to the issue it concerns as an implementer note,
not folded in here.

---

## Parts worth reviewing closely

> **1. §1 — whether isolation is this-cycle Proof.** The floor is three issues
> because an address that lands on the right instance and then reads the other
> instance's "isolated" state is still the bug. If you think isolation can wait
> until someone actually ships a collection kind, that cuts the Proof to INST-1
> and INST-2.
>
> **2. Theme 1 — public address is the instance id, not `(kind, id)`.** This
> supersedes FIX-1315's written desired outcome (`get(kind, id)`). Jake rejected
> a durable public pair ("two engineers of different kinds"). An implementer who
> only reads FIX-1315 will rebuild the thing this epic exists to kill.
>
> **Where I'm unsure:** the HTTP path segment is still named `:flowKind`
> (`packages/engine/src/routes/router.ts`). For every flow that exists today
> `id === kind`, so the bytes on the wire do not have to change. INST-2 owns
> whether the slot is an id lookup with a legacy name, or a rename. I have not
> seen a reason to rename this cycle.

---

## 1. Purpose & objective *(the gated sign-off surface)*

**Objective.** Make multi-instance flows first-class and addressable, without
the bare-kind first-wins bug (FIX-1315). The public dispatch address is a
universal flow instance `id`. Kind is the shape. Isolation follows the
instance.

Today you can register two instances of one kind and the runtime will still
treat them as one: dispatch picks the first, and "isolated" user/org state is
keyed on kind, so both copies share it. When this epic's floor lands, naming
an instance runs that instance, a bare kind that would be ambiguous refuses,
and isolated state does not leak across copies.

**Holistic necessity.** Three this-cycle issues, and the honest question is
whether it is two. INST-1 (cardinality + registry) and INST-2 (dispatch /
envelope) are the same lie on two doors: if either keeps `get(kind)`
first-wins, FIX-1315 is not closed. INST-3 (isolation) is kept on the floor
because a collection kind that isolates on `kind` still shares the bucket —
addressing without isolation is a successful lookup into the wrong durable
cell. [D-10](https://github.com/Fixpoint-labs/flow-state-dev/issues/1616)
already cut the other inflation: **full epic-as-one (Devtool + mint in the
same ship) is not this cycle.** Devtool (INST-4) is how an operator looks at
instances, not whether dispatch is true. Workforce hire/mint (INST-5) is an
L2 consumer, not the Conductor floor. The floor unblocks both; it does not
build them.

**Proof.** INST-2 + INST-3 goal check, runnable, not an assertion: two
registered instances of one `collection` kind, each with `isolateUserState`.
Dispatch by instance id runs the named copy and each copy's isolated user
state is distinct. A bare-kind dispatch against that pair refuses. Existing
singleton flows (`id === kind`, cardinality omitted or `singleton`) keep
today's URLs and today's isolated buckets.

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

**Provenance.** Shape: Jake + FSD Architect, 2026-09-07 (address, cardinality,
invent kill). Phase: [D-10](https://github.com/Fixpoint-labs/flow-state-dev/issues/1616),
Architect + Cycle PM the same day, recorded without Jake — not an owner
leftover. D-10's published objectives are Goal 1 (validate through real usage:
Conductor and Workforce multi-seat same-kind) and Goal 4 (keep the foundation
honest: no first-wins; isolation keys on instance id).

---

## 2. Themes & long-horizon direction

> **The themes below are the cross-cutting decisions — the things that would be
> expensive to change once issues start landing. Skim the bold sentence of
> each; read the body only for the ones you want to challenge.**
>
> 1. Address is the instance id · 2. Cardinality · 3. No first-wins ·
> 4. Isolation follows the instance · 5. Envelope carries `flow.id` ·
> 6. Floor vs later · 7. Invent kill · 8. Sequencing

1. **The public address is the instance `id`. Kind is the shape.** Not a
   durable public `(kind, id)` pair — Jake's cut (2026-09-07): that is "two
   engineers of different kinds." FIX-1315's written desired outcome was
   `get(kind, id)` plus "bare-kind remains valid when only one instance is
   registered." The pair as a *public* address is what this epic supersedes.
   The registry may still *index* by kind internally. Callers, envelopes, and
   HTTP address by `id`. `#1600` related: a cross-flow address that names only
   a kind is the same hole on a second door.

2. **`defineFlow` declares `singleton | collection`.** Names may be bikeshed
   in INST-1's spec; the two cardinalities may not. **Singleton:** instance
   `id` is forced equal to `kind` (already the default: `id: options?.id ?? kind`
   in `defineFlow`). Bare-kind dispatch is unambiguous because it *is* the id.
   Mint-once / get-or-create is fine. **Collection:** mint requires a unique
   **global** `id`. Dispatch primary is `id` only. Bare kind never means "pick
   an instance." Omit the field → `singleton` (BP-030: every flow that exists
   today). Duplicate global ids refuse at register — today's check is
   `(kind, id)` only, which still allows `engineer`/`a` and `billing`/`a` to
   collide once id is the public address.

3. **Resolve by id. Kill first-wins `get(kind)`.** Bare kind + 0 instances:
   refuse on the floor (mint-new is INST-5, later). Bare kind + >1: **refuse**,
   never first-wins (BP-030: do not keep the silent pick as a dual-read). Bare
   kind + exactly one **singleton**: the id is the kind, so this is the id
   lookup. A lone collection instance is still addressed by its minted id;
   bare kind does not pick it. This sugar stays for singletons — it is not a
   second address, and deleting it later would break every existing URL for
   no customer gain.

4. **Isolation follows the instance.** `resolveUserStorageKey`,
   `resolveOrgStorageKey`, and resource `flowIsolation` keys
   (`resolveResourceScopeId`) use instance `id`, not `kind`. Singletons keep
   today's buckets because `id === kind`. Session-scoped resources stay
   session-bound, as today. INST-3 owns the key change and the dual-read of
   records written under the kind-only key (BP-030: singleton legacy keys are
   the same string; collection kinds that isolated on kind were already
   sharing, and that share is the bug).

5. **The envelope and host carry instance id.** In-process dispatch, inbound
   host, and `#1600` cross-flow all stamp `flowKind` today and resolve with
   `registry.get(kind)`. INST-2 makes the stamped address the instance id.
   `#1600`'s authored field may keep the name `flowKind` for a cycle if INST-2
   dual-reads it as an id (singleton: same string); it may not keep
   first-wins. A miss is still a named refuse (`flow-not-found` / `no-entry`).
   HTTP `/:flowKind/...` is the same address slot — INST-2 decides lookup,
   not a decorative rename.

6. **Proof is the floor. Later issues do not gate wrap.** [D-10](https://github.com/Fixpoint-labs/flow-state-dev/issues/1616)
   cut the full epic-as-one. INST-1..3 are the Conductor / `#1600` / FIX-1315
   cluster. INST-4 (Devtool) and INST-5 (mint + Workforce hire) stay in this
   epic's index so the direction is one place; they are **not** this-cycle
   Proof. The epic may wrap when the floor has merged.
   Workforce, when it comes: a standard hireable member is a `collection` kind
   plus minted global ids (YAML/factory); a custom one-off is usually a
   `singleton`; a seat binds a worker **flow id**, not a kind. No issue in
   this epic invents that surface early.

7. **Invent kill — three things, not a mood.** No new Team / Channel /
   MessageBoard L1. No durable public `(kind, id)` address. No second
   registry. No second Agent. An issue that finds itself designing any of
   these has hit a cross-cutting question — comment up here rather than
   deciding it locally.

8. **Sequencing: INST-1 merges first.** INST-2 and INST-3 spec in parallel
   against the cardinality and resolve rules; they cannot merge first.
   `#1600` can land before INST-2 — it already says FIX-1315 owns instance
   addressing. INST-2 then reshapes that address. INST-4 and INST-5 do not
   start this cycle unless the owner pulls them.

---

## 4. Running index

Issue IDs are placeholders until Linear is filed.

### This-cycle floor — Proof (with the #1600 cluster)

| Issue | What it delivers | Route | Spec PR | Impl PR | State |
| --- | --- | --- | --- | --- | --- |
| INST-1 | Cardinality on `defineFlow` + registry: `singleton` \| `collection`; id rules; reject duplicate global ids; no first-wins `get(kind)` | spec | — | — | Needs spec |
| INST-2 | Dispatch / envelope: address by id; bare-kind refuse rules; carry `flow.id` on the cross-flow path (align #1600); reshape FIX-1315 | spec | — | — | Needs spec |
| INST-3 | Isolation: scope-keys + resource `flowIsolation` key on instance id | spec | — | — | Needs spec |

### Later — not this-cycle Proof

| Issue | What it delivers | Route | Spec PR | Impl PR | State |
| --- | --- | --- | --- | --- | --- |
| INST-4 | Devtool: list/switch/sessions by instance id; kind as grouping | spec | — | — | Later (debug, not Proof) |
| INST-5 | Mint-on-bare-kind for collection kinds + Workforce hire helper | spec | — | — | Later (L2 slice 2/3) |

FIX-1315 stays related until INST-2 files; it is reshaped, not implemented as
written. `#1600` is related, not owned. Decision of record:
[D-10](https://github.com/Fixpoint-labs/flow-state-dev/issues/1616). Adjacent:
[D-8](https://github.com/Fixpoint-labs/flow-state-dev/issues/1530) (cross-flow
this cycle), [D-9](https://github.com/Fixpoint-labs/flow-state-dev/issues/1562),
[D-4](https://github.com/Fixpoint-labs/flow-state-dev/issues/1436).

---

## 5. Open cross-cutting questions

- **~~Is INST-5 this epic or later?~~** *Resolved by [D-10](https://github.com/Fixpoint-labs/flow-state-dev/issues/1616)
  (2026-09-07, Architect + Cycle PM, recorded without Jake):* later. Not
  this-cycle Proof. L2, not the Conductor floor. Stays in the Later table so
  the direction is one place.

- **~~Is Devtool (INST-4) this-cycle Proof?~~** *Resolved by D-10:* no. Debug,
  like an inline expand — not the Proof gate. Full epic-as-one is cut.

- **`singleton | collection` as the exported names?** Raised in the owner
  lock ("name ok to bikeshed in issue specs"). Blocks nothing. INST-1
  proceeds on these two words. A rename that keeps the two cardinalities is
  not a theme change; a third cardinality is.

- **Does singleton bare-kind sugar stay forever?** Decided here (theme 3):
  yes. For a singleton it *is* the id. Removing it later is a break of every
  existing `/api/flows/:flowKind/...` caller for no customer-visible gain.
  Reopen here if a partner has been told kind will stop being an address.

- **Does `#1600` rename `flowKind` this cycle, or dual-read it as an id?**
  Raised while scoping INST-2. Singleton makes the strings equal, so a rename
  is documentation. Collection makes a kind-only `#1600` stamp a refuse.
  INST-2 decides; theme 5 constrains the outcome (carry instance id, no
  first-wins), not the field name.

---

## Epic evolution

- **Epic drafted (2026-09-07)** — Jake + FSD Architect lock: address by
  global id, `singleton | collection`, isolation follows instance, invent
  kill. Phase split recorded as [D-10](https://github.com/Fixpoint-labs/flow-state-dev/issues/1616)
  the same day: Architect + Cycle PM agreed, recorded without Jake. INST-1..3
  are the this-cycle floor and Proof (with the #1600 cluster / FIX-1315
  reshape); INST-4 Devtool and INST-5 Workforce hire/mint are later, not the
  Proof gate. Full epic-as-one is cut. FIX-1315's written `get(kind, id)`
  public address is superseded by theme 1.
