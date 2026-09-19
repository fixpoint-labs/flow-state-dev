# The manager-queue lab

**This is evidence, not a tutorial and not a shape to copy.** It exists to make one sentence true or false on the real path: *work filed for a team reaches a seat that runs it.*

Four issues in this epic build surface for that sentence. None of them makes it true or false. You can ship a declarable board, a runtime roster and a package format and still never watch a row cross from the person who filed it to the seat that finished it — and a claim nobody has watched is an intention, not a result. This is where it gets run.

## What it declares

```
lab/workforce/
  teams/eng/
    channels/queue/CHANNEL.md      boards: [work]  ->  the ledger
    workers/manager/WORKER.md      flow: coordinator, tools: []
    workers/builder-a/WORKER.md    flow: builder, answersFor: desk-one
    workers/builder-b/WORKER.md    flow: builder, answersFor: desk-two
    workers/builder-c/WORKER.md    flow: builder, answersFor: desk-three
  flows/workers/{coordinator,builder}.mts
```

One line of frontmatter — `boards: [work]` — mints the ledger. Nothing writes its id; the framework derives it from where the channel folder sits, and both goal checks grep every file under `lab/` for that string and fail on a hit.

**The coordinator's file says `tools: []` and it holds all eight task tools anyway.** That is not an omission and it is not a bug. The tools arrive as capability *controls*, minted per resolver and never exported, so no `tools:` line can grant them or fence them out. The grant is one line in the kind:

```ts
uses: [channelBoardTaskTools(work)]
```

If you find yourself wanting to write a board tool into a `WORKER.md`, you are about to take the other door — an app registering `buildTaskToolsList()` in its own catalog, where a seat's `tools:` *does* bite. Read `BR-2` first. That door is wired here only as a control, and turning it on makes the contract gate go red.

## The two checks

Both drive the same host, the same tree and the same hire. They differ by who files.

| Check | What it proves |
|---|---|
| `it-stands-the-team-and-its-board-up-from-files` | Model-free. The declaration surface and the queue as a *view*: four seats from one tree, the refusal a seat-folder board earns, the three tool-set arms, the channel's author check both ways, four columns derived and never written, the status enum, and the diff fence. |
| `it-routes-a-queue-to-the-seats-their-files-name` | **The exit gate.** More rows than seats, a coordinator choosing who gets what, every row on the seat its own file answers for, each in its own session, the extra one waiting rather than being re-routed, and a row for nobody refused by name. |

## The one idea worth carrying away

**The oracle and the implementation are two different sources.**

The host holds a seat → desk map. That map is what routes, and it is the thing under test. Each builder's own `WORKER.md` separately says which desk it answers for, and *nothing that routes ever reads it* — it is reported back out from inside the running work, and the check grades against that.

Which is why the negative control can go red at all. It **swaps** two builders' entries in the map and touches nothing else: every id stays well-formed, the roster still hires, every row still runs and every row still completes. The tree still says where they should have gone, the run says where they went, and the two now disagree. Grade the map against itself and the control moves the answer along with the implementation, and stays green — which is exactly what one leg of the contract gate was doing until review caught it.

## What this lab does not prove

- **Nothing about the package format.** It authors no package shape at all, which is why it is compatible with every answer FIX-1394 can reach, *don't collapse* included.
- **Nothing about the nested cascade** — personal boards, request boards, a row that fans into rows. One hop only: the channel's board, then the seat.
- **Nothing about what a busy seat *should* do** — the epic ruled that, and the lab is pinned to the ruling rather than being evidence for it. See below.
- **Nothing about scale, cost or a real coding run.** Worker bodies are stubs that write a line. `goals/devforce-lab/` is where a row becoming a supervised coding run is evidenced, and it stays as it is — this lab's diff gate rejects that subtree on purpose, because "byte for byte as before" is something a diff can prove and a behavioural suite cannot.

## The drain-width switch, and the ruling

Whether a busy seat gets a second copy of the work or the work queues behind it was an **epic-level call**, and deciding it in a `goals/` folder would have settled it where nobody reads decisions. The lab was built to run at either width from one knob, with no edit to the tree and none to the checks, and to recommend neither.

**The epic ruled width `1`** (2026-09-19). Work queues behind a busy seat; a busy seat never takes a second row concurrently. The lab is pinned to it. The reasoning, because the number alone is not reusable:

