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

Which is why the negative control can go red at all. It re-points one entry of the map at a different declared seat and touches nothing else: every id stays well-formed, the roster still hires, the rows still run. The tree still says where they should have gone, the run says where they went, and the two now disagree. Grade the map against itself and the control moves the answer along with the implementation, and stays green.

## What this lab does not prove

- **Nothing about the package format.** It authors no package shape at all, which is why it is compatible with every answer FIX-1394 can reach, *don't collapse* included.
- **Nothing about the nested cascade** — personal boards, request boards, a row that fans into rows. One hop only: the channel's board, then the seat.
- **Nothing about what a busy seat *should* do.** See below.
- **Nothing about scale, cost or a real coding run.** Worker bodies are stubs that write a line. `goals/devforce-lab/` is where a row becoming a supervised coding run is evidenced, and it stays as it is — this lab's diff gate rejects that subtree on purpose, because "byte for byte as before" is something a diff can prove and a behavioural suite cannot.

## The drain-width switch

Whether a busy seat gets a second copy of the work or the work queues behind it is an **epic-level call**, and deciding it in a `goals/` folder would settle it where nobody reads decisions. So the lab is wired to run at either width from one knob, with no edit to the tree and none to the checks, and recommends neither:

```
MANAGER_QUEUE_DRAIN_WIDTH=2 pnpm tsx goals/manager-queue-lab/<check>/run.mts
```

At `1` a second row for a busy desk queues behind the first. Above `1` the seat takes a second copy. Running both and writing out the comparison is evidence the epic asks for when it wants to rule; what ships here is the wiring plus a stated way to run it. When the epic rules, come back and keep the ruled width.

## Two rules whose stated mechanism the code refuted

Both were checked in the code and then by a run, and both leave the rule's substance intact. Recorded here rather than quietly worked around.

- **BR-5** says a row runs in its own session "whose parent is the session the row was filed from". It runs in its own child session and that session carries a `parentSessionId` — but the parent is the **draining seat's** session, not the coordinator's. The coordinator's session is where the row was *filed*; the dispatch that mints the child happens later, at the seat. The substance — own session, a parent bound at mint, none of the coordinator's transcript carried — is graded and holds.
- **BR-11** says the claim gate "refuses an adoption once the lease has lapsed (`StaleTaskClaimError`)". It does the opposite: `adoptLapsedLease` in `packages/orchestration/src/task-board/task-entry.ts` renews the lease so a successor *can* take the row back, and `StaleTaskClaimError` fires only when a reclaim genuinely won or the committed span cannot be read. So the lab grades the stronger and truer claim — the next drain really does take the row and run it, which is what "back in the queue" means.
