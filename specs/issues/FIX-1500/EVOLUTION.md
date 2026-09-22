# FIX-1500 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

Three retained predecessors, and this issue amends a part of each rather than replacing any. None
is superseded: all three shipped contracts this design composes.

| Prior intent and precise source | Treatment | Why / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| **FIX-1477 D4** — a hired roster and a channel board are ordinary in-organization data, so the panels read them directly; the axis is the resource's **scope**, and a user-scoped collection does not qualify. Source [`../FIX-1477/DECISIONS.md#d4`](../FIX-1477/DECISIONS.md#d4) | **Retained and extended** to three further collections | The rule is the product owner's and is stated in terms of `scope`, not of which collection. All three inventory collections declare `scope: "org"`, so they qualify on the rule as written — no new argument is needed, and none is made. The `expose`-not-bare corollary travels with it | [D3](DECISIONS.md#d3) | Additive. Nothing that reads these collections today changes; three more become listable by a browser, each behind an allow-list |
| **FIX-1477 `PLAN.md` → Blocked on** — the shell's session cannot be bound to a viewer's organization, so in a deployment configuring operator tokens the panels render **correct and empty**; the binding belongs to FIX-1503. Source [`../FIX-1477/PLAN.md#blocked-on`](../FIX-1477/PLAN.md#blocked-on) | **Amended in its consequence, not in its cause** | The cause is unchanged and re-verified against the current tree: there is still no viewer credential, and a session still binds to `ctx.principal?.orgId ?? DEFAULT_ORG_ID` (`packages/engine/src/routes/session-routes.ts:285`, a line that has moved since FIX-1477 cited it). What changes is what that costs: because this issue's hire resolves the organization by the same path as its reads, the two can no longer disagree, so the failure mode stops being *empty with no reason* and becomes *a different organization, named* | [D1](DECISIONS.md#d1), [PLAN.md → Blocked on](PLAN.md#blocked-on), BR-4 | The limit narrows; nothing that relied on the old behaviour breaks. FIX-1503 still removes it entirely |
| **FIX-1475** — a runtime hire is stored in the hired-roster collection and read back at the next boot; the door in front of it is the **app's** to write and guard, and `workforce-admin` is a worked example rather than something the framework ships (`apps/docs/docs/workforce/durable-hire.md`) | **Retained; its sequence gains one home** | The contract is untouched — same collection, same `create()`-as-duplicate-refusal, same compensating delete, same registration order. What this issue changes is that the *sequence* stops living inside one app flow's handler, so a second door composes it instead of copying it. That it is at exactly one site today, and therefore that this is a move rather than a reconciliation of drifted copies, was verified by execution ([`poc/evidence/`](poc/evidence/README.md) → C2) | [D1](DECISIONS.md#d1)'s *What this is not*, PLAN S1 | The operator flow keeps its behaviour, its credential and its fail-closed registration; its existing suite is the fence that proves so (PLAN V1) |

**Not superseded, and not a lineage claim:**
[FIX-1476](https://linear.app/fixpoint-labs/issue/FIX-1476)'s channel-kind and `CHANNEL.md`
contract, [FIX-1405](https://linear.app/fixpoint-labs/issue/FIX-1405)'s inventory and
[FIX-1367](https://linear.app/fixpoint-labs/issue/FIX-1367)'s `WorkerConfig` admission are
**dependencies this design consumes as they are**. A dependency is not a predecessor, and none of
them is amended here — FIX-1405's row schema gains a field, which is an extension of its contract
under its own BP-030 rule rather than a change to its intent.

Before implementation, compare these intents against current code and
`docs/architecture/*`: approved intent alone does not establish shipped behaviour.
