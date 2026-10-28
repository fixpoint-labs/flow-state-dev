# history-window › it remembers turns past the window

**Issue:** FIX-1613 (with FIX-2154 G1)
**Outcome:** A conversation longer than its history window still answers from what was said before the window. The person tells the chat something in turn 1, talks about other things until turn 1 has left the window, then asks for it back and gets it.
**Input:** The goal's own chat flow: an answer generator with `history: true` that installs `utility.historySummary(...).capability` and runs its `fold` step first, with core's `summarizer` as the summarize block. SQLite store, no memory capability, a real model. The fact (a sailboat name of a colour, an animal and a number) is picked at run time and the filler questions are shuffled, from `fixtures/conversation.json`. Default window 8 and 14 turns; `GOAL_WINDOW=50 GOAL_TURNS=60` must pass too. Each conversation's host is disposed and started again on the same SQLite file the turn after the first fold.
**Signal:**
- `w:answer` the last answer holds all three words of the fact, in every run (`GOAL_RUNS`, default 3).
- `w:out-of-window` none of the user or assistant messages the answer model was sent on the last turn holds the fact; read from the model calls themselves, recorded by wrapping the model resolver.
- `w:mark` the last request in `client.sessions.requests` carries `historyStart` naming a turn of the session, and the session's `historySummary` resource, read through `client.sessions.state`, is `complete: true` through a turn of the session.
- `w:folds` at least `min(3, folds the rule predicts)` folds ran, at least one after the restart, and the stored summary is under 4,000 characters.
**Anti-game:** Nothing asserts on the summary's wording, and the summarize block is the real `summarizer` on the real model: a mocked summarizer, or a check on the summary text, passes while the answer generator never sees it. The flow has no memory and its prompt never holds the fact. Every graded list is floored with `tell.over`, so an empty read (no requests, no recorded model call, no answer) is CAN'T TELL, not PASS.
**Model:** real — openai/gpt-5.4-mini, through the AI Gateway (`goalModel`)
**Run:** `pnpm tsx goals/history-window/remembers-turns-past-the-window/run.mts`
**Controls:**
- `GOAL_CONTROL=no-summary` builds the flow without the capability and the fold step (the flow as it was before). Must fail `w:answer`.
- `GOAL_CONTROL=no-mark` patches out the engine's `historyStart` write (main before this change). Must fail `w:mark`.

The summarizer is configured with an objective that names its input: `summary` is the summary so far and `turns` the newer turns. Without it, `gpt-5.4-mini` sometimes summarized only the new turns and dropped the fact (2 of 8 conversations on 2026-10-28); with it, 6 of 6 kept it.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-28 | fa17caf | openai/gpt-5.4-mini | FAIL (expected) | `GOAL_CONTROL=no-summary`: `w:answer` "I don't have that information."; `w:mark` and `w:folds` fail too (no resource) |
| 2026-10-28 | fa17caf | openai/gpt-5.4-mini | FAIL (expected) | `GOAL_CONTROL=no-mark`: only `w:mark` fails, "the last request carries no historyStart"; the answer still held the fact |
| 2026-10-28 | fa17caf | openai/gpt-5.4-mini | PASS | 3 of 3 answers held the fact (6 of 6 earlier, before the answer's replies were kept in history); 4 folds each (1 before the restart), summaries 1,254–1,777 characters; the answer model read 11 messages, user and assistant, all after the mark |
| 2026-10-28 | fa17caf | openai/gpt-5.4-mini | PASS | `GOAL_WINDOW=50 GOAL_TURNS=60 GOAL_RUNS=1`: 2 folds, the second after the restart before turn 41; answer held the fact ("teal lynx 731"), rerun after the summarizer objective and `itemVisibility` were added |
