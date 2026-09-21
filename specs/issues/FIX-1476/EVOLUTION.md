# FIX-1476 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

Three earlier designs reach this issue. Two are retained whole; one is narrowed, and the
narrowing is [D1](DECISIONS.md#d1).

| Earlier | State | What this spec does with it |
|---|---|---|
| **The channel file convention (FIX-1352)** — a kind as `flows/channels/<kind>.ts` gathered by `fsdev gen`, an instance as `CHANNEL.md` with an optional `flow:` | Shipped, published in [code-on-disk.md](../../../apps/docs/docs/workforce/code-on-disk.md) and [channels.md](../../../apps/docs/docs/workforce/channels.md) | **Consumed unchanged.** This is the first app tree that uses both halves |
| **Board v1 (FIX-1385)** — a bare local name list, a minted ledger per name, explicit per-seat drain, the unattended warning, one factory | Shipped, and proven end to end by `goals/channel-boards/it-runs-a-row-a-file-declared-board-holds` (PASS, 2026-09-19) | **Consumed unchanged, and not re-proved.** This issue's check covers the two legs that goal leaves out — the warning and the subset — inside the served app |
| **The epic body's `CHANNELS.md` kind/family file** | Never existed. Zero occurrences anywhere on `origin/main` | Already superseded by the epic's [D4](../../epics/FIX-1455/DECISIONS.md#d4). Named here only so a reader coming from the ticket's pre-amendment text is not left looking for it |

## What is narrowed, and on what

**The ticket's EM fence: *"one `ChannelFlow` factory with kind clones (`dm` / `topic` /
`workstream`), each a real kind file. Kind supplies remix slots; same body — not a forked
sequencer per kind."*** Written 2026-09-20 and reaffirmed in the amendment banner the same day.

It is unbuildable as written, on three facts in
`packages/workforce/src/channel/channel-flow.ts` and `channel-binder.ts`:

1. `DefineChannelFlowOptions` declares exactly `notify`, `boards`, `inventory`. There is no
   `kind`.
2. The factory calls `defineFlow({ kind: CHANNEL_KIND, … })`, and `CHANNEL_KIND` is the literal
   `"channel"`. So *one factory, three kind names* has no expression: a kind under a different
   name is a different `defineFlow` call with its own graph, which is the *"same body"* clause
   inverted.
3. `channelInstances` refuses `boards:` unless `holdsBoards(factory)`, which tests for the
   `withBoards` method only `defineChannelFlow` attaches. All three clones would be
   board-incapable — in an issue whose deliverable is the board drain.

`channels.md` says the same thing from the reader's side, and said it before the fence was
written: *"A standup, a direct message and an announcement channel are all channels on the one
built-in kind, told apart by their members and their charter, not by being different kinds."*

**What survives the narrowing.** Everything the fence was protecting. *Real kind files, not
labels* — [S1](PLAN.md#surfaces) is a real file and the generated `channelKinds` map names it.
*Not a forked sequencer per kind* — there is one custom kind, so there is nothing to fork. *Board
v1 whole* — untouched, and the drain sits on the built-in-kind channel exactly as the epic's
[D4](../../epics/FIX-1455/DECISIONS.md#d4) records. *The `dm` / `topic` / `workstream`
vocabulary* — kept, as the three channel instances it maps onto.

**What is given up.** A reader sees one escape hatch rather than three, and does not get a worked
example of a kind that "remixes slots" off a shared body — because no such surface exists to work
an example of. If one is added to `defineChannelFlow` later, [D1](DECISIONS.md#d1) is re-argued
rather than re-derived.

## What this supersedes in the app

`apps/kitchen-sink/flows/channel/flow.ts` — the hand-registered built-in instance, added when the
kind shipped, with no consumer anywhere in the app and no roster behind it. It is deleted rather
than kept beside the binder, and that is a correctness change, not tidying: only
`channelInstances` calls `factory.withBoards(ids)`, so an instance built by hand holds no board
and answers neither `fileTask` nor `readBoard` however many `boards:` lines the tree declares.
Its notify handler is the one part kept, moved to `workforce/channel-notify.ts` and passed to the
binder's seeded built-in.
