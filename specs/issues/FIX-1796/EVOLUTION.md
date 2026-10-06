# FIX-1796 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

The vocabulary's own lineage (seat, mailbox, room, flow instance, owner pin) is the epic's
([epic EVOLUTION.md](../../epics/FIX-1786/EVOLUTION.md#predecessor-designs)). These are the
predecessors this sweep touches directly.

| Prior intent and precise source | Treatment | Why / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| Never call a seat or an assignee a "worker" in a new product noun, and don't productize Kind; [FIX-1650 ER-13](../../epics/FIX-1650/BUSINESS-RULES.md#what-no-child-may-do) | **Superseded**, as the epic recorded | "Worker" is the noun and "seat" is retired (the PRD; Jake on #2810) | [BR-1](BUSINESS-RULES.md#what-is-swept), [BR-2](BUSINESS-RULES.md#what-is-swept) | None: words only |
| Channels renamed to mailboxes everywhere, every export with no alias, old files refused by name and an older store refused ("start from an empty store"); guarded by `scripts/check-mailbox-rename.mjs`. FIX-1748, `.changeset/mailboxes-everywhere.md` and that script's header | **Superseded** for the word: "mailbox" is retired. **Retained** for exports: no aliases ([D3](DECISIONS.md#d3)). **Not followed** for storage: saved strings stay ([D2](DECISIONS.md#d2)) | This epic reads old data rather than refusing it (ER-3, FIX-1788's upgrade step, FIX-1793's kept rows) | The guard becomes S10; the old one goes (S11) | Stores written today keep opening |
| Channel kinds at `workforce/flows/channels/<kind>.ts`, chosen by `CHANNEL.md`'s `flow:`; FIX-1476, as the issue's fence names it | **Retained**, untouched (ER-20) | Nothing to touch: FIX-1748 renamed those paths to mailboxes, and `CHANNEL.md` is refused by name today ([settled](DECISIONS.md#settled)) | [BR-13](BUSINESS-RULES.md#what-keeps-its-word) | What the refusal says once `MAILBOX.md` is refused too is FIX-1792's |
| A task board's "seat": a registry entry holding a worker or a dispatcher, and the hand-off record's `seat` field; `packages/orchestration/src/task-board/hand-off.ts`, `packages/core/src/types/dispatch.ts`, the task-board page's "Seats that hand off" | **Retained** | Once Workforce's seat goes, "seat" means only a place on a board; an assignee is a seat on one task ([D1](DECISIONS.md#d1), the product owner's answer) | [BR-3](BUSINESS-RULES.md#what-is-swept), [BR-17](BUSINESS-RULES.md#the-glossary) | None: nothing renamed |
| "Kind-owned params" in the worker contract's wording; FIX-1367, `packages/workforce/src/worker-config.ts` header | **Amended**, wording only, as the epic recorded | A worker's flow is a worker flow, not a kind | [BR-2](BUSINESS-RULES.md#what-is-swept) | None |

The "call a seat a seat" work (#2700, #2695, FIX-1755) and the atlas word inventory (#2708) closed
unmerged and left no design to supersede. Neither predecessor epic is wholly superseded. Before
building, compare each row with `main`; the other children change most of these files first.
