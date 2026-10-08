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
| A task board's "seat": a registry entry holding a worker or a dispatcher, and the hand-off record's `seat` field; `packages/orchestration/src/task-board/hand-off.ts`, `packages/core/src/types/dispatch.ts`, the task-board page's "Seats that hand off" | **Superseded** since [epic D7](../../epics/FIX-1786/DECISIONS.md#d7)'s amendment (2026-10-07); **retained** at merge | The product owner: "Ok let's go with assignee". "Seat" is retired everywhere, and a board's entry is an assignee, the word a task already uses to pick it ([D1](DECISIONS.md#d1)) | [BR-3](BUSINESS-RULES.md#what-is-swept), [BR-18](BUSINESS-RULES.md#the-glossary), the names [PLAN.md](PLAN.md#pinned-names) pins | No alias, and nothing reads the old `seat` field ([epic D9](../../epics/FIX-1786/DECISIONS.md#d9)) |
| "Kind-owned params" in the worker contract's wording; FIX-1367, `packages/workforce/src/worker-config.ts` header | **Amended**, wording only, as the epic recorded | A worker's flow is a worker flow, not a kind | [BR-2](BUSINESS-RULES.md#what-is-swept) | None |

The "call a seat a seat" work (#2700, #2695, FIX-1755) and the atlas word inventory (#2708) closed
unmerged and left no design to supersede. Neither predecessor epic is wholly superseded. Before
building, compare each row with `main`; the other children change most of these files first.

<a name="amendment-d9"></a>
## Amended after merge: stored names renamed outright, no upgrade page (epic D9); a task board's seat becomes assignee (epic D7)

**The decision.** On 2026-10-07 the product owner wrote: "No consumers yet. No need for
backwards support of any kind." The epic records it as [epic D9](../../epics/FIX-1786/DECISIONS.md#d9) and
[ER-31](../../epics/FIX-1786/BUSINESS-RULES.md#what-no-child-may-do). The same day the product owner answered:
yes, the kitchen-sink app's and the DevTeam lab's stores are reset once when this ships, and
stored keys are renamed outright, with no read of the old keys and no copy step.

**Then, the same day**, the product owner chose assignee for a task board's seat, and the epic
records it as an amendment to [epic D7](../../epics/FIX-1786/DECISIONS.md#d7); the last row is that one.

| What | Treatment | Why | What is retained |
|---|---|---|---|
| [D2](DECISIONS.md#d2), saved names keep their strings behind `LEGACY_` constants | **Flipped**: stored names are renamed outright, and the two in-repo stores are reset once. The card links its merged text; its figure is redrawn | The reads the strings were kept for (FIX-1788's upgrade step, FIX-1790's copy, FIX-1793's room rows) were withdrawn by D9 | — |
| BR-11, V3's old-store leg, the guard's stored-key exception and the anti-game's "a stored key strips alone" | **Amended** to the rename: no stored-key exception | Follows from D2 | BR-11's ID, moved under *What is swept* |
| BR-12, a refusal module listed whole by path | **Removed**, ID kept and struck | Nothing refuses an old file or input by name (epic ER-6, ER-31) | — |
| DOCS's upgrading page section and its rename table; BR-14's, S3's, S7's and D4's changeset rows; V5 | **Removed** | No consumer needs a rename table. No consumer, no changeset (BP-022), as for FIX-1789 | No aliases (D3), and every in-repo caller moves in the same PR |
| `what-changes.svg`'s "saved key strings (D2)" under *kept by design*, and `d3-no-aliases.svg`'s table | **Amended** | Follow from D2 and the removed tables | — |
| [D1](DECISIONS.md#d1), a task board keeps "seat"; with it BR-3, BR-18, S1, S3, S9, S10, V1, the guard's board-seat exceptions and board surface, the pinned names, `what-changes.svg`'s kept board seat, and `d4-workers-domain.svg`'s "seat means only a board's place" | **Flipped**: a task board's seat becomes assignee and "seat" is retired everywhere. The card links its merged text, and its figure is redrawn as `d1-seat-becomes-assignee.svg` | The product owner, 2026-10-07 ([epic D7](../../epics/FIX-1786/DECISIONS.md#d7)) | BR-3's and BR-18's IDs |

<a name="amendment-cross-spec"></a>
## Amended after merge (cross-spec alignment, 2026-10-07)

**The alignment.** Reading the epic's merged child specs against each other found places where
siblings read two ways. Each was an engineering call, made under decisions already taken, and
recorded in the epic's [How it got here](../../epics/FIX-1786/DECISIONS.md#how-it-got-here). This
spec changed:

| What | Treatment | Why | What is retained |
|---|---|---|---|
| BR-18, D1's *Locks in* and the glossary row: an assignee is "a named entry in a board's `workers` map" | **Amended**: who a task goes to, an entry in that map or a name the board's assignee check accepts (in Workforce, a delegate) | Workforce boards route every row through one `defaultWorker`, and the assignee is a delegate name (FIX-1794, FIX-1802); epic D7 matches | The word, assignee (the product owner, 2026-10-07) |

<a name="amendment-handoff"></a>
## Amended after merge (one word per thing for hand-offs, 2026-10-08)

**The decision.** The product owner removed skill sub-agents and gave hand-offs one word per thing
([epic D10](../../epics/FIX-1786/DECISIONS.md#d10)): a hand-off is orchestration's, delegation is
Workforce's, a delegate is a worker a conversation may delegate to, and "mailbox" is kept back for
a future untrusted inbox. In published docs, "delegation" means Workforce's meaning only.
[FIX-1814](https://linear.app/fixpoint-labs/issue/FIX-1814) removes skill sub-agents. This spec
changed:

| What | Treatment | Why | What is retained |
|---|---|---|---|
| DOCS's glossary: no Hand-off or Delegation row; Delegate as "a worker a coordinator can hand posts to" | **Amended**: Hand-off in the task-board section, Delegation in the Workforce section, and Delegate for any worker | Epic D10's vocabulary; any worker with task-taking delegates delegates tasks (epic D8) | One row per idea (BR-17, BR-19) |
| S1's internals list: `toolSeats`, `hasToolSeats`, `TOOL_SEAT_NOTE`, `test/skills/delegation-tool-seats.test.ts` | **Removed** from the rename list | They live only in the skills library's delegation surface, which FIX-1814 deletes ("don't rename what a sibling is about to delete") | Every other name S1 lists |
| S3 and DOCS: `skills/delegation.md`'s floor renamed the default assignee | **Removed** | FIX-1814 deletes the page | `orchestration/agents.md`'s and `configuration.md`'s tool seats, where they outlive FIX-1814 |
| The pinned tool-assignee names | **Amended** with a note: renamed only where still on `main` when P1 builds | FIX-925's tool seat is part of the surface FIX-1814 removes | The names, for whatever survives |

This spec had no plan for a `subAgents` name, so none goes.
