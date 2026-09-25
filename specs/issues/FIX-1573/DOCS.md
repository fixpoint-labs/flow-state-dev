# FIX-1573 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs**

## UPDATE · `docs/architecture/authentication.md` · "The route-auth subject" table, `user` row

Append to the end of the row's *Owner / resolver* cell:

> A test enforces this in two stages. First, every route the guard classifies as `user`, and every
> `/users/:userId/...` path, must have an entry in the engine's user-route scoping table; a route
> without one fails the suite. Second, each entry says how to seed, call and observe its route, and
> the test runs it through the router as the owner, then as a caller from another organization,
> another tenant and, in a mixed app, an anonymous caller. The owner's call must see its row; any
> other caller seeing or changing a row fails. A route that is not built yet must answer 501;
> building it means replacing that pin with a real entry.

## No site or package documentation impact

Nothing an app author or API caller can observe changes: no route, status, body, option or export
in the package's public surface. `apps/docs` and `packages/engine/README.md` stay as they are, and
no changeset is needed.
