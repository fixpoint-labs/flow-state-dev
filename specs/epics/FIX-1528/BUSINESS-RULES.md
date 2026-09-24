# FIX-1528 · Rules every issue in the set obeys

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

At epic altitude, these are the rules every child's spec and implementation must satisfy.
Each names who owns it and where it is checked. The "no child may" rules restate the Architect's
invent-kills on [FIX-1528](https://linear.app/fixpoint-labs/issue/FIX-1528) as rules with
owners.

## What a team gets, and what it doesn't

| # | Rule | Owner | Checked at |
|---|---|---|---|
| ER-1 | A hired seat is listed, opened, run and resumed only by a caller inside its pin `{ orgId, userId? }`, taken from the hire row and never from the address. Org is compared first. A miss answers `404 Unknown flow` | FIX-1529 · **shipped** · consumed by all | `goals/hire-plane/keeps-a-hired-seat-with-its-owner` legs (a)–(d), (g) |
| ER-2 | A board drains only onto seats on its own plane. A drain onto another org's seat, or onto another user's private seat in the same org, is refused at the dispatch seam with the answer an unregistered seat gets, before any session exists on the seat. The row ends `errored` with the refusal, and its claim is released. The board claims before it knows the seat, and a board-side pin check before the claim is ruled out (it would be a second fence) | FIX-1534 | Its drain leg, on a real claimed task and worker pool |
| ER-3 | No read surface returns another person's private hire row. The debug listing, when enabled, reads through the same scoped handle as the normal route | FIX-1535 (debug) · FIX-1529 built the normal route | Its debug leg, with `debugEndpointsEnabled: true` |
| ER-4 | Data a hired seat stores for its owner lives in a cell keyed by (org, user). Signing into another org shows none of it, and the same kind hired there starts empty. Another person's seat of the same kind in the same org starts empty too | FIX-1538 | The assembled goal ([ER-15](#the-proof)) |
| ER-5 | A person in one org keeps what their hired seats saved, once the operator runs FIX-1538's documented copy step ([FIX-1538 D2](../../issues/FIX-1538/DECISIONS.md#d2)); until then each seat opens with an empty cell. The step copies only data that provably belonged to a seat, and names what it cannot attribute to one org instead of guessing. The original data is never moved or deleted. The rule does not cover the person's app-wide data: a seat no longer reads it, even in one org ([FIX-1538 D1](../../issues/FIX-1538/DECISIONS.md#d1)) | FIX-1538 | FIX-1538's BR-13 in CI; its BR-14 – BR-16 and BR-18 by the documented step, walked once on SQLite |

## What no child may do

| # | Rule | Because |
|---|---|---|
| ER-6 – ER-8 | Add a second hire store, or `UserWorkforce`, Hire, Role, Agent, Team or Channel as Layer 1. Mix planes at any door (assign, drain, list, catalog, open, restart, debug), including through a "helpful" global inventory, or write, impersonate or push into another person's private cell. Collapse the roster owner into the principal's org, or the reverse | One store, and the owner picks the cell. The fence holds only if no door is soft. Org is security; owner is whose seat it is |
| ER-9 – ER-10 | Re-key the person's cross-org data, or user scope for flows that are not hired seats. Teach or document user planes, ship org-owned hire cells, or make portability, bridge seats, notify, always-on seats or board assignment to user ids part of this epic's exit | [D2](DECISIONS.md#d2) and [D4](DECISIONS.md#d4): that plane's default and user planes are separate product calls |
| ER-11 | Re-parent [FIX-1486](https://linear.app/fixpoint-labs/issue/FIX-1486), [FIX-1396](https://linear.app/fixpoint-labs/issue/FIX-1396), [FIX-1503](https://linear.app/fixpoint-labs/issue/FIX-1503), [FIX-1442](https://linear.app/fixpoint-labs/issue/FIX-1442) or [FIX-1536](https://linear.app/fixpoint-labs/issue/FIX-1536), or reopen F2's acceptance | Consumed or related, not owned. This epic is not a W4 gate or a W5 child |
| ER-12 | Put a fence only in kitchen-sink or a Lab | The framework must enforce it, or a host that copies the app gets no fence |

## How the set is run

| # | Rule | Because |
|---|---|---|
| ER-13 | A fence leg counts toward the lead measure only when it runs on the real path (the HTTP router or the worker pool), is graded by who is asking, and has the owner's own successful run as its control | [D3](DECISIONS.md#d3). A test that reads the pin passes when every door 404s |
| ER-14 | Linear status is mirrored when it changes. A question that crosses issues comes to this epic, not decided locally; after merge, an amendment is a follow-up PR. FIX-1534 and FIX-1535 were authorized to implement ahead of this gate and are reviewed on their own PRs | The epic wake derives state from Linear. The retained set stays canonical |

## The proof

| # | The epic is done when | Proved by |
|---|---|---|
| ER-15 | Alice's Acme private seat, which has written a marker to its own data, is invisible and inert from Globex and from Bob in Acme: not listed, not opened, not run, not drained onto, not in the debug listing. Its marker is absent from Alice's Globex seat of the same kind (the org half of the cell) and from Bob's own Acme seat of the same kind (the user half). Alice's own Acme run still reads it | FIX-1538's goal under `goals/hire-plane/`, on the real router and worker pool |
| ER-16 | The durable-hire docs say a hired seat and its data stay with the org and person that hired it, and say nothing about user planes | FIX-1538's docs change ([DOCS.md](DOCS.md)) |
