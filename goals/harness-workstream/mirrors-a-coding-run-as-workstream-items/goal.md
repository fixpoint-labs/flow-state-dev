# harness-workstream › it mirrors a coding run as workstream items

**Issue:** LAB-133, extended by LAB-134
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
## What LAB-134 adds: the run's own record of what it DID

Two real runs are dispatched into the same workstream, and the records they wrote as they
worked are read back over the list-collection-state route — scoped to each run's own
namespace with `topicPrefix`, following `nextCursor`.

**Signal:** `observed-file-ops` names each run's held-out file under that run's namespace and
no other's, with `lastKind: "created"` and `outcome: "applied"` on `clientData`; the board's
ledger holds exactly one task row per dispatch, so the runs' own to-do items did not become
queued work; the recorded collections are bulk-loaded by prefix **zero** times during the
runs; and `observed-gaps` accounts for anything the recorder could not record.

Three readings are worded against a specific way this check can go blind:

- **A row's payload is on `clientData`, not `state`.** Reading `state` returns `undefined`
  after a valid 200 — the same shape as the `seq` bug below.
- **`topicPrefix` is matched against the STORAGE key, and the page defaults to 50.** An
  unscoped read returns the first page of the whole collection, which in a reused workstream
  can be another run's rows entirely.
- **The board-ledger read is sanity-checked against a known case.** Two dispatches filed two
  rows, so a read returning *no* rows means the read is wrong, not that the board is empty —
  and it is graded as a failure of the instrument rather than as "no queued work".

**The plan half is graded PASS / FAIL / INCONCLUSIVE, and must say which.** The plan surface is
optional at the source. The two causes of an empty plan record need opposite verdicts, and they
are distinguishable from FSD state alone — the run's own item stream carries a `tool_output`
for every tool it called.

| Plan tools invoked? | Plan rows present? | Verdict |
|---|---|---|
| yes | yes | **PASS** |
| yes | no | **FAIL** — the tools fired and we recorded nothing; our bug |
| no | — | **INCONCLUSIVE** — the run never planned; nothing was measured |

INCONCLUSIVE **is not a pass**: it exits non-zero and names why it fired. It also prints the
tool names the runs *did* use, because the arm's own failure mode is a detector that cannot see
what it is deciding about — if the harness renames its plan tools, "no plan tools fired" and "we
no longer recognise them" look identical from here.

**`edited` is not graded here.** The job creates a file, so `created` is the kind it implies;
forcing a real run to reach for `Edit` rather than a second `Write` is not something a job can
guarantee. That kind is covered at unit level.

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

Every LAB-134 row records the **arm the plan half took**, per §10. It has taken the same one
every time so far, and that is the finding rather than a footnote: across four runs of this
check — eight real coding runs — the plan tools were invoked **zero** times through the
in-process Agent SDK path. The same binary driven directly through the CLI used
`TaskCreate`/`TaskUpdate` on the first attempt. Two of our own configuration suspects have been
ruled out by measurement (the plan tools were added to `allowedTools`; the turn budget was
raised from 8 to 16), and neither changed the outcome. **The goal's PASS branch for the plan
half has therefore never executed against real data** — its assertions are covered at unit
level, against the shapes a real run produced, but the end-to-end path is unexercised and
should not be read as proven.

| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-08-18 | `76e0566bf` | claude-sonnet-5 (SDK default) | FAIL (plan arm INCONCLUSIVE) | File half green end to end: 2 file rows in 2 run namespaces in one **reused** workstream, `created`/`applied`, each naming its own held-out file and no other's; **0** full-prefix loads of the recorded collections during the runs; board ledger holds 2 rows for 2 dispatches; 0 gap rows. Plan arm INCONCLUSIVE — 0 plan tool calls; tools used: `Bash`, `Write` |
| 2026-08-18 | `76e0566bf` | claude-sonnet-5 (SDK default) | FAIL (plan arm INCONCLUSIVE) | Second consecutive run, same shape. Confirms `allowedTools` was not the cause — the plan tools were in it, and the runs still used `Bash` and `Write` only |
| 2026-08-18 | `76e0566bf` | claude-sonnet-5 (SDK default) | FAIL (plan arm INCONCLUSIVE) | Third, with `maxTurns` raised 8 → 16. Rules out the turn budget too |
| 2026-08-18 | `76e0566bf` | — | FAIL *(deliberate)* | 13 mutations of the LAB-134 guards, each broken on purpose and observed red, then reverted: failed-mutation outcome, resolved-path preference, the two-results attribution guard, prose id recovery, a rejected update applying its status, a pathless file tool silently dropped, per-run keying, the durable gap row, a throwing write propagating, path relativisation reintroducing `..`, `client.state.read`, `prefetchMode: "lazy"`, and the capability forwarding the option instead of declaring the collections. 13/13 caught |
| 2026-08-18 | `0a2dfcfb6` | claude-sonnet-5 (SDK default) | PASS | 21 items with `include_items=true`, **0** without; 1 top-level message, 2 top-level tool_outputs; non-decreasing on `itemIndex` 0–20; names the held-out file; the originating request carried none of the run's mirrored items |
| 2026-08-18 | `0a2dfcfb6` | claude-sonnet-5 (SDK default) | PASS | second consecutive run — 22 items / 0 without, `itemIndex` 0–21, same shape |
| 2026-08-18 | `0a2dfcfb6` | — | FAIL *(deliberate)* | `ORDER_FIELD` pointed at `seq` on purpose: *"could not read the item ordering on request 1: 20 of 20 items carry no numeric `seq`"*. The same conditions under which the previous version printed PASS |

