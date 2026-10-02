# FIX-1719 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

Where each change lands and what it must say. Full prose is `docs-writer`'s at implement time,
against shipped behaviour. PR 1 publishes the org-seat changes; PR 2 the new page and the epic's
shared section.

## Terms every page must get right

- **Opt-in:** a Lab gets a chief of staff by adding `org/workers/chief-of-staff/WORKER.md` and
  installing the `seat-hire` capability on the agent kind once, with `askBefore: ["fire"]` so a
  fire waits for approval. If the Lab has projects, it also lists `chief-of-staff` in the project template's `seats` (a team `CHANNEL.md` template's `members:`), so the chief of staff is in every project's room. A Lab that doesn't add it has none.
- **One admin seat:** the chief of staff is the only seat that hires or fires. Another seat that
  wants a hire sends the chief of staff a message, and it decides.
- **Id shape:** an org seat's id is its folder name, with no dot (`org/workers/chief-of-staff/`
  is `chief-of-staff`); a team seat's is `<team>.<name>`. A hire can't reuse a declared seat's id.
- **`askBefore`:** the list of changes that wait for a person's Approve in Inbox. DevTeam uses
  `["fire"]`; adding `hire` asks for hires too; omitted, nothing asks (today's behaviour). A
  listed change in an app without durable execution is refused, never made unasked. Actions that
  mount the hire blocks directly never ask.
- **Vocabulary:** "seat" and "agent kind", never "worker" as a noun (ER-13). `org/workers/` and
  `WORKER.md` are paths and stay.

## Operations

| Op | Page · anchor | What changes | PR |
|---|---|---|---|
| UPDATE | `apps/docs/docs/workforce/workers-on-disk.md` · "The tree" | `org/workers/` in the example tree; one sentence on org seats being rare and shared | 1 |
| UPDATE | same · "A worker's identity" | The id shape above | 1 |
| UPDATE | same · "What is passed over in silence" | `org/workers/<name>/` is a seat slot: no `WORKER.md` is reported; an org seat reads org-level skills, packages and references, then its own | 1 |
| UPDATE | `apps/docs/docs/workforce/documents-on-disk.md` · the address table and the references paragraph | `org/workers/build/WORKER.md` in the example tree; a reference under `org/workers/<name>/references/` belongs to that org seat | 1 |
| UPDATE | `packages/workforce/README.md` · matching rows | Mirror the two documents above; `parseDeclaredSeatId` in the loader exports | 1 |
| CREATE | `apps/docs/docs/workforce/chief-of-staff.md` · "Chief of staff" | What the seat does; adding it (the file, the capability install with `askBefore: ["fire"]`, and, in a Lab with projects, `chief-of-staff` on the project template's `seats`, or a team `CHANNEL.md` template's `members:`); other seats asking it by message; what asks first (`askBefore`); what it can't do (fire a declared seat, hire outside `allowKinds`, touch channels). Sidebar after `workforce/durable-hire` | 2 |
| UPDATE | `apps/docs/docs/workforce/durable-hire.md` · "The ready-made hire and fire handlers" | Mounted as actions they never ask; the capability's tools can, via `askBefore`, linking the new page | 2 |
| UPDATE | `packages/workforce/README.md` · `createSeatHireCapability` options | One row for `askBefore` | 2 |
| UPDATE | `apps/docs/docs/workforce/overview.md` · the epic's shared section | Publish the org-seat and channel paragraphs of [the epic's shared copy](../../epics/FIX-1650/DOCS.md), rewritten for one seat: the chief of staff is who you ask what's going on and who changes who works there; ask it for another seat and it hires one, ask it for one fewer and it puts the request in front of you to approve. No Ops. Without the clause on creating projects, which FIX-1718 publishes | 2 |

## Release notes

`@flow-state-dev/workforce`, `minor`, in each PR: PR 1 "Seats declared under `org/workers/` now
load, with their folder name as their id." PR 2 "`createSeatHireCapability` takes `askBefore`
to put named changes behind a person's approval."
