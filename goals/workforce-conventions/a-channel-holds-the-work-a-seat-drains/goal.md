# workforce-conventions › a channel holds the work, a seat drains it

**Issue:** FIX-1476 (checks V1–V12 of the spec's Checks table)

**Outcome:** Somebody clones the reference app and finds channels in it. Three `CHANNEL.md` files under one team: an ordinary channel holding two boards, a one-member channel that needed no kind of its own, and one that genuinely did. One seat is wired to one of the two boards, and the boot says out loud that nobody is watching the other.

**Input:** `apps/kitchen-sink` itself — its real `workforce/` tree and its real `fsdev.config.ts`. **Not a fixture.** Every other goal in this folder points the loader at its own `fixtures/workforce/`; the claim here is about what a reader of the reference app finds, so the app is the subject. Held out: every channel id, board name, kind name and ledger id is read off the tree at run time. Rename a channel folder or a board and a correct implementation still passes.

**Expect this goal to be slow.** Importing the app's real config boots the whole runtime — every flow, every store profile, the hire and the channel open. That is the cost of proving the app's own wiring rather than a fixture's, and `goal:all` should budget for it.

**Signal:** thirteen legs, model-free, over the app's own boot and its real HTTP router.

**Not re-proved here:** board mechanics. `channel-boards/it-runs-a-row-a-file-declared-board-holds` already covers mint → file → drain → completed and passes. What this adds is the two behaviours that goal cannot reach — the **warning** and the **subset** drain — and the structural legs that say *this app's* tree is wired.

## The legs

Read before the boot, so a tree that disagrees with itself costs no runtime:

- **V1 — the generated map names the kind file.** `channelKinds` in the committed `workforce.gen.ts` holds exactly the basenames under `flows/channels/`, each imported from there. This asserts the map's **content**. Staleness — that the committed module matches what the tree renders — is CI's own `fsdev gen --check` over this same app, and `--check` never reads what the map contains: it passes with an empty map.
- **V2 — no hand-written kind name in the wiring.** `hire.ts` spreads `...channelKinds`, and neither it nor `fsdev.config.ts` writes any generated kind's name as a string. The built-in's seed key `channel` is the framework's, not a kind of this app's.
- **V6 — the minted id is in no file.** No file under `workforce/` contains `<channelId>.<boardName>` for any declared board. The pair in the runner kind is the explicit wiring and is expected; the mint is the framework's.
- **V10 — the vocabulary.** No `description:`, charter, board name or channel id under `workforce/` uses a word from the *is not* column of the spec's vocabulary table. Scoped to what this issue ships; it does not reach a component label and does not claim to.
- **V12 — the published page states both costs.** `apps/docs/docs/workforce/channels.md` says a custom kind cannot hold a board, and that re-opening is not a migration. Both are framework behaviour a copier otherwise meets as a surprise.

Then the boot, driven by `harness.mts` inside the app:

- **V11 — the boot opened them, and the check opened nothing.** The harness reads every declared channel's session immediately after the config module's import resolves, and calls no open of its own. What it grades is that the *config* opens the tree's channels, early enough that nothing is opened lazily on first use. Its red state is the call being gone.
- **V11b — the open is an awaited module-scope statement.** Read off `fsdev.config.ts`'s syntax tree: one top-level statement, `await openChannels(…)`. **Structural, and here that is the right instrument rather than a fallback** — see *Why V11 is two legs* below.
- **V3 — each channel opened on the kind its file selected.** The one naming `flow:` comes back on that kind; the two that name none come back on the built-in.
- **V4 — the custom kind admits what the binder writes.** Its open session carries all three keys the binder writes. A `stateSchema` that omits one **strips it silently** — session create does not refuse a state-schema mismatch — so this is about a key going missing, not about an error.
- **V5 — the channel says what it holds, by name.** The board-holding channel's own `read` returns the local names its file declared, as a whole-array equality. Compared sorted on both sides: the framework sorts the minted ids a kind is built with, so declaration order is not preserved and asserting it would be asserting the sort.
- **V9 — exactly one unattended-board warning.** One per board no hired flow declares, naming that board; none for the board a seat does declare. `console.warn` is captured **before** the config is imported, because the warning is emitted during the hire, inside that module's evaluation.
- **V7 — the row is claimed, run, and settled on the minted ledger.** One row filed through the channel's own `fileTask`, then the seat's drain, handed nothing. Proof of execution is the note the worker body wrote **outside** the board, read straight out of org-scoped storage — the board's own report is generated on the path under test. The row then reads `completed` from `readBoard` **and** out of `resourceState` under the minted id.
- **V8 — the drain is a subset.** A row filed on the unwired board is still `pending` after the drain runs.

## Anti-game

A hollow pass would boot the app, call a drain, and assert the drain reported success — true even when the seat and the channel are talking about two different ledgers, and true when nothing ran at all. So this check:

- MUST prove execution by an effect **outside** the board, since the board's report is generated on the same path being tested;
- MUST assert the row **out of storage under the minted id**, not merely that some board holds a completed row;
- MUST read every channel id, board name and kind name **off the tree**, so agreeing with a hardcoded string is not a route to green;
- MUST fail V6 if any file under `workforce/` carries a minted ledger id;
- MUST count the boot warnings, not merely find one — the failure this issue ships to make visible is a board nobody watches, and a check that accepted "at least one warning" would pass an app that warned about both boards.

## Red states

Every leg's red state is a mutation of the implementation, not of this file. `GOAL_CONTROL` is deliberately absent: the subject is the app's own tree, so a perturbation that lived in the harness would be testing the harness.

| Leg | Make it fail by |
|---|---|
| V1 | Revert `workforce/workforce.gen.ts` to an empty `channelKinds` map |
| V2 | Write the kind's name into `hire.ts` by hand instead of spreading the generated map |
| V3 | Delete the `flow:` line from the channel that names a kind |
| V4 | Drop `transcript` from that kind's `stateSchema` |
| V5 | Return every board in the process from the channel's `read`, or return the minted ids |
| V6 | Use the minted id as the resource key in the runner kind instead of `followups.id` |
| V7 | Point the runner at `channelBoard("support.other", "followups")` — everything compiles, every id is well-formed, and the row stays `pending` with no note written |
| V8 | Add the unwired board to the runner's resources — it is claimed, and the subset claim is gone |
| V9 | Wire the unwired board (count 0), or drop the runner's declaration (count 2) |
| V10 | Write a refused word into a `description:` or a charter |
| V11 | Delete the `openChannels` call from `fsdev.config.ts` — nothing opens the tree's channels and the first read meets an empty session |
| V11b | Change `await openChannels(…)` to `void openChannels(…)` |
| V12 | Delete either sentence from the published page |

## Why V11 is two legs

The spec asked for one behavioural leg here: *make the open fire-and-forget and the first read misses.* That leg cannot be trusted, and the reason is worth keeping.

An importer of a module with a top-level `await` is blocked by ESM until that module finishes evaluating. So an importer can never **observe** the state before the await — there is nothing to look at. All a test can observe is whether the open happened to finish before it looked, which is a race rather than the property. Measured on this app, with the open made fire-and-forget: the leg goes red as written, and inserting a single `setImmediate` before the read turns it green with the bug still in place. The whole discriminating margin is one event-loop turn, and it moves whenever anything on either path changes — it was green-under-mutation before this app's boot grew an eager `getRuntime()` above the open, and it will be again.

So the property is graded where it actually lives: in the shape of the statement (**V11b**), which is deterministic at any speed. The behavioural read stays as **V11**, grading what it can decide — that the boot opens the channels at all. `run.mts`'s note on `moduleScopeCall` lists what the structural leg cannot catch.

**Run:** `pnpm tsx goals/workforce-conventions/a-channel-holds-the-work-a-seat-drains/run.mts`
