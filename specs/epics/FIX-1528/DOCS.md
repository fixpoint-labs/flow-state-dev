# FIX-1528 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

One page carries the shared story: `apps/docs/docs/workforce/durable-hire.md`. **Two of its
limits are already stale.** "An address is not a permission" and "Listing flows is not filtered
by organization" describe the behaviour before #2091. For a hired seat, both are now false.
The operations below replace them.

## REMOVE · `apps/docs/docs/workforce/durable-hire.md` · § Limits, "An address is not a permission" and "Listing flows is not filtered by organization"

Both paragraphs go. The replacement below covers what each one warned about.

## CREATE · `apps/docs/docs/workforce/durable-hire.md` · new section after "Firing a seat": "Who can reach a hired seat"

> ## Who can reach a hired seat
>
> A hired seat belongs to the organization that hired it, and to the person who hired it when
> it is private. The hire row records both, and the framework checks them at every door into
> the seat. It does not read them from the seat's address.
>
> Anyone outside that pair gets the answer an address this app does not serve would get:
>
> - Opening a session with the seat, or sending it an action, answers `404 Unknown flow`.
> - `GET /api/flows` leaves the seat out of the list.
> - A session opened earlier cannot be resumed from another organization.
> - A board in another organization cannot hand work to the seat. The hand-off is refused as if
>   the seat did not exist, and the task is marked errored with that reason instead of staying
>   claimed.
> - With debug endpoints switched on, the debug listing does not show another person's private
>   seat.
>
> For example, Alice hires a private `research` seat while signed in to Acme. Bob, also in Acme,
> cannot open it. Neither can Alice while signed in to Globex. If she wants a research seat
> there, she hires one in Globex, and it starts empty. If Bob hires his own, it starts empty too.
>
> **What a seat stores stays with its organization and its person.** Anything the seat saves for
> Alice while she works in Acme stays in Acme, and stays hers. Her Globex seat of the same kind
> cannot read it, and neither can Bob's Acme seat. A private seat does not move between
> organizations, and there is no setting to make it move.
>
> **The check is as strong as the principal your resolver returns.** "Who is asking" is the
> principal your [`resolvePrincipal`](../server/authentication.md) returns: a user and the
> organization they are signed in to. The framework compares that principal to the hire row, so a
> seat opens only for a principal that names its organization, and for a private seat its person
> too. Use a resolver that verifies both, and install the same one on the host that serves the
> seat as on the flow that hires it.

## Ownership

| Material | Publisher | Specific draft |
|---|---|---|
| The REMOVE and the CREATE above | FIX-1538, when the assembled goal passes | This document |
| The drain refusal where dispatch refusals are listed (`flow-not-found` now also covers a seat the board is outside) | FIX-1534 | Its PR, linking to the drain bullet above rather than restating it |
| Debug listing scoping, and whether multi-user hosts may now enable it | FIX-1535 | Its PR, in `apps/docs/docs/configuration/runtime.md` where the flag lives |
| Moving existing data into the per-organization cell, and what cannot be attributed | FIX-1538 | Its `DOCS.md` |

The new section waits for the assembled goal. Its bullets are true only when every leg holds.
The REMOVE could land earlier as a docs-only fix, because both paragraphs are already stale.
The coordinator decides whether to pull it forward. Nothing here describes user planes ([D4](DECISIONS.md#d4)).
