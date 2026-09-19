# manager-queue-lab › it routes a queue to the seats their files name

**Issue:** FIX-1430 (the goal check — VG of the spec's Checks table, closing BR-4 to BR-7. **This is the epic's exit gate**, ER-20 and ER-21 together)

**Outcome:** A team declared entirely in files takes in more work than it has seats. A coordinator seat files one row per piece onto the channel's board, naming the desk each is for. Each row runs on the seat whose own file answers for that desk and on no other, in its own session, and the row that could not start immediately waits for a seat to free rather than being handed to a free one. Nobody writes a ledger id, nobody wires a collection between the seats, and nothing is dispatched by hand.

Before this, that claim had two halves that had each been proved and had never met: a post reaching seats declared in Markdown, and a board row becoming a real run over a board written in TypeScript. This is where they meet — and the part nobody had seen at all is a *queue*: several candidate seats, more rows than seats, and a coordinator choosing.

**Input:** `lab/workforce/` (the tree) and `WORK` in `run.mts` (four pieces of work). Both are **held out**: every desk key, the association between a desk and a seat, the channel's id and the board's local name come off the tree at run time, and the four pieces are ordinary English sentences the lab knows nothing about. Swap either for a different valid one and a correct implementation still passes. The three pinned names are the channel `eng.queue` holding `boards: [work]`, the lab root, and the fact that the desk keys are **deliberately not** the seat ids — a distinct spelling each, so a check that conflated a routing key with a seat could not pass.

**The oracle and the implementation are two different sources, and that is the whole check.** The host holds a seat → desk map, which is what actually routes; each builder's own `WORKER.md` says which desk it answers for, which is what this check grades against. Nothing that routes ever reads `answersFor`, and nothing that grades ever reads the map.

**Signal:** seven legs over a real `createFlowState` host with real sessions and real org-scoped storage.

(0) **The tree declares a board by name and the minted id appears in no file** under the lab — the tree and the lab's own code alike.

(a) **The rows are filed.** On the gate's path the coordinator seat's generator decides which desk each piece is for and files through the eight task tools its kind composes — the door FIX-1385 ships for models, which the coordinator holds although its own file says `tools: []`.

(b) **Every piece reaches the board in its own words**, graded against the input rather than against a count, and every row names a desk the tree declared. A run in which no desk got two pieces fails here: the queue's whole claim is about the row that could not start immediately.

(c) **Every row runs on the seat whose own file answers for its desk.** The row says which desk it was filed for; the seat that ran it reports, from inside the running work, which desk its own file claims. Two sources, and they must agree. Proof of execution is a **file on disk** written by the worker body, not the board's own report, because the board would report "completed" whatever it actually did.

(d) **Each row runs in its own session**, bound to the session that dispatched it, carrying none of the coordinator's transcript. Read off the session record.

(e) **The extra row is not re-routed and not dropped.** Every row sharing a desk ran on the *same* seat — nothing was handed to a free seat to make it finish sooner — and every row settled `completed`.

(f) **A row filed for nobody is refused by name where it would have run.** The lab declares no default worker, so such a row is admitted at a drain, missed by the router, and settles `errored` carrying its own id — loud rather than sitting in silence.

**The filer is a slot, and only one of its two values is the exit gate.**

- `GOAL_FILER=model` (default) — **the exit gate.** The coordinator chooses and files through the capability's door. Needs a real model credential.
- `GOAL_FILER=scripted` — **not the exit gate.** The same four pieces are filed through the channel's own `fileTask` door, spread across the declared desks, and legs (b) to (f) run unchanged. It proves the *routing and queue* half and proves nothing about a model choosing or about the capability door. A scripted run says so in its own evidence line, so a green one cannot be mistaken for the gate.

**Anti-game:** A hollow pass would file four rows, call three drains, and assert the board reported four completions — true even when every row ran on the same seat, true when the check read the seat→desk map on both sides of its own comparison, and true when nothing ran at all. So the check MUST prove execution by a **side effect outside the board** (the outbox file), since the board's report is generated on the same path being tested; MUST grade the seat that ran a row against **that seat's own file**, read out of the tree at run time, and never against the host's map, because grading the map against itself would move the oracle along with the implementation; MUST require that some desk got two pieces, or leg (e) grades nothing; MUST assert every row sharing a desk ran on **one** seat, since "all four rows ran" is equally true of a board that re-routed the waiting one; and MUST fail leg 0 if any file under the lab carries the minted id.

The `repointed-map` control is the other half of this. It leaves the tree untouched and moves one entry of the host's map to another declared seat, so everything still compiles, every id is still well-formed, the roster still hires and rows still run — and the tree still says where they should have gone.

**Model:** `openai/gpt-5.4-mini` on the gate's path (`gatewayModel()`, overridable with `GOAL_MODEL`). The model appears at exactly one surface — the coordinator deciding who gets what. Worker bodies are deterministic stubs, and waiting is driven by the substrate's own drain rather than by sleeps, because a gate that goes red for reasons unrelated to routing has stopped being a gate.

**Run:** `pnpm tsx goals/manager-queue-lab/it-routes-a-queue-to-the-seats-their-files-name/run.mts`

**Controls:** `GOAL_CONTROL=repointed-map` on the same command. Must FAIL, and must name leg (c) — a row observed on a seat whose own file claims a different desk — rather than leg 0 or the hire.

## Verdict log

| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-09-19 | fix/FIX-1430-manager-queue-lab (pre-PR) | n/a — `GOAL_FILER=scripted` | PASS (**routing half only; NOT the exit gate**) | Four rows filed through the channel's own door across the three declared desks, `desk-one` getting two. Every row ran on the seat whose own file answers for its desk — `desk-one → eng.builder-a` twice, `desk-two → eng.builder-b`, `desk-three → eng.builder-c` — proved by `/tmp/fsd-goal-manager-queue-goal-*/work.ndjson`. Both `desk-one` rows ran on the same seat, in turn, at drain width 1: the second waited rather than being re-routed. Each row ran in its own `dsx_…` child session whose `parentSessionId` is the dispatching seat's drain session and whose state is empty. A row filed with no assignee settled `errored` naming its own id and ran nowhere. |
| 2026-09-19 | fix/FIX-1430-manager-queue-lab (control: `repointed-map`, scripted) | n/a | FAIL (expected) | Named **leg (c)** in the spec's own words: *"row task_… was filed for \"desk-two\" and ran on eng.builder-a, whose own file answers for \"desk-one\""* — implementation and oracle disagreeing — plus *"0 of 2 rows for \"desk-one\" ran"* and two rows left `pending`. The tree still loaded, the roster still hired, the ledger was still minted and the rows were still filed: only the map moved. This is the red state VG names. |
| — | — | `openai/gpt-5.4-mini` | **NOT RUN** | The gate's own path — the coordinator choosing and filing through the eight task tools — has **not been run**. It needs `AI_GATEWAY_API_KEY`, which the authoring environment did not have; the run fails loudly and by name (*"No API key found for gateway \"vercel\""*) rather than passing silently. **ER-20 is not closed until this row says PASS.** Everything it adds over the row above is the model surface and the capability door; the routing, session, waiting and refusal legs are identical and are already green. |
