# workforce-seats › a seat reaches the documents its file names

**Issue:** FIX-1381 (seat resource allowlist); rewritten for FIX-1788 (V7, BR-24): workers share one copy of their flow, and the grants narrow what each turn's model reaches.

**Outcome:** An org puts two documents in its workforce tree and writes one line in each worker's
`WORKER.md` saying which of them that worker may touch. The workers run on one registered copy of
their flow. The lead's model consults the handbook and cannot rewrite it. The CFO's model keeps
payroll current and cannot see the handbook. A worker whose file says nothing reaches both, as
before. A document a worker isn't granted answers its model exactly as one that doesn't exist.

**Input:** `fixtures/input.json` — three worker ids and, per worker, the documents it should reach
and the ones it should be able to write. `fixtures/workforce/**` carries the same thing as files:
`org/resources/handbook.md`, `org/resources/payroll.md`, and a `WORKER.md` per worker — one granting
`handbook` bare, one granting `payroll: rw`, one declaring no `resources:` key at all.
`fixtures/typo/` is the control tree, one character wrong in a grant. Held-out: every id, ref and
expected set is read from the fixture and graded against what the tools answered, so renaming a
document or moving a grant still passes a correct implementation.

**Signal:** the real loader (`readDeclaredRoster`), `createWorkerInstallation` and `hireWorkforce`,
and a flow built the way the docs tell an app to build a custom worker flow: the installation's
session, its documents beside the app's own `audit-log` store, its `resourceVisibility` rule, and
`resolveWorker` in `request.onStarted`. The flow's actions are core's model-facing document tools
(`readResourceContent` with and without a uri, `writeResourceContent`, `globResources`,
`grepResourceContent`, the `discover` door) and `peek`, an app tool built on core's
`resolveResourceByUri`: the blocks a model calls, run as a model would, with no model. Each worker's
session is created naming it through the session route.

(a) The loader reads the tree with no problems — three workers and two documents — and
`hireWorkforce` registers one copy of the flow, at its kind, and none at any worker's id.

(b) Each worker's model lists, globs, greps and discovers exactly the documents its own file grants.

(c) Reading, writing or looking up a document the worker isn't granted answers exactly as for a
document that doesn't exist, through core's tools and through the app's own.

(d) A bare grant is read and not written; an `rw` grant is written; a worker naming nothing writes both.

(e) No two of the three reached the same set, on the one copy.

(f) A worker file granting a ref no document matches registers nothing: `hireWorkforce` refuses,
naming the worker and the ref.

**Anti-game:** a hollow pass would read one worker's reach and stop, which one shared map satisfies.
So the check MUST run all three workers on the ONE copy and see different answers (e), MUST probe
writability by actually writing, MUST compare a refused document's answer against a real missing
document's answer rather than only seeing an error, and MUST grade the app's own tool, since a rule
honoured only by core's listing is still a leak through every app tool. The control removes the
rule and nothing else.

**Model:** n/a — handlers only, by construction. What is graded is what each worker's tools answered.

**Run:** `pnpm tsx goals/workforce-seats/a-seat-reaches-the-documents-its-file-names/run.mts`

**Controls:**
- `GOAL_CONTROL=no-visibility-rule` builds the same flow with no `resourceVisibility`. Must FAIL —
  `the first worker's model lists the second's document`, with (b), (c), (d) and (e) red beside it.

## Verdict log

| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-08 | `865abc573` + this change | n/a | PASS | One `desk` copy ran three workers: `engineering.lead` lists `["handbook"]` and writes nothing, `engineering.cfo` lists and writes `["payroll"]`, `engineering.chief` lists and writes both, through read, glob, grep, discover and the app's `peek`. Another worker's document read, wrote and was looked up as a missing one. The typo tree registered nothing, naming `engineering.typo`. |
| 2026-10-08 | `865abc573` + this change, `GOAL_CONTROL=no-visibility-rule` | n/a | FAIL (expected) | `the first worker's model lists the second's document: engineering.lead lists ["payroll"]`, with every worker listing both documents, reading and writing the other's, and the three sets equal. |
| 2026-09-19 | claude/fix-1381-l4c9yh | n/a | PASS | All six legs. The lead reached `handbook` and wrote nothing; the CFO reached and wrote `payroll`; the seat declaring nothing reached and wrote both. All three kept `audit-log`. The typo tree refused the whole roster naming `engineering.typo` and `hanbdook`, and the good seat's address 404'd afterwards. |
| 2026-09-19 | (control: the mint ignores the resolved grant) | n/a | FAIL (expected) | Both granted seats reached `["handbook","payroll"]` and wrote both, and legs (c) and (e) both fired. Pins that the check is sensitive to the map reaching the mint at all. |
| 2026-09-19 | (control: the narrowed map built from the granted documents alone) | n/a | FAIL (expected) | Leg (d) only: every granted seat lost `audit-log`. This is the construction the spec's first draft described, and the leg that exists to catch it. |
| 2026-09-19 | (control: a `ro` grant minted writable) | n/a | FAIL (expected) | Leg (c) only, on the lead: `wrote ["handbook"], its file grants []`. Pins that the write probe is a real write and not a flag read. |
