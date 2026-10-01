# FIX-1701 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs**

## No documentation impact

Nothing a reader of the docs can observe changes. Every item the Claude Code, Codex and Cursor
harnesses emit carries the same `taskId` and `ownedBy` as before, so the streaming pages
(`apps/docs/docs/streaming/emitting-items.md`), the item contract
(`docs/architecture/items.md`, `docs/architecture/streaming.md` → "Container Ownership") and
the three package READMEs stay accurate.

The new reader is internal ([D2](DECISIONS.md#d2)): it is marked `@internal`, like the
runtime field it reads, and gets no README entry, no reference page and no changeset.

One existing page describes behaviour that Claude Code does not meet today: the container
ownership contract says every item inside a container carries its owner, and Claude Code's
top-level items don't. That is the separate bug [D1](DECISIONS.md#d1) records. The docs are
right and stay as they are; the bug fix brings Claude Code into line with them.
