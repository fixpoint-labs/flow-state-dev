# The multitenancy model, as the engine enforces it today

A companion to the [FIX-1522 findings](README.md). It answers four questions about how users,
orgs and flows relate, and it found one real multitenancy gap. Every answer below was run
against the real `/api/flows` router under a verified principal
([`poc/security-model/`](poc/security-model/README.md), 11 legs, green on this branch, based on `d8d4c26`).
Leg ids in brackets point at that POC (M, S, F, T, U) or the owner-planes POC (C, D).

## The answers

**Many users to an org?** Yes. Every member of an org shares the org's data cell. That is
what org scope is for (M1).

**Many orgs to a user?** Yes. The framework keeps no membership list. The host's verifier
returns a `{ userId, orgId }` pair on every request, and whatever pair it returns is who the
caller is. One person can hold a session in each of several orgs (M2). Each session is
pinned to one user and one org for life, and reusing it under the other org is refused (M3).
Session listings show your user in the org you're acting for right now (M4).

**Are flow instances user- or org-specific?** Neither. There is one registry per server
process, and no entry in it records an org. The flow catalog lists every instance to every
caller (F1). Any caller can open a session on any instance and run it (F2).

**Must everyone share the same flows?** Yes. Every org is served the same set of flows. Per-org
variation exists only as separately registered instances, such as an org's hired seats, and
those are global like everything else.

## The multitenancy gap

**Data is isolated. Configuration is not.**

A run gets its **data** from the session: the session's user cell and its org cell. That path
is gated end to end, and nothing reached another org's data (S1, F3).

A run gets its **configuration** from the instance it was addressed through. For a Workforce
seat, that configuration is the org's own:
- its instructions, which become the system prompt;
- its model;
- its tools, and whatever those tools can reach.

Nothing ties an instance to the org that created it. So a globex user can open a session on
`acme.eng.lead`, run it, and the run carries acme's confidential instructions (F2, observed).
That the model and tool catalog travel the same way is read from `agent-worker-flow.ts:757–770`,
where the generator takes all three from `ctx.flow.config`. That part was not run.

How bad this is depends on what a seat's configuration can do. If the instructions are the
only secret, it's a prompt leak. If a seat's tools act on the org's systems with credentials
from its settings or the environment, another org can drive them. The data those tools read
from FSD storage stays the caller's own, but anything reached outside FSD does not.

Where it bites today: any app that verifies identity and registers per-org instances, which is
what runtime hire is for. Kitchen-sink runs its seats on the default, unverified resolver
(`apps/kitchen-sink/fsdev.config.ts:337`). There every caller is effectively in one org already,
which is the documented dev-only mode.

## The figures

![Membership: a verifier issues user and org pairs, users map to many orgs, sessions pinned to one pair](figures/07-membership.svg)

**The verifier is the membership.** Read the middle panel as "who may act for which org". The
lines are principals the host issued, not rows the framework stores.

![A matrix of scopes against who shares them](figures/08-scope-matrix.svg)

**Which data cells are shared with whom.** The two amber cells are the surprises for a
multi-org host. A user's data follows them into every org, and a tenant header separates
nothing but sessions.

![One process-wide registry, and a globex user running acme's seat](figures/09-flows-are-global.svg)

**Code and config are global, and data follows the session.** The red arrow is the gap: the
configuration comes from the instance, whoever is calling.

![A four-stage request pipeline, and four things no stage checks](figures/10-where-checks-sit.svg)

**Where each check sits.** All four gates guard the data path. None of them asks whether the
caller's org may use the instance.

![A verdict matrix of boundaries against surfaces](figures/11-tenancy-verdict.svg)

**Where tenancy holds and where it doesn't.** Read the "two orgs" row: sessions and data hold,
instances and the catalog don't.

## Decisions

**1 · An instance belongs to an org, and refuses everyone else's.** Decided and built. Today a
seat one customer hired can be run by any other customer's user, with the first customer's
prompt and tools. The fence is an owning org recorded on each hired instance, honoured at
session creation, admission and the catalog. Shared app flows stay unbound. It shipped as
[FIX-1529](https://linear.app/fixpoint-labs/issue/FIX-1529) in
fixpoint-labs/flow-state-dev#2091 (merged). See [What closes it](#what-closes-it).

**2 · The tenant header is a partition, not a security boundary.** The header is set by the
caller and only separates sessions. User and org data are shared across tenants (T1, already
documented in `state-and-scopes.md`). The recommendation, carried by approving this record: no
engine change, and the user docs say plainly that tenant is a partition and that isolation
comes from orgs. *What would change it:* a customer who uses tenants as their isolation unit.
Then tenant has to come from the verifier like org does.

## Already known, not re-run here

Two open Linear issues sit on the same boundary. I didn't re-test either:
- **[FIX-1022](https://linear.app/fixpoint-labs/issue/FIX-1022):** the session storage key
  carries no principal.
- **[FIX-1286](https://linear.app/fixpoint-labs/issue/FIX-1286):** a run workspace is keyed on
  a caller-supplied `requestId`.

The catalog leak (F1, C8) is the listing half of
[FIX-1486](https://linear.app/fixpoint-labs/issue/FIX-1486).

## What closes it

[F2-PLAN.md](F2-PLAN.md) shapes the fix that shipped as
[FIX-1529](https://linear.app/fixpoint-labs/issue/FIX-1529) (fixpoint-labs/flow-state-dev#2091,
merged): an owner pin on every hired instance, read at open-session, admission and the catalog.
