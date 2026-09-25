# FIX-1573 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs**

## UPDATE · `docs/architecture/authentication.md` · "The route-auth subject" table, `user` row

Append to the end of the row's *Owner / resolver* cell:

> A test enforces this: every route the guard classifies as `user`, and every `/users/:userId/...`
> path, needs an entry in the engine's user-route scoping table. The table calls each route
> through the router as a caller from another organization, another tenant and, in a mixed app,
> an anonymous caller, and fails if any of them sees or changes a row. A route that is not built
> yet must answer 501; building it means replacing that pin with a real entry.

## No site or package documentation impact

Nothing an app author or API caller can observe changes: no route, status, body, option or export
in the package's public surface. `apps/docs` and `packages/engine/README.md` stay as they are, and
no changeset is needed.
