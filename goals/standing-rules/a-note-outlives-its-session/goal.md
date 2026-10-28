# standing-rules › it keeps a note past its session

**Issue:** FIX-1945

**Outcome:** A person tells a worker "from now on, do X" once. Every later conversation they have with that worker follows it, including after the server restarts, until they ask the worker to change or drop it, or edit it on the Rules page. Someone else talking to the same worker never gets it. When the list is full, a new note is refused where the person can see it, and nothing already on the list is lost.

**Input:** DevTeam's Shift Manager install, served by its own command over a store the run owns, run twice: once with the Shift Coordinator (a `coordinator` worker) and once with the researcher (an ordinary `agent` worker). Alice and Bob are the install's owner and member (`LAB_USERS`), each with their own verified bearer. The notes are "From now on, start every reply with `Noted —`." and "From now on, end every reply with `— Shift Coordinator`.". Each later session asks something unrelated that the worker answers itself. Held out: swap the markers or the asks and a correct build still passes, since every check reads the markers from the run's constants.

**Signal:** each count is over 3 fresh sessions. A marker counts only at the very start or end of the reply, after markdown emphasis (`*`, `_`, backticks, quotes) and trailing punctuation are peeled off the two ends. Failures are tagged `[<worker>] <leg>`.

- **next-session-follows**: session 1 shows two "✎ Rule added" lines. After a restart, 3 of 3 fresh sessions open with `Noted —` and close with `— Shift Coordinator`.
- **person-scoped**: right after that, Bob's 3 fresh sessions with the same worker carry neither marker.
- **worker-edits**: Alice asks in words to change the opening to `Got it —`, and a "✎ Rule … changed" line shows. The next 3 sessions open with `Got it —` and never mention `Noted —`. She asks to drop it, and a "✎ Rule … removed" line shows. The next 3 open with neither and still close with `— Shift Coordinator`.
- **page-edit-takes**: the closing is changed to `— Shift` through the worker-flow action the Rules page calls (`createWorkforceClient().standingRules`). The next 3 sessions close with `— Shift` and not `— Shift Coordinator`.
- **cap-honest**: the page fills the list to 20, then Alice asks in words for one more rule. A "✎ Rule not added … 20 of 20" line shows, and the page's read of the 20 rules is unchanged.

**Anti-game:** no marker text appears in any later prompt, worker file or ask. The check grades replies, and the lines the person sees, read back from the session that stored them, by request id. It never reads the rules record or a tool call. The page action is the input for page-edit-takes and the oracle only for cap-honest's "unchanged", which is what the Rules page itself would show. A worker that echoed the marker from its session history can't pass, because every graded session is new.

**Model:** real. The researcher runs on `openai/gpt-5.4-mini`; the Shift Coordinator on the model its `WORKER.md` names, through the environment's gateway. With no model credential the check says it is blocked rather than passing.

**Run:** `pnpm tsx goals/standing-rules/a-note-outlives-its-session/run.mts` (`GOAL_WORKERS=researcher` or `shift-coordinator` runs one).

**Controls:** `GOAL_CONTROL=no-rules-context` swaps `packages/workforce/src/standing-rules/rules-capability.ts`'s context entry for one that returns nothing, as the server loads it (`module-patch`), and fails at setup if the patch never reached the module. The tools still save the notes, so only a later session can tell. It must fail **next-session-follows**, and stops after **person-scoped**.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-14 | 1e11dc8f+FIX-1945 PR A (uncommitted) | openai/gpt-5.4-mini (vercel gateway) | FAIL (control `no-rules-context`, expected) | researcher: session 1 showed both "Rule added" lines; only `[researcher] next-session-follows`: 0 of 3 carried the markers ("Teams pin dependency versions to make builds reproducible…"). Bob's sessions carried neither. |
| 2026-10-14 | same | openai/gpt-5.4-mini (vercel gateway) | PASS | researcher: 3/3 after a restart opened `Noted —` and closed `— CoS`; Bob 0/3; after the change in words 3/3 `Got it —` only; after the drop 3/3 neither, `— CoS` kept; after the page edit 3/3 `— Shift` only; the 21st showed "✎ Rule not added: the list is full (20 of 20); merge or drop a rule before adding one." and the 20 were unchanged. |
| 2026-10-14 | same | anthropic/claude-haiku-5-5 (chief of staff's own, vercel gateway) | FAIL (control `no-rules-context`, expected) | chief-of-staff: only `[chief-of-staff] next-session-follows`: 0 of 3 carried the markers ("Your team has these workers: …"). |
| 2026-10-14 | same | anthropic/claude-haiku-5-5 (vercel gateway) | PASS | chief-of-staff: every leg as the researcher's, same counts and the same refusal line. |
