# Out-of-Scope Knowledge Base

A persistent record of *rejected* directions — features, integrations, abstractions, alternative designs — so the reasoning isn't lost when the discussion ends, and so future triage doesn't re-litigate decisions we've already made.

This is the inverse of [`docs/contributing/best-practices.md`](../../contributing/best-practices.md): that file records the rules we *adopted*; this directory records the rules we *rejected*. Both filtered through the same quality bar.

## When to add an entry

A rejection earns an out-of-scope entry only when **all three** of these are true:

1. **Hard to reverse / re-debate.** Re-litigating it would cost meaningful time. A passing comment in standup doesn't qualify; a focused design conversation does.
2. **Surprising without context.** A future reader looking at the codebase will plausibly wonder "why didn't they just do X?" and lacking the reasoning would lead them to re-propose it.
3. **The result of a real trade-off.** There were genuine alternatives and we picked against this one for specific reasons. Not "we didn't get to it" (that's a backlog item, not out-of-scope) and not "obviously bad idea" (no one will propose it).

If any of the three is missing, skip the entry. Ephemeral reasons ("not now, we're frozen for the wave") don't belong here either — those are tracked in Linear, not in durable knowledge.

The same filter applies when an agent running `fsd:improve-codebase-architecture` proposes a refactor that the maintainer rejects. The skill routes load-bearing rejections here.

## File format

One file per **concept**, not per discussion. Multiple proposals targeting the same area get appended to the same file's "Prior proposals" list.

Filename: short kebab-case for the concept (`plugin-runtime.md`, `graphql-adapter.md`, `redis-backed-store.md`). The name should be recognisable enough that someone browsing the directory understands what was rejected without opening the file.

```markdown
# <Concept Name>

One-paragraph framing of what this is and why anyone might propose it.

## Decision

What we decided, in one sentence.

## Why this is out of scope

Substantive reasoning. Reference the specific tradeoff, the FSD-shaped
alternative we picked instead, and any locked contracts (architecture
docs, BPs) that informed the call. Where helpful, inline a small code
sketch to make the rejected shape concrete — sometimes "we don't want X"
only lands when you can see what X would have looked like.

## What we do instead

The chosen alternative (often "stay with the current shape", sometimes
a different approach that solved the same need).

## Conditions that would reopen this

The reasoning here is durable, not eternal. List the future state in
which we'd revisit — a Phase 2 capability landing, a contract being
relaxed, a third-party shape changing. This stops "out-of-scope" from
calcifying into "never".

## Prior proposals

- Linear FSD-XXX — "Add plugin runtime" (2026-03-04)
- Discussion in #design — 2026-04-12 capability brainstorm
```

### Naming guidance

- The filename names the *rejected concept*, not the proposal that triggered it. `plugin-runtime.md`, not `fsd-372-plugin-system.md`.
- If two concepts overlap enough that proposals could reasonably go to either, merge them under the broader name and note the variants.

## Workflow

### Adding an entry

Triggered when:

- An architecture review (`fsd:improve-codebase-architecture`) produces a load-bearing rejection.
- A Linear issue is closed `wontfix` with reasoning that meets the three-way filter.
- A design discussion concludes with a deliberate "no, and here's why."

Procedure:

1. Check whether an existing file already covers the concept. If yes, append to its "Prior proposals" list and update "Why" / "What we do instead" only if the reasoning has materially evolved.
2. If new, create the file with the structure above.
3. If the rejection closed a Linear issue, link the file from the close comment so anyone navigating from the issue lands here.

### Reading entries during triage

`fsd:linear-triage` and any new-issue-creation skill should scan this directory when evaluating a new request. Matching is by *concept*, not keyword — "session plugin hooks" matches `plugin-runtime.md` even though neither shares vocabulary with the other.

When a match surfaces, present it: *"This is similar to `docs/internal/out-of-scope/plugin-runtime.md` — we rejected this before because [reason]. Do you still feel the same way?"*

Outcomes:

- **Confirm rejection** — append the new Linear issue to "Prior proposals", close the issue with a link to this file.
- **Reconsider** — delete or rewrite the file. Update the conditions-that-would-reopen line so future readers see what changed. Then put the new request through normal triage.
- **Related but distinct** — proceed with normal triage; mention the related file in the issue thread for context.

### Removing an entry

When a previously rejected direction is now in scope (e.g. Phase 2 unlocks a capability that makes the rejection moot), delete the file. Don't try to reopen old Linear issues — they're historical records. The new work travels through normal triage.

## What this directory is NOT

- A graveyard of every closed bug. Bugs go to `wontfix` with a comment; they don't earn KB entries.
- A roadmap. Things we haven't gotten to yet live in Linear backlog with appropriate priority — not here.
- An ADR archive. We don't keep an active ADR flow in this repo; cross-cutting *adopted* decisions go in `docs/contributing/best-practices.md` as BPs. This directory is specifically for *rejected* directions.
- A spec rationale store. The "why we built it this way" detail belongs in the relevant `docs/architecture/<area>.md` doc and the spec document for the issue that built it.
