# FIX-1667 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

Three destinations. No new page; the channel-board concept is already documented in
`packages/workforce/README.md` → "Holding a board" and is unchanged. The epic's shared App Lab
narrative is FIX-1662's; nothing here touches it.

## UPDATE · `packages/harness-manager/README.md` · after "Quick start", new section

### Running a channel's board

A channel can hold a board (see `@flow-state-dev/workforce` → "Holding a board"). To run its
rows as supervised coding runs, hand the manager that board and its id:

```ts
import { channelBoard } from "@flow-state-dev/workforce";

const work = channelBoard("eng.feature", "work");

const manager = harnessManager({
  boardCollectionId: work.id,   // "eng.feature.work"
  boardCollection: work,
  // ...the rest as above
});
```

The manager builds each run's checkout folder and git branch from the board's id, used as is. A
channel's board id contains dots, which the manager accepts. It refuses, when you build it, an id
git can't use as a branch name, such as one ending in `.lock` (a channel board named `lock`).
Two different boards never share a checkout. Board ids that worked before keep the same folders
and branches, so an upgrade moves nobody's work.

The board is kept per organization, so everyone in the organization sees its rows.

## UPDATE · `apps/docs/docs/orchestration/harness-manager.md` · "The checkout", after its first paragraph

The board can be your own task collection or one a channel holds. A channel's board has an id
like `eng.feature.work`; the manager accepts it as is and names the folder and branch with it. An
id git can't use in a branch name, such as one ending in `.lock`, is refused when the manager is
built. Two boards never end up in the same checkout, and a board whose id worked before keeps its
folders and branches.

## UPDATE · `goals/devforce-lab/lab/README.md`

**In "What an author writes"**, the channel line becomes:

```
      channels/feature/CHANNEL.md                  holds the board, `boards: [work]`; driven by the third check
```

**In the table**, the `board.mts` row becomes:

| `board.mts` | The two declarations of the channel's board: the EM's, whose worker hands a row to the coder seat, and the coder's, which only lets that hand-off in. The board itself belongs to the channel: its file names it, and the framework mints its id from where the channel sits. |

**"What it works around"** is rewritten to:

> **The `coder` kind declares the channel's board a second time, and never drains it.** Same
> board id, the same ledger, its own dispatcher. `defineFlow` refuses a flow that declares a task
> entry with no reachable board handing off to it, and the claim gate refuses a dispatch whose
> board id differs from the recipient's own. That cost is
> the framework's to remove. Where the board lives is settled: on the channel, as its file says.

## Publication ownership

FIX-1667 publishes all three after VG passes, checked against what shipped.
