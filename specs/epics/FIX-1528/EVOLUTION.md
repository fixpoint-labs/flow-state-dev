# FIX-1528 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

Only lineage that spans more than one child. FIX-1538's own key encoding and migration belong in
its evolution record.

| Prior intent and precise source | Treatment | Reason / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| FIX-1475 D3: the durable roster row is org-scoped, and a runtime-hired seat's address carries its org. Source [`../../issues/FIX-1475/DECISIONS.md#d3`](../../issues/FIX-1475/DECISIONS.md#d3) | **Retained**, extended | #2091 kept the one org-scoped roster and added a private `~user` key and an owner pin to the row. No second store (ER-6) | FIX-1529's pin, shipped; ER-1 | Org rows are unchanged. A row with no pin is refused at register, not guessed |
| FIX-1475 BR-33: anyone listing flows sees every registered instance, other orgs' included. Source [`../../issues/FIX-1475/BUSINESS-RULES.md`](../../issues/FIX-1475/BUSINESS-RULES.md) BR-33 | **Superseded** for pinned instances | #2091 made `list_flows` omit pinned instances the caller does not match (`docs/architecture/authentication.md`, subject table) | ER-1. Unpinned flows keep BR-33 until [FIX-1486](https://linear.app/fixpoint-labs/issue/FIX-1486) | The published durable-hire limit still says the old thing. [DOCS.md](DOCS.md) removes it |
| FIX-735: a shared user-scoped resource keys at the bare user id, one cell per person across orgs. Source: header of `packages/engine/src/stores/scope-keys.ts` | **Amended** for pinned instances only (proposed) | Product decision: a private team is not portable (#2070, decision 1). The bare key is the one bucket that follows Alice from Acme to Globex | [D2](DECISIONS.md#d2), ER-4, built by FIX-1538 | Unpinned flows keep the bare key (ER-9). Existing pinned-seat data needs FIX-1538's migration (ER-5) |

Nothing is wholly superseded. FIX-1323's instance-id isolation coordinate is consumed as is: a
hired seat's instance id already carries its org, so isolated data is not part of the change.
Re-check each row against current code before implementing.
