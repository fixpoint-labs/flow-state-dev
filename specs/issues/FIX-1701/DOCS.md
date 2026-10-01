# FIX-1701 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs**

## No documentation pages change

Decided: **no user doc changes.** The one user-visible change is Claude Code coming into line
with what the docs already promise, so there is nothing for a page to start or stop saying.

- **The container contract already promises it.** `docs/architecture/streaming.md` →
  "Container Ownership" and `apps/docs/docs/streaming/emitting-items.md` → "Container
  components" say every item emitted inside a container carries that container's `ownedBy`,
  and a nested container's own item carries the outer owner. After [D1](DECISIONS.md#d1),
  Claude Code's top-level items and its sub-agent boxes do exactly that. The pages were right;
  the harness was wrong.
- **The item contract** (`docs/architecture/items.md`) and the Codex and Cursor READMEs describe
  nothing that moves.
- **The Claude Code README and its guide page** (`apps/docs/docs/tools/claude-code-sdk.md`)
  were checked for a sentence saying its steps sit outside an enclosing container, or that only
  sub-agent items nest. Neither says so: the README lists what becomes an item, and the guide's
  mapping table says a sub-agent becomes a container grouping its items, which stays true. The
  implementer re-checks at S1 and corrects any such line in the same PR.
- **The release note is the changeset.** A `patch` fragment for `@flow-state-dev/claude-code`
  naming FIX-1701 ([PLAN → S6](PLAN.md#surfaces)) tells a consumer that Claude Code runs inside a
  container now show their top-level steps inside it. Codex, Cursor and core get none: nothing
  they emit changes.

The new reader is internal ([D2](DECISIONS.md#d2)): it is marked `@internal`, like the runtime
field it reads, and gets no README entry and no reference page.
