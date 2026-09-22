# FIX-1480 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

**Explore / not-ship.** This ticket composes shipped designs. It does not amend them in place.

## What is retained

| Design | Relationship | What this explore must not reopen |
|---|---|---|
| [FIX-1475](../FIX-1475/SPEC.md) durable hire | Compose | One admission door, org-scoped roster, `create()` as the duplicate refusal, fire deletes the roster row and cancels nothing. 1475 left inventory parity out of scope on purpose. [D1](DECISIONS.md#d1) is a **follow-on**, not a silent edit of that decision |
| [FIX-1405](https://linear.app/fixpoint-labs/issue/FIX-1405) inventory + [FIX-817](../FIX-817/SPEC.md) discover | Compose | A seat entry is projected only where a declaration and an inventory row both exist. D1 widens "declaration" to include a roster row; it does not start listing inventory-only ghosts |
| [FIX-1388](https://linear.app/fixpoint-labs/issue/FIX-1388) Door B | Compose | Kinds install via `uses`. Seats select. Seats never install |
| [FIX-1393](https://linear.app/fixpoint-labs/issue/FIX-1393) tools fence | Compose | Catalog tools die when `tools:` is empty. Controls do not. Hire is a catalog tool |
| [FIX-1325](https://linear.app/fixpoint-labs/issue/FIX-1325) / [FIX-1367](https://linear.app/fixpoint-labs/issue/FIX-1367) mint + WorkerConfig | Compose | Collection kinds for dotted ids. The kind's schema is the admission gate |
| [FIX-1442](https://linear.app/fixpoint-labs/issue/FIX-1442) org never optional | Compose | Org from the principal |

## What is a sibling, not a parent

| Design | Why it stays next door |
|---|---|
| [FIX-1415](https://linear.app/fixpoint-labs/issue/FIX-1415) channel-admin | Same Door B + `tools:` shape. Different noun. Do not merge |
| [FIX-1465](https://linear.app/fixpoint-labs/issue/FIX-1465) flow/block graphs | Kind invention. Owner lock: path 1 is this ticket; graphs are later |
| [FIX-1407](https://linear.app/fixpoint-labs/issue/FIX-1407) W4 | Related-not-child. Do not stuff seat-hire into first-cut ship |

## What this explore does not supersede

FIX-1475's "runtime hire writes no inventory row" remains true **until** a ship ticket that ratifies D1 lands. This document is not that ticket.
