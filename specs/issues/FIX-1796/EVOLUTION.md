# FIX-1796 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

The vocabulary's own lineage (seat, mailbox, room, flow instance, owner pin) is the epic's
([epic EVOLUTION.md](../../epics/FIX-1786/EVOLUTION.md#predecessor-designs)). These are the
predecessors this sweep touches directly.

| Prior intent and precise source | Treatment | Why / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| Never call a seat or an assignee a "worker" in a new product noun, and don't productize Kind; [FIX-1650 ER-13](../../epics/FIX-1650/BUSINESS-RULES.md#what-no-child-may-do) | **Superseded**, as the epic recorded | "Worker" is the noun and "seat" is retired (the PRD; Jake on #2810) | [BR-1](BUSINESS-RULES.md#what-is-swept), [BR-2](BUSINESS-RULES.md#what-is-swept) | None: words only |
| Channels renamed to mailboxes everywhere, every export with no alias, old files refused by name and an older store refused ("start from an empty store"); guarded by `scripts/check-mailbox-rename.mjs`. FIX-1748, `.changeset/mailboxes-everywhere.md` and that script's header | **Superseded** for the word: "mailbox" is retired. **Retained** for exports: no aliases ([D3](DECISIONS.md#d3)). **Retained** for storage since [epic D9](../../epics/FIX-1786/DECISIONS.md#d9): stored names change, and an older store's records are not read ([D2](DECISIONS.md#d2)). **Not followed** for refusals: nothing is refused by name (epic ER-6, ER-31) | No consumers (epic D9) | The guard becomes S10; the old one goes (S11) | The kitchen-sink app's and the DevTeam lab's stores are reset once |
| Channel kinds at `workforce/flows/channels/<kind>.ts`, chosen by `CHANNEL.md`'s `flow:`; FIX-1476, as the issue's fence names it | **Retained**, untouched (ER-20) | Nothing to touch: FIX-1748 renamed those paths to mailboxes, and `CHANNEL.md` is refused by name today ([settled](DECISIONS.md#settled)) | [BR-13](BUSINESS-RULES.md#what-keeps-its-word) | `MAILBOX.md` is not refused (epic ER-6), and today's `CHANNEL.md` refusal goes with the mailbox code: FIX-1792's |
| A task board's "seat": a registry entry holding a worker or a dispatcher, and the hand-off record's `seat` field; `packages/orchestration/src/task-board/hand-off.ts`, `packages/core/src/types/dispatch.ts`, the task-board page's "Seats that hand off" | **Retained** | Once Workforce's seat goes, "seat" means only a place on a board; an assignee is a seat on one task ([D1](DECISIONS.md#d1), the product owner's answer) | [BR-3](BUSINESS-RULES.md#what-is-swept), [BR-18](BUSINESS-RULES.md#the-glossary) | None: nothing renamed |
| "Kind-owned params" in the worker contract's wording; FIX-1367, `packages/workforce/src/worker-config.ts` header | **Amended**, wording only, as the epic recorded | A worker's flow is a worker flow, not a kind | [BR-2](BUSINESS-RULES.md#what-is-swept) | None |

The "call a seat a seat" work (#2700, #2695, FIX-1755) and the atlas word inventory (#2708) closed
unmerged and left no design to supersede. Neither predecessor epic is wholly superseded. Before
building, compare each row with `main`; the other children change most of these files first.

<a name="amendment-d9"></a>
## Amended after merge: stored names renamed outright, no upgrade page (epic D9)

**The decision.** On 2026-10-07 the product owner wrote: "No consumers yet. No need for
backwards support of any kind." The epic records it as [epic D9](../../epics/FIX-1786/DECISIONS.md#d9) and
[ER-31](../../epics/FIX-1786/BUSINESS-RULES.md#what-no-child-may-do). The same day the product owner answered:
yes, the kitchen-sink app's and the DevTeam lab's stores are reset once when this ships, and
stored keys are renamed outright, with no read of the old keys and no copy step.

| What | Treatment | Why | What is retained |
|---|---|---|---|
| [D2](DECISIONS.md#d2), saved names keep their strings behind `LEGACY_` constants | **Flipped**: stored names are renamed outright, and the two in-repo stores are reset once. The card links its merged text; its figure is redrawn | The reads the strings were kept for (FIX-1788's upgrade step, FIX-1790's copy, FIX-1793's room rows) were withdrawn by D9 | — |
| BR-11, V3's old-store leg, the guard's stored-key exception and the anti-game's "a stored key strips alone" | **Amended** to the rename: no stored-key exception | Follows from D2 | BR-11's ID, moved under *What is swept* |
| BR-12, a refusal module listed whole by path | **Removed**, ID kept and struck | Nothing refuses an old file or input by name (epic ER-6, ER-31) | — |
| DOCS's upgrading page section and its rename table; BR-14's, S3's, S7's and D4's changeset rows; V5 | **Removed** | No consumer needs a rename table. No consumer, no changeset (BP-022), as for FIX-1789 | No aliases (D3), and every in-repo caller moves in the same PR |
| `what-changes.svg`'s "saved key strings (D2)" under *kept by design*, and `d3-no-aliases.svg`'s table | **Amended** | Follow from D2 and the removed tables | — |
