# LAB-162 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs**

The shared story is one: an OMP run under the harness manager can ask, park and continue. The
OMP-specific detail belongs to the two issues. The shared addition promises only what the
[kill line](SPEC.md) lets the epic claim, so it is not published until LAB-164's full-path proof
passes (ER-19, ER-20). Each issue publishes its own material with its implementation.

## UPDATE · `apps/docs/docs/orchestration/harness-manager.md` · "Asking and being answered"

Add after the opening paragraph:

> A question does not have to come from a file the prompt names. When the coding agent raises a
> question itself, partway through a run, the manager records it against that attempt and parks
> the row the same way. The attempt ends and nothing is held open while a person decides. The
> answer goes through the same surface as any other question; there is no second inbox and no
> new verb. A tool-permission prompt is not a question: it follows the allow/deny policy you
> configured on the harness and never parks the row.
>
> The next attempt reopens the saved conversation. For example, if the run worked out a fact
> before it asked, the continued run still has that fact, even though the answer prompt does not
> repeat it.

Replace "A lost session heals rather than failing" for a row continuing a parked question:

> **A parked run continues or fails; it does not start over.** When a row is continuing a session
> it parked in, the manager keeps that session owed across retries until a harness confirms it or
> the row fails. Missing or mismatched resume data fails the attempt rather than opening a fresh
> conversation. Other rows keep the self-healing behavior above. Cancelling a run stays a
> cancellation; it is never read as a park.

## CREATE · an OMP page under `apps/docs/docs/tools/` · UPDATE `apps/docs/docs/tools/coding-agents.md` · the harness table

The OMP harness: its package, options, emitted items, errors, and the tested OMP version (ER-17).
The package name and options are not decided yet. LAB-163's `DOCS.md` drafts this material.

## UPDATE · `packages/harness-manager/README.md` · "Continuing a run"

One paragraph with the parked-session rule above, linking the guide for the detail.

## Ownership

| Material | Publisher | Specific draft |
|---|---|---|
| Runtime-raised questions park and continue (first addition above) | LAB-164, after the full-path proof | This document |
| Parked-session resume rule (replacement above) and the README paragraph | LAB-163 | Its `DOCS.md`, reconciled with this one |
| OMP harness page and the coding-agents table row | LAB-163 | Its `DOCS.md` |

If the kill line fires, the first addition is not published. No page about upstream pi, an
operator console or tool approvals is in scope ([D1](DECISIONS.md#d1), ER-9 to ER-11).
