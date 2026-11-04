# teammates-lab › it shows a worker's steps while it works

**Issue:** FIX-2393 (epic FIX-2369)

**Outcome:** You ask a Teammates worker something it has to look up in the working folder. While
it works, its tool steps show in your conversation with it, each saying what it acted on ("Read
…/next/plan.md"), not only in a popup. A run of steps is one line, open while it runs, and it folds
once the turn is done.

**Input:** `fixtures/input.json`: the worker (`teammates.researcher`), the path of the one file that
holds the value, that file's text with a `{value}` slot, some decoy files, and two wordings of the
question, one drawn per run. The value is new each run (`ORCHID-<4 digits>`) and sits on its own
line under a heading, so a search for the question's words finds the heading, not the value: only a
read gets it. **Held out**: another folder, path and wording pass a correct lab.

**Signal:** `fsdev dev --app @flow-state-dev/teammates` on a fresh store over the seeded checkout.
The check opens the worker's conversation and sends the question through the lab's own adapter
(`labs/teammates/src/adapter.ts`), and grades every view its `watchConversation` hands the screen.
That watch reads the session through the client's `sessionFeed`, so it is what the conversation
draws.

- *steps during the turn*: a view from before the answer landed holds a run of steps with a step
  naming one of the working folder's files.
- *folded after*: once the answer naming the value lands and the turn ends, the turn shows at least
  one run of steps, and every one reads done (or failed) and closed.

Each signal passes in every one of `GOAL_RUNS` (3) fresh runs. A run whose answer never names the
value is not graded: it throws.

**Anti-game:** Graded on the adapter's entries, not on the session's items, so a lab that keeps the
steps in the popup only fails. The value is new each run and lives only in one file's body. The
file check reads the step's own words, not the tool's name.

**Model:** real: `openai/gpt-6-luna` (the lab's default), through the AI Gateway. No coding harness
runs.

**Run:** `pnpm tsx goals/teammates-lab/shows-a-workers-steps/run.mts` (needs `AI_GATEWAY_API_KEY`,
and the lab's pages built: `pnpm --filter @flow-state-dev/teammates build`).

**Controls:** on the same command:

- `GOAL_CONTROL=popup-only`: the adapter's conversation draws no tool steps, as before this change
  (a scratch patch to `labs/teammates/src/adapter.ts`, applied as this check's own process loads
  it); the popup still does. *steps during the turn* must FAIL in every run.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-04 | f3b19ba4 + this change | openai/gpt-6-luna | FAIL 1/3 | Run 3 searched and answered from the match: no read, so no step named a file. The value moved onto its own line under a heading |
| 2026-11-04 | f3b19ba4 + this change | openai/gpt-6-luna | PASS 3/3 | Each run showed "Read …/releases/next/plan.md" in 35 to 40 views before the answer; after, one run per turn, done and closed ("Searched the code and read a file") |
| 2026-11-04 | f3b19ba4 + this change | openai/gpt-6-luna | control `popup-only`: FAIL as required | All 3 runs: no view held a run of steps, before or after the answer |
