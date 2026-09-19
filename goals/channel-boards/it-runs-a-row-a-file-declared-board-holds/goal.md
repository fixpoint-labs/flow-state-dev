# channel-boards › it runs a row a file-declared board holds

**Issue:** FIX-1385 (check VG of the spec's Checks table — the goal-altitude proof that the board is reachable end to end)

**Outcome:** Someone describes a team in Markdown — two worker files and one channel file whose frontmatter says `boards: [work]` — points the app at the folder, and the team has a place to keep its work. One seat files a row onto the channel's board. The other seat's board **claims** it and runs it. Nobody writes a ledger id, nobody wires a collection between the two seats, and nothing is dispatched by hand.

The ledger id is never written anywhere. It is minted from where the channel folder sits, which is the whole point: a file says a **name**, the framework owns the **identity**.

**Input:** `fixtures/workforce/` — one team `eng`, two workers (`em`, `coder`) and one channel `feature` whose `CHANNEL.md` declares `members: [eng.em, eng.coder]` and `boards: [work]`. Held out: the channel's id, the board's local name, the members and which seat runs which kind all come off the tree at runtime — `run.mts` reads `channel.declared.boards[0]` and `channel.id` rather than naming either. Rename the team folder, the channel folder or the board and a correct implementation still passes; every assertion is phrased against what the tree said.

**Signal:** six legs, model-free, over a real `createFlowState` host with real sessions and real org-scoped storage.

(0) **The tree names a board and never an id.** Every file under `fixtures/` is read and searched for the minted id `eng.feature.work`. A hit is a failure. This is the leg that makes the rest mean something: if a fixture could name the ledger directly, legs (c)–(e) would pass for a seat that simply agreed with a string somebody typed.

(a) **The tree alone produces the roster, the instances and the seats.** `readWorkforce` + `readChannelsDirectory` load clean, `channelInstances` builds the channel kind holding the declared board, `hireWorkforce` hires both seats with `channelBoards: channelBoardIds(channels)`.

(b) **The channel says what it holds, by name.** The channel's own `read` action returns `boards: ["work"]` — the local name a human wrote, not the mint. Asserted as a whole-array equality, so a read that returned every board in the process would be red.

(c) **One seat files one row, through the channel.** The `em` kind has no collection, no board and no drain. Its single action is a `dispatcher` into the channel session's `fileTask`. That is the only line in the EM's code that reaches the work.

(d) **The other seat's board claims it and runs it, and the work really ran.** The drain is handed nothing — no row id, no assignee, no worker name. Proof of execution is a **file on disk** written by the worker body, not the board's own report, because the board would report "1 task completed" whatever it actually did.

(e) **The row is completed on the minted ledger, read out of storage.** The row's status and goal come back through the channel's `readBoard`, and then `stores.resourceState.get("org", ORG_ID, "eng.feature.work/<id>")` confirms it is under the id the framework minted rather than under some other key the board happened to like.

**Anti-game:** A hollow pass would hire two seats, call a drain, and assert the drain reported success — true even when the seat and the channel are talking about two different ledgers, and true even when nothing ran at all. So the check MUST prove execution by a **side effect outside the board** (the outbox file), since the board's report is generated on the same path being tested; MUST assert the row **out of storage under the minted id**, not merely that some board somewhere holds a completed row; MUST read the board's name off the **tree** rather than naming `"work"`, so agreeing with a hardcoded string is not a route to green; and MUST fail leg 0 if any fixture file carries the minted id, which is the difference between the framework minting identity and a human having wired it.

The `by-name` control is the other half of this. It leaves the fixture tree untouched and perturbs only the harness, so it has to fail at the leg it controls rather than at leg 0.

**Model:** n/a — model-free on purpose. Nothing here is a judgment call: a row is filed, a board drains it, a side effect happens or it does not. A model in the loop would add a way to fail that has nothing to do with the claim.

**Run:** `pnpm tsx goals/channel-boards/it-runs-a-row-a-file-declared-board-holds/run.mts`

**Controls:** `GOAL_CONTROL=by-name` on the same command. Must FAIL, and must name legs (d)/(e) rather than leg 0.

## Verdict log

| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-09-19 | fix/FIX-1385-channel-boards (pre-PR) | n/a | PASS | A tree declaring `boards: [work]` on `eng/channels/feature` produced a channel kind holding one board. The channel's `read` returned `["work"]`. The `em` seat — no collection, no board, one dispatcher — filed `"wire the work board end to end"`; the `coder` seat's drain claimed it and the worker body wrote the goal to `/tmp/fsd-goal-channel-boards-*/ran.txt`. `readBoard` returned one row, `status: "completed"`, `assignee: "coder"`, `attempts: 1`, and `resourceState.get("org", org_channel_boards, "eng.feature.work/task_…")` found it. No file under `fixtures/` contains the string `eng.feature.work`. |
| 2026-09-19 | fix/FIX-1385-channel-boards (control: `by-name`) | n/a | FAIL (expected) | Named **legs (d) and (e)**, not leg 0: *"the work did not run: the outbox holds \"\""* and *"the row is pending, not completed"*. With the coder seat resolving `channelBoard("other.team", "work")` — same local name, different channel — everything still compiled, every id was still well-formed, and the drain found nothing to claim while the row sat `pending` on the channel's own ledger. This is the control that proves legs (d)/(e) grade the **minted identity** rather than the local name, and it is the red state behind BR-9's isolation claim. |
