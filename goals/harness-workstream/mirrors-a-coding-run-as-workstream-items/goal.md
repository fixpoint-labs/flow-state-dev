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

**The graders sanity-check themselves before the runs start.** Two of this goal's assertions were
found passing the exact world they existed to reject — one counted file owners instead of naming
the run it expected (so two runs merged into one namespace still gave every file exactly one
owner), the other treated a missing `previousStatus` as evidence of a move (so a recorder that
kept only a final status graded as having preserved the transitions). Both now run against their
broken world at goal start, before any dispatch; a grader that accepts what it should reject
fails the goal immediately. This is not ceremony — the plan grader **cannot** be reached by a
real run while the plan arm stays INCONCLUSIVE, and the file grader's broken world is not
reachable through the current recorder at all, so neither would ever have been exercised.

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

Round 10 was spent on a sweep rather than on the two findings that prompted it, because both were
instances of a class already named in round 9: **a rule applied on one side of an axis and not the
other.** Each fix from rounds 5–9 was re-read against three axes — ordering (does it hold when the
events arrive the other way round?), polarity (does it hold for a failure as well as a success?),
and presence (does it hold when the field, or the other subject, is absent?) — and checked for
whether a test actually reaches the other side. Three instances came out of it: two reported, one
found by the sweep. The reason to record this rather than the fixes is that the suite could not
see any of them, and two of the three sat directly beside a test that looked like coverage.

The first three rows below ran on **pre-commit working trees**, and each differs from `2f066e7c2`
in a way that matters to what it measured — which is why they say so instead of borrowing the
commit hash. Citing a commit the run was not made on is the mistake the two deleted rows above
were deleted for, and it is no less wrong when the difference is small.

| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-08-18 | working tree, pre-commit (plan tools **absent** from `allowedTools`) | claude-sonnet-5 (SDK default) | FAIL (plan arm INCONCLUSIVE) | The first real run of the LAB-134 half. File half green end to end. Plan arm INCONCLUSIVE — and the first suspect was this check's own configuration, not the harness: the job asked for a to-do list while the tools that keep one were not in `allowedTools`. Fixed, then re-measured below |
| 2026-08-18 | working tree, pre-commit (`maxTurns: 8`) | claude-sonnet-5 (SDK default) | FAIL (plan arm INCONCLUSIVE) | With the plan tools in `allowedTools`. 2 file rows in 2 run namespaces in one **reused** workstream, `created`/`applied`, each naming its own held-out file and no other's; **0** full-prefix loads of the recorded collections during the runs; board ledger holds 2 rows for 2 dispatches; 0 gap rows. Plan arm INCONCLUSIVE — 0 plan tool calls; tools used: `Bash`, `Write`. Rules out `allowedTools` |
| 2026-08-18 | `2f066e7c2` (behaviour-identical; only comment wording and this file changed after) | claude-sonnet-5 (SDK default) | FAIL (plan arm INCONCLUSIVE) | Same shape, with `maxTurns` raised 8 → 16. Rules out the turn budget too, which is what makes the arm a statement about the harness rather than about this file |
| 2026-08-18 | post-review (round 10 sweep) | — | FAIL *(deliberate)* | 4 mutations, each restoring one instance of the same class — a rule applied on one side of an axis and not the other: the caller guessing which call a held outcome describes (ordering), the wrong-subject guard reached only by successes and not refusals (polarity), that guard skipped entirely on errored file results under an approval seam (polarity), and files and plan items sharing one in-flight keyspace (presence). 4/4 caught. The finding is what happened BEFORE the tests were written: all **176** existing tests passed with all four fixes applied (the suite is 181 with the new ones), so none of the four worlds was reachable by the suite — including two the suite appeared to cover, where the covering test used the arrangement that happens to be right. The round's own commit message and first PR note said 181 for the before-count, which is the after-count; corrected here and on the PR. Getting a scoped-to-what-was-measured number wrong, in the round about claims outrunning their evidence, is worth leaving in the log rather than quietly fixing |
| 2026-08-18 | post-review (round 9 fixes) | — | FAIL *(deliberate)* | 7 mutations: an unconfirmable path settling as applied under an approval seam, that gap firing without one, a held settlement overwriting the unfinished call's kind, gap rows losing the record they stand in for, retry attempts sharing a namespace, the ordering-unknowable flag never latching, and the harness's own `from` discarded once ordering is unknowable. 7/7 caught. A self-found concurrency fix in the same round was caught INCOMPLETE by its own test — suppressing derivation only while calls overlapped still let the last settler read an out-of-order sibling's value |
| 2026-08-18 | post-review (round 8 fixes) | — | FAIL *(deliberate)* | 6 mutations: delivery interleaving with the emission await, a settling call ignoring others open on the same row, a row never settling, a confirmed-without-value re-wording recorded from the request, that value dropped when nothing could revise it, and the approval seam no longer marking inputs revisable. 6/6 caught. The last was added after noticing the WIRING was unguarded — the translate tests set the flag directly, so nothing checked that the option set it |
| 2026-08-18 | post-review (round 7 sweep) | — | FAIL *(deliberate)* | 7 mutations of the can't-tell-about-confirmation rule: a mismatched item id gapping AND settling, an unattributable batch settling silently, a batch gapping when it settled no recorded work or had nothing to discard, a no-op update leaving the confirmed status unrecorded or inventing a transition, and a diverging file path settling an unconfirmed write. 7/7 caught first time |
| 2026-08-18 | post-review (round 6 sweep) | — | FAIL *(deliberate)* | 8 mutations, one per instance of the swept rule (*the record reflects what the harness confirms, not what the agent asked for*): the create subject and its fallback, an in-band `success: false`, the transition's `from` and its `to`, unapplied fields recorded anyway, an update applied to a different item, and the recorder preferring its own derivation. 8/8 caught. Two first stayed green because the fixture had the requested and reported values EQUAL, making the preference invisible; both gained a world where they differ |
| 2026-08-18 | post-review (round 5 fixes) | — | FAIL *(deliberate)* | 3 mutations: recorder shutdown moved back onto the happy path (so item-finalization throwing skips it), the settled file kind reusing the call-time guess instead of what the harness reported, and a reported kind trusted on a failure. 3/3 caught. As in round 4, one mutation first stayed green — the failure test carried no structured output, so the guard it targeted was unobservable — and the test gained the world that isolates it |
| 2026-08-18 | post-review (round 4 fixes) | — | FAIL *(deliberate)* | 3 mutations of the goal's OWN graders, each restoring an assertion that passed the world it existed to reject: attribution counting owners instead of naming the expected run, attribution ignoring the runs that must not own the file, and a missing `previousStatus` counting as a move. 3/3 caught by the grader self-check — which is the only way they could be caught, since the plan grader is unreachable while the arm stays INCONCLUSIVE and the file grader's broken world is unreachable through the current recorder. A first attempt at the attribution mutation slipped through and exposed that the assertion's two halves masked each other; the self-check gained the world that isolates them |
| 2026-08-18 | post-review (round 3 fixes) | — | FAIL *(deliberate)* | 7 mutations: the run namespace reverting to the bare request id, an unstable no-identity fallback, an interrupted plan create dropped instead of drained, the drain over-reporting work that already recorded an attempt, the agent never draining at stream end, gaps snapshotted before the drains that raise them, and `stop()` not awaiting the in-flight write. 7/7 caught. An eighth mutation **stayed green** and that was the point: it showed the reported shutdown race does not reproduce, because the gaps-last ordering already covers it — so the proposed fix was reverted and the ordering it relies on got the test instead |
| 2026-08-18 | post-review (round 2 fixes) | — | FAIL *(deliberate)* | 7 further mutations, each restoring a defect review round 2 found, broken and observed red then reverted: the reporting hook called unguarded from the flush chain (both call sites), settlement keying under the harness's resolved path (the phantom `pending` row), a real path divergence swallowed, the divergence check comparing raw strings instead of canonical keys, a successful `TaskUpdate`'s new wording dropped, and a refused one's wording applied anyway. 7/7 caught |
| 2026-08-18 | `2f066e7c2` | — | FAIL *(deliberate)* | 13 mutations of the LAB-134 guards, each broken on purpose and observed red, then reverted: failed-mutation outcome, resolved-path preference, the two-results attribution guard, prose id recovery, a rejected update applying its status, a pathless file tool silently dropped, per-run keying, the durable gap row, a throwing write propagating, path relativisation reintroducing `..`, `client.state.read`, `prefetchMode: "lazy"`, and the capability forwarding the option instead of declaring the collections. 13/13 caught |
| 2026-08-18 | `0a2dfcfb6` | claude-sonnet-5 (SDK default) | PASS | 21 items with `include_items=true`, **0** without; 1 top-level message, 2 top-level tool_outputs; non-decreasing on `itemIndex` 0–20; names the held-out file; the originating request carried none of the run's mirrored items |
| 2026-08-18 | `0a2dfcfb6` | claude-sonnet-5 (SDK default) | PASS | second consecutive run — 22 items / 0 without, `itemIndex` 0–21, same shape |
| 2026-08-18 | `0a2dfcfb6` | — | FAIL *(deliberate)* | `ORDER_FIELD` pointed at `seq` on purpose: *"could not read the item ordering on request 1: 20 of 20 items carry no numeric `seq`"*. The same conditions under which the previous version printed PASS |

