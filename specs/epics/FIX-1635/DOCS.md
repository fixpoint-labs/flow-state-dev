# FIX-1635 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

One shared story changes: which ids a caller may choose, and what choosing one gives them.
Most children change behaviour the docs already promise (a package imports, a guard refuses),
so they publish nothing new. The specifics below belong to the child that ships them.

## The shared promise · UPDATE `apps/docs/docs/server/authentication.md`

A new subsection after "Addressed routes, and what they scope by", **"Ids you choose are
addresses"**. What it has to tell a reader:

- A client may choose its own ids: a `requestId` on an action call, a session id on most
  routes. A retried call with the same `requestId` is the same request, not a second one.
- An id is never proof of ownership. Another user's `requestId` gets the caller its own
  request; another user's session id is a `404`, the same as an id that doesn't exist.
- So ids need not be unguessable to keep users apart. They leak in headers, URLs and logs,
  and nothing relies on them staying secret.

FIX-1018 writes the prose and its example routes, against the behaviour it ships, in its own
PR. This document holds the intent and who publishes what, not a second copy of the draft.

## UPDATE · `docs/architecture/state-and-scopes.md` · "What `requestId` gates, not tenant"

The section calls a request id an unguessable capability that authorizes stream attach and
resume alone. After FIX-1018 it is an address scoped to its owner, and the section says what
attach and resume check instead ([EVOLUTION.md](EVOLUTION.md)).

## Ownership

| Material | Publisher | Specific draft |
|---|---|---|
| "Ids you choose are addresses", above | FIX-1018, once its behaviour is verified | FIX-1018's PR |
| The request-id section of `state-and-scopes.md` | FIX-1018 | FIX-1018's PR |
| The session-id half of the example (session keys are unchanged, so there is no legacy-key note) | FIX-1022 | Its PR; links to FIX-1018's subsection |
| A session's flow does not authorize another flow's history | FIX-1046 | Its PR; one sentence in "Addressed routes" |
| The `external-dispatcher` row in `server/background-work.md`'s refusal table, narrowed to what a queue host still can't honour | FIX-1634 | Its `DOCS.md` |
| `writable` on collections | Shipped with FIX-1510 | None |

FIX-1021, 1328, 1431, 1334, 1286 and 1628 restore behaviour the docs already describe, so they
publish nothing. If a worker finds a page that promised the broken behaviour, it corrects that
page in the same PR. No unchanged page is copied here.
