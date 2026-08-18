# harness-workstream › it mirrors a coding run as workstream items

**Issue:** LAB-133
**Outcome:** You can hand a coding job to an agent, get your request back straight away, and
afterwards say what the run did without ever opening the harness transcript. The run has its own
place in the system — a background job attached to the conversation that started it — and its
top-level activity is readable, in order, from state alone.
**Input:** `fixtures/input.json` — the workstream topic, the file the run is asked to write, the
marker line it must write into it, and the second line. Held out: every assertion keys on these
values round-tripped through the real dispatch, so a different valid fixture must still pass a
correct implementation.
**Signal:** A workstream row appears under the originating session (`{ workstreams: [...] }`,
carrying the held-out topic and a different session id), and
`GET /sessions/:childId/requests?include_items=true` returns that run's top-level `message` and
`tool_output` items, non-decreasing on `itemIndex` per request, with the run's activity preceding
the report it wrote about that activity, and naming the held-out file somewhere in what the run
said **or** did. The same read *without* `include_items=true` must return no items — otherwise the
adapter is ignoring the flag and the readback proves nothing. The originating request's own stream
must carry none of the run's mirrored items (`message` / `reasoning` / `tool_output` /
`container`, or anything attributed to the agent block).

Three of those readings are worded against a mistake this goal actually made, so they are pinned
rather than paraphrased:

- **`itemIndex`, and a missing field is a FAIL.** The first version read `seq`, which does not
  exist on a stored item — so the numeric filter produced an empty array, monotonicity was
  vacuously true, and the goal printed "in non-decreasing sequence" having measured nothing. The
  two orderings are meant to be independent readings and only the coarse one was live; a
  regression scrambling intermediate items would have sailed through.
- **The file name may be named by the run's activity, not only its prose.** Keying it on the
  closing sentence grades the model's phrasing rather than the mirror, and failed a run that had
  mirrored the job perfectly.
- **The leak check is on item kind, not marker text.** The marker is part of the job the
  conversation wrote, so it legitimately appears in the parent's stream when the board publishes
  the filed row.
**Anti-game:** Must not read the SDK transcript, the working tree (including the file the run was
asked to write), or git. Must not assert on whether the coding agent did a **good** job — that is
LAB-135's question. Must not assert on **how the run was settled** — the task row's status, the
workstream request's status, retries, or whether a lost run stayed recoverable. Settlement is
deliberately out of scope (FIX-1182); this board takes the task board's defaults, which means a
lost run is **written off** rather than re-claimed. That is a stated gap, not a bug this goal
should be extended to cover. A run that completes with an empty item stream is a FAIL, not a pass.
**Model:** real — the Claude Code Agent SDK resolves its own model; the flow declares no
generator actions.
**Store adapter:** `@flow-state-dev/store-sqlite`, named deliberately. `withItems` is advisory and
the in-memory store ignores it by documented contract, so `include_items=true` is only observable
on an adapter that branches on the flag.
**Run:** `pnpm tsx goals/harness-workstream/mirrors-a-coding-run-as-workstream-items/run.mts`

## Verdict log

Two earlier PASS rows were **deleted rather than relabelled**. They cited the PR's base commit
rather than the implementing one, and — the reason relabelling would not have been enough — they
both attested "non-decreasing sequence", which is the one claim the blind `seq` check never made.
A wrong claim does not become right by correcting the commit beside it.

| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|

