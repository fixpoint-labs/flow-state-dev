# entry-names › it refuses a misnamed entry at hire

**Issue:** FIX-2463
**Outcome:** An app author who writes a worker flow of their own names every entry the framework calls by its documented string (`work`, `onTaskSteered`, `onMessageReceived`, `onWorkstreamOpened`, `onTaskSettled`), with no constant to import. A piece an entry factory built, put under any other name, is refused when the flow is defined or hired, and the refusal names the right string, so a typo can't leave a turn the framework owes and never finds.
**Input:** `fixtures/input.json`: two sets of one-letter (or one-case) typos, one per documented entry name. Held-out: the check builds one worker flow per entry factory (`workerTaskEntry`, `steerTurnEntry`, `messageReceivedEntry`, `workstreamOpenedEntry`, and orchestration's `taskSettledEntry` through the session board an app spreads) and puts its piece under whatever key the fixture names, so a different typo must fail the same way.
**Signal:** on the real path, `defineFlow` then `hireWorkforce` on a fresh installation, no model. (a) Each factory's flow with its piece under the documented name is hired. (b) The same flow with the piece under each typo is refused, the refusal's message naming the documented name. Pass: 5 twins hired and all 10 typos refused.
**Anti-game:** a hollow pass would grade the factories' unit tests or `workerFlowProblems`' return, which pass while the hire ignores a misplaced piece. This check reads only what `hireWorkforce` or `defineFlow` does: hired or thrown, and the thrown message. Every twin must hire first, so a refusal for some other fault of the fixture flow can't read as the name's refusal. The typo sets are floored with `tell.over`, so an empty fixture is CAN'T TELL.
**Model:** n/a. The property is which flows are hired, not model output.
**Run:** `pnpm tsx goals/entry-names/refused-at-hire/run.mts`
**Controls:** none in the runner. The spec names `main` as the control, where `onTaskSteerd: steerTurnEntry(...)` is hired. The source revert that stands for it: in `packages/workforce/src/worker-roles.ts`, make the entry-piece loop in `roleProblems` skip every entry (`if (true || piece === undefined …`). Must FAIL `[onTaskSteered]` and `[onWorkstreamOpened]`, both typos each. `[work]`, `[onMessageReceived]` and `[onTaskSettled]` stay green there: the contributor role, the message check and `defineFlow`'s held-board check already refused those.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-07 | `e52ea2175` + FIX-2463 branch | n/a | PASS | 5 twins hired; 10 misnamed pieces refused, each naming its entry: `wrk`/`Work`, `onTaskSteerd`/`onTaskSteer`, `onMessageRecieved`/`onMesageReceived`, `onWorkstreamOpend`/`onWorkStreamOpened`, `onTaskSetled`/`onTaskSettle`. |
| 2026-11-07 | `e52ea2175` + FIX-2463 branch, entry-piece loop skipped, then restored | n/a | FAIL (expected) | `[onTaskSteered]` both typos hired; `[onWorkstreamOpened]` both typos hired. The other three legs stayed green, refused by the checks that already existed. |
| 2026-11-13 | claude/fix-2627-impl-e-b1 | n/a | PASS | On the workforce kit: each leg's flow is hired by `installWorkers` over an empty folder, its piece in the kit's `workerFlows` slot. 10 misnamed pieces refused naming their entry; every twin hired. |
