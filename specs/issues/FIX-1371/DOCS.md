# FIX-1371 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs**

**No documentation changes.** The change moves one internal rule into one function. It adds
no export, changes no file format, and changes no message.

Four pages and the package README describe what an omitted `flow:` line does:
`apps/docs/docs/workforce/built-in-worker.md`, `channels.md`, `overview.md`,
`workers-on-disk.md`, and `packages/workforce/README.md`. Each describes behaviour this issue
keeps (BR-1, BR-6), so each stays accurate as written. None names the internal function or
the refusal sentences' source.

No changeset, for the same reason.

## Publication ownership

Nothing to publish. If review turns up a page that describes the rule inaccurately today,
that is a docs fix of its own, not part of this refactor.
