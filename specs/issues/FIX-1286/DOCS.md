# FIX-1286 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

The epic's [DOCS.md](../../epics/FIX-1635/DOCS.md) expected FIX-1286 to publish nothing. D1
adds one readable field and sharpens what a `run` workspace belongs to, so two pages change.
The shared story, that an id a caller chooses is an address and not an ownership, is FIX-1018's
to publish; this draft links to it and does not restate it.

## UPDATE · `apps/docs/docs/fundamentals/state-operations.md` · "Identity"

Add a line to the first code block, after `ctx.request.identity`:

```ts
ctx.request.incarnation // stamped once when this request is first recorded
```

Then, after the paragraph on `ScopeIdentity`'s optional fields:

> A request id can be chosen by the caller, and once a request's record is gone (session
> retention deletes old ones) the same id can name a new request. `ctx.request.incarnation`
> tells them apart. It is a random token set once, when the request is first recorded, and a
> retry or a resume of that request reads the same value. If you key anything of your own on a
> request id, such as a scratch directory or a cache that outlives the request, key it on
> `incarnation` as well.

## UPDATE · `apps/docs/docs/tools/bash.md` · "Where the workspace lives"

Change the `run` row's *One workspace per* cell from `request` to `request (not request id)`, and
add after the paragraph on tenant segments:

> A `run` workspace belongs to one request, and its path also carries that request's
> incarnation, a token set when the request was first recorded:
> `.fsdev/workspaces/run/<tenant>/<id>/<incarnation>/`. A retry or a resume of the same request
> lands in the same directory. A later request that happens to reuse the id, whether from
> another user or from the same one after retention deleted the first request, gets a new,
> empty directory.
>
> Directories from finished requests stay on disk. Nothing reads them again, so clean them up
> on whatever schedule suits you.

## Publication ownership

FIX-1286 publishes both updates in its implementation PR, after the HTTP case passes. The
upgrade note (run directories move once) goes in the `tools` changeset, not on these pages.