- A seat is a roster slot that mints a flow instance (the epic's D3). A seat running two rows at once is a **pool**, not a seat — and hiring is the metaphor the whole product is sold on.
- A seat carries a `WORKER.md`, a persona and memory. Interleaving two rows inside one breaks the seat's coherence, which is the thing being sold.
- The live inventory asks *which seats are busy*. That question means nothing unless busy excludes.
- The green routing run already stands on width-1 behaviour: `desk-one` got two pieces, one could not start until a seat freed, and the waiting row was neither re-routed nor dropped. At width 2 the "extra one waits" leg would have had nothing to grade.

The knob stays. The ruling is reversible, and the knob is how the negative case stays reachable:

```
MANAGER_QUEUE_DRAIN_WIDTH=2 pnpm tsx goals/manager-queue-lab/<check>/run.mts
```

## Three legs that were grading nothing, and how each was caught

The lab's whole job is to be a check that can fail, so a leg of it that cannot is the worst defect available here. Three were found — one during the build, two in review — and all three are the same shape.

| Leg | What it looked like | Why it could not fail |
|---|---|---|
| BR-9, the unclaimed settle | green, with a parenthesis where a row id belonged | an earlier leg's drain had eaten every claimable row, and the only failure path needed a row to exist |
| the filing leg | green on four rows, every piece present | *"each piece appears somewhere"* is satisfied by a filer that combines two pieces into one row and duplicates a third |
| the recovery leg | green | it compared the running seat's own file against the host's map **for that same seat** — both derived from the tree, the row absent from the expression entirely |

Each is fixed the same way: put something on one side of the comparison that the other side cannot move, then **build the control that makes it red** and check the red lands at that leg and no other. That last clause is not decoration — a control that goes red somewhere else certifies a check nobody asked about. Both goal checks now grade their own controls for exactly this, and one of them caught a control of mine going red at the wrong leg the first time it ran.

The habit underneath all three: after a check goes green, read the sentence it wrote rather than the verdict, and ask what it would have said if the thing under test had been absent. If the answer is "much the same", the leg is not a leg yet.

## How the first of them got caught

BR-9's leg passed for a while without checking anything, and the method that caught it is worth more than the fix.

**The tell was in the evidence line of a leg that was passing.** It read *"An unclaimed settle by the coordinator: (no row to settle)"* — a parenthetical standing where a row id belonged. The verdict said green; the sentence said the leg had no input. Reading only exit codes would never have surfaced it, because nothing was failing.

The cause was ordering inside one shared ledger. An earlier leg's recovery drain had consumed every claimable row, so by the time the settle leg ran there was nothing left for it to settle, and its only failure path required a row to exist. A check whose input can be eaten by an earlier check is a check whose pass is a coincidence.

Two things changed, and the second is the one that generalises:

1. A dedicated row is filed immediately before the hold, so the leg owns its own input rather than inheriting whatever survived.
2. **"Nothing to settle" is now a hard failure** rather than a quiet string. The absent-input branch can no longer be confused with a pass.

The habit: after a check goes green, read the sentence it wrote, not the verdict, and ask what it would have said if its input had vanished. If the answer is "the same thing, with a parenthesis in it", the leg is not a leg yet.

## Two rules whose stated mechanism the code refuted

Both were checked in the code and then by a run, and both leave the rule's substance intact. Recorded here rather than quietly worked around.

- **BR-5** says a row runs in its own session "whose parent is the session the row was filed from". It runs in its own child session and that session carries a `parentSessionId` — but the parent is the **draining seat's** session, not the coordinator's. The coordinator's session is where the row was *filed*; the dispatch that mints the child happens later, at the seat. The substance — own session, a parent bound at mint, none of the coordinator's transcript carried — is graded and holds.
- **BR-11** says the claim gate "refuses an adoption once the lease has lapsed (`StaleTaskClaimError`)". It does the opposite: `adoptLapsedLease` in `packages/orchestration/src/task-board/task-entry.ts` renews the lease so a successor *can* take the row back, and `StaleTaskClaimError` fires only when a reclaim genuinely won or the committed span cannot be read. So the lab grades the stronger and truer claim — the next drain really does take the row and run it, which is what "back in the queue" means.
