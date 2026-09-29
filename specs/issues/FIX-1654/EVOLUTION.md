# FIX-1654 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

| Prior intent and precise source | Treatment | Why / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| FIX-1021's abort fence (commit `e0a7f566b`, direct route, no retained spec): `setFieldsIfStatus(…, expectedCreatedAt)`; "a record at `id` with a different `createdAt` is a different request" | **Retained**: the fence, its place inside each store's atomic step, and a miss reported as absent. **Superseded**: `createdAt` as what it compares | [POC](poc/abort-fence-createdat/README.md): fails both ways on `main` | [D1](DECISIONS.md#d1), [PLAN S1 to S7](PLAN.md#surfaces) | Legacy records fence on `legacy_<createdAt>`, today's comparison ([BR-6](BUSINESS-RULES.md#records-from-before-incarnations)). Out-of-tree stores change signature ([BR-11](BUSINESS-RULES.md#callers-and-stores)) |
| FIX-1286 [D1](../FIX-1286/DECISIONS.md#d1) and its *Decided, not asked* on legacy records: the incarnation is the request's identity; a legacy record derives `legacy_<createdAt>` | **Retained** unchanged; this issue consumes it | — | — | — |
| `docs/architecture/state-and-scopes.md` → "A request id names one request only while its record exists": lists the abort fence as a known exception | **Amended**: the exception is removed | This issue closes it | [DOCS.md](DOCS.md) | — |
