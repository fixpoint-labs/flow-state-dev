# kits › research returns a cited report

**Outcome:** An app installs `research()` and receives a cited report from a planned run that searches, fetches, crawls, and survives one flaky fetch.
**Input:** The fixture app asks “What does the fixture document?”. Its search, page and crawl are deterministic retrieval fixtures; the first fetch throws and the retry succeeds.
**Signal:** `fsdev run` returns a report with a non-empty finding and citation list, every citation occurs in the returned retrieved-source list, and the preserved task state has one completed task and its typed result.
**Anti-game:** The check grades the running app's captured action output, not the kit factory. The first fetch always fails, so a pass proves task rescue. Every graded list is floored with `tell.over`.
**Model:** Scripted generators drive planning, tool calls, evaluation and synthesis; no vendor key or live web is used.
**Run:** `pnpm tsx goals/kits/research-returns-a-cited-report/run.mts`
**Controls:**
- `GOAL_CONTROL=invent-citation` makes synthesis cite an unobserved URL. Citation validation must fail the run.
- `GOAL_CONTROL=invent-executor-source` makes the executor claim an unobserved URL. Runtime retrieval provenance must keep it out of a valid report, so the goal must fail.
- `GOAL_CONTROL=no-rescue` makes every fetch attempt fail. The task cannot complete, so the goal must fail.
