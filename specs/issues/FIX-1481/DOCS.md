# FIX-1481 · Documentation intent

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs**

**This names what each reader must learn and leaves the sentences to the implementation PR.** It
is a deliberate departure from [`spec-template.md`](../../../docs/contributing/spec-template.md),
which asks a spec's `DOCS.md` for drafted prose — don't "fix" it back. The repo routes published
prose through `docs-writer` then `docs-editor` at implementation time, specifically so it is
written by someone who has not read the diff (CLAUDE.md → "Writing Style"). A spec that drafts the
sentences pre-empts that pass and guarantees the same page is edited twice. The two authorities
conflict; the more specific one — the one about who writes user-facing prose — wins here, and the
conflict is flagged rather than averaged.

Four destinations, no new page. Row 5 gets no prose: there is nothing to document until it exists.

## UPDATE · `apps/docs/docs/devtool/overview.md` · new subsection after "Child sessions"

**What the reader must learn:**

- The Tasks tab lists each board the session emitted, one row per task, and a row can carry a
  short note about itself.
- Three things write that note, and it is not parked-only: parking for review writes why it was
  parked, a failed attempt heading for a retry writes why it failed, and resuming replaces it or
  clears it. The row shows whichever wrote last.
- A note is not an error. Both can be on a row, and they mean different things.
- **The one surprise worth stating plainly:** a note stays until something replaces it, so a task
  that failed, retried, then parked with no reason given still shows the failure text (BR-3).
- The full task record is still one click away in the row detail, unchanged.

**Voice traps here:** the outsider rule — do not explain that this used to be JSON-only or that a
checklist prompted it. No issue or PR numbers.

## UPDATE · `apps/docs/docs/devtool/debug-vs-client-state.md` · extend the list under "What the debug endpoint returns"

**What the reader must learn:** one more bullet in the existing list — each entry now reports
whether the resource may be written, and whether a model is offered a write tool for it. Do not
restate the other bullets.

## UPDATE · `apps/docs/docs/devtool/debug-vs-client-state.md` · new section after "Aliases — when one resource has two names"

**What the reader must learn:**

- Two settings decide whether a resource can change: `writable` (may code write it) and
  `llmWritable` (is a model offered the write tool). **Both default to allowing the write**, so a
  resource declaring neither is writable — this is the sentence readers will get backwards.
- The panel marks a resource read-only when both are shut, using the same condition the resource
  manifest uses to tell an agent whether it may write, so panel and agent cannot disagree.
- Closed to the model but open to code is a real configuration and is **not** marked; both
  settings are on the row detail for a reader who needs that distinction (BR-14).
- Where a resource came from does not produce the mark. A `references/` document and a document
  held under a worker's read-only grant arrive as the same two settings and get the same mark.
- No marks anywhere means the server predates this and sends neither setting — not that
  everything is writable (BR-16).

**Voice traps here:** introduce "read-only" in terms of the two settings before using it as a
label; resist "powerful" around a debugging surface.

## UPDATE · `apps/docs/docs/workforce/documents-on-disk.md` · end of "Moving a document into `references/`"

**What the reader must learn:** one short paragraph — a `references/` document is sealed on both
doors, so the Resources panel marks it read-only, and a document held under a worker's read-only
grant gets the same mark for the same reason. Cross-link to the section above. Do not re-explain
the `references/` convention; that page already owns it.

## UPDATE · `packages/engine/README.md` · the debug surface paragraph

**What the reader must learn:** the existing paragraph gains a clause — each entry reports the
resource's `writable` and `llmWritable` settings when they are declared. Everything else in that
paragraph stands.

## Publication ownership

The overview subsection ships with PR-A; the four writability operations ship with PR-B. Both are
written by `docs-writer` and then `docs-editor` against the built panels, not against this file.
Nothing here duplicates the DevTool overview's unchanged material or the documents-on-disk page's
account of the `references/` convention.
