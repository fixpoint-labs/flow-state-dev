# workforce-conventions › a mailbox holds the work, a seat drains it

**Issue:** FIX-1476 (checks V1–V14 of the spec's Checks table); re-pointed by FIX-1611.

**Outcome:** Somebody clones the reference app and finds a mailbox in it: `support.help`, one `MAILBOX.md` holding one board, `escalations`. Nobody drains that board, and the boot says so out loud. A member's post tells nobody, the writer included. Somebody writing their own team finds the rest proved on a fixture tree: a mailbox on a kind of its own, a seat that drains one board of two, and a member whose seat cannot hear a post.

**Re-pointed (FIX-1611).** Until FIX-1611 the app carried every one of those shapes: `desk` holding `followups` and `escalations`, `noticeboard` on the `digest` kind, `support.wren` draining `followups`, desk-clerk seats that could not hear a post, and `ada-wren` as a two-seat direct message. The app is now one routed mailbox and four agent specialists. The legs whose subject left (V1, V3, V4, V8, V9's attended half, V14's non-hearing half) run on the fixture tree of `mailbox-boards/it-runs-a-row-a-file-declared-board-holds`, extended for them with a second board, a listening member and a `notices` mailbox on `digest`. V7 (a row claimed, run and settled on the minted ledger, with an effect outside the board) is that check's own legs (c) to (e), on the same tree, and is not re-graded here. The direct message had no leg of its own.

**Input:** two subjects, one run.

- **The app**: `apps/kitchen-sink` itself, its real `workforce/` tree and its real `fsdev.config.ts`. Not a fixture: the claim is about what a reader of the reference app finds, so the harness imports the app's real config.
- **The fixture host**: the tree under `goals/mailbox-boards/it-runs-a-row-a-file-declared-board-holds/fixtures/workforce/`, hosted in process by `run.mts` on a real `createFlowState`. Its mailboxes are opened through the real session route, as the app's are.

Held out: every mailbox id, board name, member, kind name and ledger id is read off the tree at run time. Rename a mailbox folder or a board and a correct implementation still passes.

**Signal:** model-free legs, the fixture half first.

## The legs

### The fixture host

- **V1 — the generated map names the kind file.** `mailboxKinds` in the fixture's committed `workforce.gen.ts` holds exactly the basenames under `flows/mailboxes/`, each imported from there, and `fsdev gen --check` says the module is what the tree renders. `--check` alone passes an empty map, and the content half alone passes a stale one. When V1 fails the fixture half stops: a kind a file selects would be missing.
- **V9, the attended half — the warning is for the board nobody drains, only.** `console.warn` is captured around the hire. One warning, naming `parked`; none naming `triage`, which the coder's kind declares.
- **V3 — each mailbox opened on the kind its file selected.** `notices` on `digest`, `feature` on the built-in. The leg also asserts exactly one mailbox selects a generated kind and at least one selects none, so deleting the `flow:` line cannot move both sides of the comparison together.
- **V4 — the custom kind admits what the binder writes.** `notices`'s open session carries `members`, `instructions` and `transcript`. A `stateSchema` that omits one strips it silently: session create does not refuse a state-schema mismatch. Load-bearing: the mailboxes are opened through the session route, which parses state against the kind's schema. A client that wrote the store directly would keep the key, and V4 could not fail.
- **V14, the non-hearing half.** One post on `feature`, written by its first member. The fan-out addresses all three members. The writer is told nothing, the member whose seat hears posts (`listener`) is silent on a seat's post, and the member whose seat cannot hear (`coder`) gets a name-only line. Asserted as a set. The fallback is the fixture's own (`fixture-notify-member`), because the app no longer carries one.
- **V8 — the drain is a subset.** A row filed on `parked` is still `pending` after the coder's drain.

### The app

Read before the boot, so a tree that disagrees with itself costs no runtime. If any fails, the app half stops:

- **V10 — the vocabulary.** No `description:`, charter, board name or mailbox id under `workforce/` uses a word from the *is not* column of FIX-1476's vocabulary table. Scoped to those strings; it does not reach a component label and does not claim to. One proper noun is read past, below.
- **V2 — no hand-written kind name in the wiring.** `hire.ts` spreads `...mailboxKinds`, and neither it nor `fsdev.config.ts` writes a generated kind's name as a string. The app carries no mailbox kind of its own today; the spread is what lets one it adds reach the binder with no edit to either file.
- **V6 — the minted id is in no file.** No file under `workforce/` contains `support.help.escalations`.
- **V12 — the published page states both costs.** `apps/docs/docs/workforce/mailboxes.md` says a custom kind cannot hold a board, and that re-opening is not a migration.
- **V11b — the open is an awaited module-scope statement.** Structural; see *Why V11 is two legs*.

Then the boot, driven by `harness.mts` inside the app, with `KITCHEN_SINK_TEST_MODE=1` so the app's own goal controls can reach it:

- **V11 — the boot opened `support.help`, and the check opened nothing.**
- **V5 — the mailbox says what it holds, by name.** Its `read` returns `["escalations"]`, whole-array, compared sorted on both sides.
- **V9 — exactly one unattended-board warning,** naming `escalations`. Counted, not found: the failure this issue makes visible is a board nobody watches.
- **V14, the writer half — nobody is told about their own post.** One post, written by `support.devices`. The fan-out addresses all four members (asserted too), and every member's seat hears posts, so a seat's post is delivered to nobody, the writer included. A delivery is read off the traces: a `wake-<member>` dispatch, or the `kitchen-sink-notify-member` line the app's `name-only-notify` control puts in the wake's place.
- **V13 — the mailboxes are reachable by the app's own user.** Listed as `devuser`, the id `app/page.tsx` calls as. **It cannot fail on this app today**; see *V13 and the app's resolver*. Kept, not counted as evidence.

## Why `flow-state-dev` is read past (V10)

`support.fsd`'s description names the framework, because the specialist answers questions about building with it, and FIX-1611 D1 fixes that wording. The table refuses "flow" as a word for a seat's kind; a product name that contains it is not that word. The exemption is the one string, `PROPER_NOUNS` in `run.mts`: "flow" anywhere else in a shipped string still fails, which the red states below show.

## Anti-game

A hollow pass would boot the app and assert what the boot reported about itself. So this check:

- MUST read every mailbox id, board name and kind name **off the tree**, so agreeing with a hardcoded string is not a route to green;
- MUST fail V6 if any file under `workforce/` carries a minted ledger id;
- MUST count the boot warnings, not merely find one;
- MUST assert V14 as a set, so a fan-out that told the wrong people is red and one that told nobody is not green by accident;
- MUST open the fixture's mailboxes through the session route, or V4 grades a store write.

## Red states

Every leg's red state is a mutation of the implementation (the app, the framework, or the fixture tree and the fixture kinds `run.mts` defines), not of the grading, except V14's writer half, which uses the app's own goal controls. Each was applied, run, and reverted. Taken on 2026-09-27; the result column is what the run printed.

| Leg | Make it fail by | Result |
|---|---|---|
| V1 | Empty the fixture's committed `mailboxKinds` map | V1 red twice (the map names `[]`; `--check` says the module is out of date). Nothing else |
| V3 | Delete `flow: digest` from `notices/MAILBOX.md` | V3 red (no mailbox selects a generated kind). Nothing else |
| V4 | Drop `transcript` from `digest`'s `stateSchema` | V4 red (state keys: members, instructions). Nothing else |
| V8 | Point the coder's `taskBoard` at `parked` | V8 red (the row is `completed`), and V9 (not isolating, below) |
| V9 (fixture) | Declare `parked` as a resource on the coder's kind | V9 red (0 warnings). Nothing else |
| V14 (fixture) | Drop the author check from the fixture's name-only line | V14 red: delivered to `eng.coder` and `eng.em`, the writer |
| V14 (fixture) | Route every member to the name-only line (`notify: nameOnlyLine`, no wake) | V14 red: delivered to `eng.coder` and `eng.listener`, who hears posts |
| V2 | Delete `...mailboxKinds` from `hire.ts` | V2 red. The app half stops. Nothing else |
| V5 | Return the minted ids from the mailbox's `read` (`packages/workforce/src`) | V5 red: the read listed `["support.help.escalations"]`. Nothing else |
| V6 | Write `support.help.escalations` into `workforce/blocks/escalate.ts` | V6 red. The app half stops |
| V9 (app) | `mailboxBoards: []` in `hire.ts` | V9 red (0 warnings; none names `escalations`). Nothing else |
| V10 | Write "agent" into `support.general`'s `description:` | V10 red. The app half stops |
| V10 | Write "flow" into the same description | V10 red: the proper-noun exemption does not swallow the word |
| V11 | Open nothing: `openMailboxes(workforce.mailboxes.slice(0, 0), …)` | V11 red twice, and V5 and V14 behind it (below) |
| V11b | Delete the `openMailboxes` call | V11b red (no module-scope statement). The app half stops |
| V11b | `void openMailboxes(…)` | V11b red (not awaited). The app half stops |
| V12 | Delete "It cannot hold a board…" from the published page | V12 red. The app half stops |
| V13 | Open the mailboxes as `"someone-else"` | **Stayed green.** See below |
| V14 (app) | `GOAL_CONTROL=no-author-filter` | V14 red: delivered to all four, the writer included |
| V14 (app) | `GOAL_CONTROL=name-only-notify` | V14 red: delivered to the three members who did not write |

## Red states that are not isolating

Said here rather than only in a report, because the next person to read the table will assume each row moves one leg.

- **V8**'s also fails **V9**, and no isolating form exists. A `taskBoard`'s drain declares the collection it runs, so a coder pointed at `parked` declares both boards and the hire warns about neither.
- **V11**'s *open nothing* cascades: with no mailbox open, the first read fails, so **V5** has nothing to compare, and the V14 probe's post fails. That is expected rather than a defect in the mutation.

## V13 and the app's resolver

Since FIX-1598 the app resolves every request to one principal, `devuser` in `kitchen-sink`, reading nothing from the request. The mailbox open goes through the app's own router, so the owner the config names is replaced by that principal, and the listing is scoped to it too. Opening the mailboxes as `"someone-else"` therefore leaves them owned by `devuser`: measured, V13 stays green. Taking the user out of the resolver as well, so the claimed owner would stick, stops the boot before the harness can report.

So V13 cannot fail on this app today. It stays because it costs nothing and would grade again the day the app resolves callers from the request; until then it is not evidence, and the verdict below does not count it.

## Why V11 is two legs

The spec asked for one behavioural leg here: *make the open fire-and-forget and the first read misses.* That leg cannot be trusted, and the reason is worth keeping.

An importer of a module with a top-level `await` is blocked by ESM until that module finishes evaluating. So an importer can never **observe** the state before the await — there is nothing to look at. All a test can observe is whether the open happened to finish before it looked, which is a race rather than the property. Measured on this app, with the open made fire-and-forget: the leg goes red as written, and inserting a single `setImmediate` before the read turns it green with the bug still in place. The whole discriminating margin is one event-loop turn, and it moves whenever anything on either path changes.

So the property is graded where it actually lives: in the shape of the statement (**V11b**), which is deterministic at any speed. The behavioural read stays as **V11**, grading what it can decide — that the boot opens the mailboxes at all. `run.mts`'s note on `moduleScopeCall` lists what the structural leg cannot catch.

**Model:** n/a — model-free.

**Run:** `pnpm tsx goals/workforce-conventions/a-mailbox-holds-the-work-a-seat-drains/run.mts`

**Controls:** `GOAL_CONTROL=no-author-filter` and `GOAL_CONTROL=name-only-notify` on the same command, for V14's writer half; each must FAIL at V14 (app) and nothing else. Every other red state is a hand mutation, in the table above.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-09-27 | FIX-1611 branch at ff0763ccc (fix/fix-1610 merged at 8bbcb2546) | n/a | **PASS** | **Re-pointed: two subjects.** Fixture: `eng.feature` opened on `mailbox` and `eng.notices` on `digest`, the latter's session carrying all three binder keys; the hire warned only about `parked`; `eng.em`'s post reached 3 of 3 members and was delivered to `eng.coder` alone, `eng.listener` hearing it silently; the drain left `parked`'s row pending. App: 8 shipped strings carry no refused word (one names `flow-state-dev`, read past); the minted `support.help.escalations` is in no file; `hire.ts` spreads the generated map; the open is an awaited module-scope statement; the config opened `support.help` before any call; its read lists `["escalations"]`; one warning, naming `escalations`; a member's post reached 4 of 4 and was delivered to nobody. V13 green and not counted. |
| 2026-09-27 | same, each red state applied and reverted | n/a | FAIL (expected) | **Every red state in the table**, run one at a time: each failed at the legs its row names, and at nothing else except the two non-isolating rows. V13's stayed green, as recorded. The same set gave the same lines on 315976e5f before the merge. One found a defect in this check: V4 passed with `transcript` dropped while the fixture's mailboxes were opened by a direct store write, which keeps what the schema would strip. The fixture now opens through the session route, and V4 fails as its row says. |
