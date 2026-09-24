# FIX-1415 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

**Explore / not-ship.** This ticket composes shipped designs and one parked lock. It does not amend them in place.

## What is retained

| Design | Relationship | What this explore must not reopen |
|---|---|---|
| [FIX-1311](https://linear.app/fixpoint-labs/issue/FIX-1311) channel kind | Compose | One flow instance per kind. A room is a named session. The id is the session id |
| [FIX-1352](https://linear.app/fixpoint-labs/issue/FIX-1352) file declaration | Compose, do not extend | `CHANNEL.md` is authoring. `system:` is refused because the path decides the lane. No admin verbs on that PR's binder |
| [FIX-1405](https://linear.app/fixpoint-labs/issue/FIX-1405) inventory + [FIX-817](../FIX-817/SPEC.md) discover | Compose | A channel entry is projected only where a declaration and an inventory row both exist. [D1](DECISIONS.md#d1) widens "declaration" to include a minted room; it does not start listing inventory-only ghosts. Rows still never close ([FIX-1485](https://linear.app/fixpoint-labs/issue/FIX-1485)) |
| [FIX-1341](https://linear.app/fixpoint-labs/issue/FIX-1341) Collab park | Compose the lock, do not reopen the release | Two lanes. Declared rooms undeletable. Dynamic rooms minted by Collab. This ticket is the seat-facing tool, not the mint |
| [FIX-1388](https://linear.app/fixpoint-labs/issue/FIX-1388) Door B | Compose | Kinds install via `uses`. Seats select. Seats never install |
| [FIX-1393](https://linear.app/fixpoint-labs/issue/FIX-1393) tools fence | Compose | Catalog tools die when `tools:` is empty. Controls do not. Room admin is a catalog tool |
| [FIX-1385](https://linear.app/fixpoint-labs/issue/FIX-1385) | Compose the vocabulary | Seats do. Channels hold. No assignable-channel |
| [FIX-1442](https://linear.app/fixpoint-labs/issue/FIX-1442) org never optional | Compose | Org from the principal |

## What is a sibling, not a parent

| Design | Why it stays next door |
|---|---|
| [FIX-1480](https://linear.app/fixpoint-labs/issue/FIX-1480) seat-hire | Same Door B + `tools:` shape. Different noun. Do not merge |
| [FIX-1407](https://linear.app/fixpoint-labs/issue/FIX-1407) W4 | Related-not-child. Do not stuff channel-admin into first-cut ship |
| [FIX-1476](https://linear.app/fixpoint-labs/issue/FIX-1476) reference-app channels | File kind, boards, one draining seat. Runtime verbs stay here |
| [FIX-1410](https://linear.app/fixpoint-labs/issue/FIX-1410) DevForce on Workforce | Lab pressure. Not a special manager type, and not a teach path yet |

## What this explore does not supersede

FIX-1341's "dynamic rooms are Collab's" remains the mint. This document does not build that mint and does not move the park.

Discover's "files ∩ inventory" remains true **until** a ship ticket that ratifies D1 lands. This document is not that ticket.
