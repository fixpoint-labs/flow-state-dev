# FIX-1528 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

Only lineage that spans more than one child. FIX-1538's own key encoding and migration belong in
its evolution record.

| Prior intent and precise source | Treatment | Reason / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| FIX-1475 D3: the durable roster row is org-scoped, and a runtime-hired seat's address carries its org. Source [`../../issues/FIX-1475/DECISIONS.md#d3`](../../issues/FIX-1475/DECISIONS.md#d3) | **Retained**, extended | #2091 kept the one org-scoped roster and added a private `~user` key and an owner pin to the row. No second store (ER-6) | FIX-1529's pin, shipped; ER-1 | Org rows are unchanged. A row with no pin is refused at register, not guessed |
| FIX-1475 BR-33: anyone listing flows sees every registered instance, other orgs' included. Source [`../../issues/FIX-1475/BUSINESS-RULES.md`](../../issues/FIX-1475/BUSINESS-RULES.md) BR-33 | **Superseded** for pinned instances | #2091 made `list_flows` omit pinned instances the caller does not match (`docs/architecture/authentication.md`, subject table) | ER-1. Unpinned flows keep BR-33 until [FIX-1486](https://linear.app/fixpoint-labs/issue/FIX-1486) | The published durable-hire limit still says the old thing. [DOCS.md](DOCS.md) removes it |
| FIX-735: a shared user-scoped resource keys at the bare user id, one cell per person across orgs. Source: header of `packages/engine/src/stores/scope-keys.ts` | **Amended** for pinned instances only (proposed) | Product decision: a private team is not portable (#2070, decision 1). The bare key is the one bucket that follows Alice from Acme to Globex | [D2](DECISIONS.md#d2), ER-4, built by FIX-1538 | Unpinned flows keep the bare key (ER-9). Existing pinned-seat data needs FIX-1538's upgrade copy step (ER-5) |
| This epic's ER-5 as merged in [#2103](https://github.com/fixpoint-labs/flow-state-dev/pull/2103): "a person in one org sees no change". Source [`BUSINESS-RULES.md`](BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt) ER-5 | **Amended**, narrowed | [FIX-1538 D1](../../issues/FIX-1538/DECISIONS.md#d1) (merged in [#2121](https://github.com/fixpoint-labs/flow-state-dev/pull/2121)): a seat reads none of the person's app-wide data. [D2](../../issues/FIX-1538/DECISIONS.md#d2): seat data moves only by an operator step. The [Architect review on #2121](https://github.com/fixpoint-labs/flow-state-dev/pull/2121#pullrequestreview-5298232867) found the same limit | ER-5 now promises only what D1 and D2 guarantee: a seat's seat-only resource data, after the operator's copy step; its user state and app-shared resources only if the operator can attribute them | Seats open empty until the step runs. The person's app-wide data is untouched, and seats no longer read it |

Nothing is wholly superseded. FIX-1323's instance-id isolation coordinate is consumed as is: a
hired seat's instance id already carries its org, so isolated data is not part of the change.
Re-check each row against current code before implementing.
