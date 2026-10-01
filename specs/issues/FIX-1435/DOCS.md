# FIX-1435 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

**No documentation impact.** This moves an internal walk between private functions of
`@flow-state-dev/workforce`, and no public API changes. Nothing is added to, renamed on, or
removed from the `./loader` or `./codegen` exports (the walk stays unexported, E3). The four
places a `resources/` folder may sit, the refs minted there, and every refusal an author can
see stay the same, word for word.

The pages that describe those places stay accurate as written:

- `apps/docs/docs/workforce/documents-on-disk.md`, for Door A's four places and refusals.
- `apps/docs/docs/workforce/capabilities-on-disk.md`, for Door B's modules beside the documents.
- `packages/workforce/README.md`, for the loader and codegen entry points.

Source file headers and doc comments are updated as part of the change (PLAN S6). They are
code documentation, not published prose. No changeset: nothing a downstream consumer needs to know
changed (BP-022).
