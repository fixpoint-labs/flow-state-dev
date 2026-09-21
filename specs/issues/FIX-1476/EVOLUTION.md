# FIX-1476 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

Three earlier designs reach this issue. Two are retained whole; one is narrowed, and the
narrowing is [D1](DECISIONS.md#d1).

| Earlier | State | What this spec does with it |
|---|---|---|
| **The channel file convention (FIX-1352)** — a kind as `flows/channels/<kind>.ts` gathered by `fsdev gen`, an instance as `CHANNEL.md` with an optional `flow:` | Shipped, published in [code-on-disk.md](../../../apps/docs/docs/workforce/code-on-disk.md) and [channels.md](../../../apps/docs/docs/workforce/channels.md) | **Consumed unchanged.** This is the first app tree that uses both halves |
| **Board v1 (FIX-1385)** — a bare local name list, a minted ledger per name, explicit per-seat drain, the unattended warning, one factory | Shipped, and proven end to end by `goals/channel-boards/it-runs-a-row-a-file-declared-board-holds` (PASS, 2026-09-19) | **Consumed unchanged, and not re-proved.** This issue's check adds the two behaviours that goal cannot reach — the warning and the subset drain — and the structural legs proving this app's own tree is wired ([the checks](PLAN.md#the-checks)) |
| **The epic body's `CHANNELS.md` kind/family file** | Never existed. Zero occurrences anywhere on `origin/main` | Already superseded by the epic's [D4](../../epics/FIX-1455/DECISIONS.md#d4). Named here only so a reader coming from the ticket's pre-amendment text is not left looking for it |

## What is narrowed, and on what

**The ticket's EM fence: *"one `ChannelFlow` factory with kind clones (`dm` / `topic` /
`workstream`), each a real kind file. Kind supplies remix slots; same body — not a forked
sequencer per kind."*** Written 2026-09-20 and reaffirmed in the amendment banner the same day.

It is unbuildable as written, on three facts in
`packages/workforce/src/channel/channel-flow.ts` and `channel-binder.ts`: there is no `kind`
option, `CHANNEL_KIND` is a literal, and `holdsBoards` gates `boards:` on a method only the
built-in factory attaches — so all three clones would be board-incapable, in an issue whose
deliverable is the board drain. The full argument, the evidence, and the published `channels.md`
line that says the same thing from the reader's side are in [D1](DECISIONS.md#d1), and are not
repeated here.

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

<a name="after-merge"></a>
## What changed after this spec merged

The spec merged on 2026-09-21 at 17:58 UTC ([#1992](https://github.com/fixpoint-labs/flow-state-dev/pull/1992)).
Five things have moved since, four of them underneath it. Each row's command runs from the repo
root against `origin/main`.

| What | Was true when | Is true now | Command |
|---|---|---|---|
| **`openChannels` took an `orgId`, and refused a board-holding roster without one** | Drafted 13:39 UTC against `994a9365b`, where `OpenChannelsOptions.orgId` and the guard both existed | Gone. `OpenChannelsOptions` is `{ client, userId }`. FIX-1442 ([#1985](https://github.com/fixpoint-labs/flow-state-dev/pull/1985)) merged at 15:36 UTC — **two hours after the draft, two hours before the merge** | `git grep -n "orgId" origin/main -- packages/workforce/src/channel/channel-binder.ts` → 3 hits, all comments |
| **The binder compared a stored org against the one a boot asked for** | Same base: the `session.orgId !== orgId` branch | Gone with the same change. *"The binder no longer takes an `orgId` at all, and never did have the authority to choose one."* | `git show origin/main:packages/workforce/src/channel/channel-binder.ts \| sed -n '676,684p'` |
| **kitchen-sink named no organization anywhere** | Zero occurrences at the draft base | 38 across 7 files, landed by FIX-1475's PR-B ([#1996](https://github.com/fixpoint-labs/flow-state-dev/pull/1996)) at 20:35 UTC — **after this spec merged** | `git grep -c orgId origin/main -- 'apps/kitchen-sink/**'` |
| **[V11](PLAN.md#the-checks) could be graded behaviourally** | A `void openChannels(…)` mutation went red | It goes red or green depending on one event-loop turn, and #1996's module-scope `await flowstate.getRuntime()` moved the margin. Split into V11 + V11b | `git grep -n "const runtime = await flowstate.getRuntime" origin/main -- apps/kitchen-sink/fsdev.config.ts` → `:222` |
| **[D2](DECISIONS.md#d2)'s third channel was a one-member DM** | Approved at spec review | **Reversed by the product owner** after seeing it built, on [#2007](https://github.com/fixpoint-labs/flow-state-dev/pull/2007), then refined on [#2010](https://github.com/fixpoint-labs/flow-state-dev/pull/2010) — two seat members, and a post that names its author does not notify them — **in any channel**, not just the DM ([D6](DECISIONS.md#d6)). A first reading of the reversal produced a *silent* DM; that was wrong and is recorded as rejected rather than quietly replaced | — (a decision, not a fact; the words are in D6) |

**The first three are one failure and it is worth naming.** The premises were re-derived once, at
draft time, and then carried through review and merge without being re-run against a `main` that
had moved — each was one `git grep` away at any point in those four hours. The fourth is a
different failure: a check that was never decidable, which no re-derivation would have caught
because it passed. It took running the same mutation twice, on two bases, to see it.

## What this supersedes in the app

`apps/kitchen-sink/flows/channel/flow.ts` — the hand-registered built-in instance, added when the
kind shipped, with no consumer anywhere in the app and no roster behind it. It is deleted rather
than kept beside the binder, and that is a correctness change, not tidying: only
`channelInstances` calls `factory.withBoards(ids)`, so an instance built by hand holds no board
and answers neither `fileTask` nor `readBoard` however many `boards:` lines the tree declares.
Its notify handler is the one part kept, moved to `workforce/channel-notify.ts` and passed to the
binder's seeded built-in.
