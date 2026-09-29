# FIX-1654 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

Two updates, no new page. The change is to a store contract, so its reader is someone writing a
request store, and that reader lives in the engine README. No page under `apps/docs` changes: the
cancel endpoint's answers keep their documented meaning (`apps/docs/docs/server/connection-resilience.md`
→ "What the endpoint returns"), and the owner's hand-off case now gets the answer that page
already promises.

## UPDATE · `packages/engine/README.md` · "Abort intent on `RequestStore` (adapter authors)"

Replace the signature block's `setFieldsIfStatus` with:

```ts
setFieldsIfStatus(
  id: string,
  fields: ConditionalRequestFields,
  allowedStatuses: readonly RequestStatus[],
  updatedAt: number,
  expectedIncarnation?: string
): Promise<ConditionalWriteResult>;
```

After the paragraph that lists the three outcomes, add:

> **`expectedIncarnation` fences the write to one request.** A request id can be reused once
> retention deletes its record, so the record at `id` when you write may not be the one the caller
> checked. When `expectedIncarnation` is given, compare it with the stored record's incarnation,
> resolved with `resolveRequestIncarnation(record)` (exported from `@flow-state-dev/engine`), and
> when they differ report the record as absent, `{ applied: false, status: undefined }`, and write
> nothing. Do the comparison inside the same atomic step as the status check.
>
> Resolve the stored side with the helper rather than reading `record.incarnation` directly.
> Records written before incarnations existed have none, and the helper gives them a stable value
> derived from `createdAt`. If your store has to state the rule in its own query language, the
> derived form is `legacy_` followed by `createdAt` in decimal, used when `incarnation` is absent
> or `null`.
>
> Don't compare `createdAt` instead. Two requests under one id can be created in the same
> millisecond, and a retry by the same owner rewrites `createdAt` on a request that is still
> running.

The existing closing line, that the conformance suite covers all of this, stays and is now true of
the fence as well.

## UPDATE · `docs/architecture/state-and-scopes.md` · "A request id names one request only while its record exists"

Replace the last sentence of the section ("Known exceptions to settle later: …") with:

> The cancel route's conditional write is fenced the same way: `setFieldsIfStatus` takes the
> incarnation the route's owner check read, and every store compares it with the stored record's,
> so a cancel never lands on a later request under the id and never misses its own request after a
> same-owner hand-off.

## Publication ownership

FIX-1654 publishes both in its implementation PR, after the conformance cases pass on all four
stores. The `engine` changeset carries the upgrade note for store authors.
