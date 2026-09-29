# FIX-1635 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

One shared story changes: which ids a caller may choose, and what choosing one gives them.
Most children change behaviour the docs already promise (a package imports, a guard refuses),
so they publish nothing new. The specifics below belong to the child that ships them.

## UPDATE · `apps/docs/docs/server/authentication.md` · new subsection after "Addressed routes, and what they scope by"

> ### Ids you choose are addresses
>
> A client can pick its own ids. An action call may carry a `requestId`, and most routes name
> a session by id. That is useful: a retried call with the same `requestId` is recognised as
> the same request instead of starting a second one.
>
> An id is never proof of ownership. A request or a session belongs to the user and
> organization it was created under, and an id someone else created reaches nothing of yours.
> Send another user's `requestId` and you get your own request, not theirs. Send another
> user's session id and you get a `404`, the same answer as an id that doesn't exist.
>
> ```
> POST /api/flows/chat/actions/send   bob's, requestId req_1 (alice's)  -> bob's own request
> GET  /api/flows/sessions/s_alice    bob's, same tenant               -> 404
> ```
>
> So you don't need to make ids unguessable to keep users apart. Ids still leak in headers,
> URLs and logs, and nothing here relies on them staying secret.

The example routes are illustrative until FIX-1018's `DOCS.md` fixes the exact paths and
status codes against the shipped behaviour.

## Ownership

| Material | Publisher | Specific draft |
|---|---|---|
| "Ids you choose are addresses", above | FIX-1018, once its behaviour is verified | This document |
| The session-id half of the example, and legacy session keys | FIX-1022 | Its PR; links here |
| A session's flow does not authorize another flow's history | FIX-1046 | Its PR; one sentence in "Addressed routes" |
| The `external-dispatcher` row in `server/background-work.md`'s refusal table, narrowed to what a queue host still can't honour | FIX-1634 | Its `DOCS.md` |
| `writable` on collections | Shipped with FIX-1510 | None |

FIX-1021, 1328, 1431, 1334, 1286 and 1628 restore behaviour the docs already describe, so they
publish nothing. If a worker finds a page that promised the broken behaviour, it corrects that
page in the same PR. No unchanged page is copied here.
