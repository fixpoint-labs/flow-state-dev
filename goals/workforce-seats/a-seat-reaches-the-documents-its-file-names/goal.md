# workforce-seats › a seat reaches the documents its file names

**Issue:** FIX-1381 (seat resource allowlist; builds on FIX-1380's D-11 and on the resources file convention)

**Outcome:** An org puts two documents in its workforce tree and writes one line in each seat's
`WORKER.md` saying which of them that seat may touch. The lead consults the handbook and cannot
rewrite it. The CFO keeps payroll current and cannot see the handbook. A seat whose file says
nothing keeps the reach it had before any of this existed. Nobody loses the app's own store, which
no seat file mentions and no grant governs.

**Input:** `fixtures/input.json` — three seat ids and, per seat, the documents it should reach and
the ones it should be able to write. `fixtures/workforce/**` carries the same thing as files:
`org/resources/handbook.md`, `org/resources/payroll.md`, and a `WORKER.md` per seat — one granting
`handbook` bare, one granting `payroll: rw`, one declaring no `resources:` key at all.
`fixtures/typo/` is the control tree, one character wrong in a grant. Held-out: every id, ref and
expected set is read from the fixture and graded against what the running block managed, so renaming
a document or moving a grant still passes a correct implementation. **The flow-level map holds the
app's own `audit-log` store beside the documents on purpose** — a fixture whose flow-level map held
nothing but documents is green for a resolver that deletes the app's own machinery.

**Signal:** against the real HTTP router (`createFlowApiRouter`) over on-disk SQLite stores, matching
its siblings in this family. The records and the documents come from the real loader
(`readDeclaredRoster`), never hand-built: the files are half of what is under test.

(a) The loader reads the tree with no problems — three worker records and two documents — and one
`hireWorkforce` call, handed the same `resourcesFromDocs` map the flow was built from, turns them
into three seats of one kind.

(b) Each seat runs `POST /api/flows/<id>/<session>/actions/run` to completion. After closing the
stores, reopening the same file and building a fresh host, `GET /api/flows/sessions/<session>/state`
shows what a block **nested inside the action** managed: every resource key it could resolve, and
every one of those it could also write.

(c) Each seat's document set is exactly what its own file names, and its written set is exactly what
its file grants. The bare grant reads and does not write. The `rw` grant writes. The seat that
declared nothing reaches and writes both.

(d) All three still reach **and write** the app's own `audit-log`, which no seat file mentions.

(e) No two of the three reached the same set.

(f) A seat file granting a ref no document matches refuses the whole roster at the hire, naming the
seat and the ref, and nothing is registered — a good seat's address 404s on a host built from what
came back.

**Anti-game:** a hollow pass would assert the hires returned and the requests completed — true even
when every seat holds the same map. So the check MUST read what the seat reached back through
`/state` rather than off the returned instance, because a map asserted on `seat.resources` proves
the mint and nothing about what a block holds; MUST read from a **nested** block, since a root-only
read proves nothing about the context spread that carries the map down; MUST close the stores and
rebuild the host first, so nothing is served from a live context; MUST probe writability by
**actually writing**, since asserting `writable === false` passes for a flag nothing consults; MUST
assert the app's own store survives every grant (d), since a resolver that narrows to the granted
documents alone is otherwise fully green; MUST assert no two seats saw the same set (e), since one
shared map is always right for somebody; and MUST assert the control refusal left **nothing**
registered, since a refusal after a partial hire is not a refusal.

**Model:** n/a — handlers only, by construction. What is graded is which resources reached a running
block and which of them it could write.

**Run:** `pnpm tsx goals/workforce-seats/a-seat-reaches-the-documents-its-file-names/run.mts`

## Verdict log

| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-09-19 | claude/fix-1381-l4c9yh | n/a | PASS | All six legs. The lead reached `handbook` and wrote nothing; the CFO reached and wrote `payroll`; the seat declaring nothing reached and wrote both. All three kept `audit-log`. The typo tree refused the whole roster naming `engineering.typo` and `hanbdook`, and the good seat's address 404'd afterwards. |
| 2026-09-19 | (control: the mint ignores the resolved grant) | n/a | FAIL (expected) | Both granted seats reached `["handbook","payroll"]` and wrote both, and legs (c) and (e) both fired. Pins that the check is sensitive to the map reaching the mint at all. |
| 2026-09-19 | (control: the narrowed map built from the granted documents alone) | n/a | FAIL (expected) | Leg (d) only: every granted seat lost `audit-log`. This is the construction the spec's first draft described, and the leg that exists to catch it. |
| 2026-09-19 | (control: a `ro` grant minted writable) | n/a | FAIL (expected) | Leg (c) only, on the lead: `wrote ["handbook"], its file grants []`. Pins that the write probe is a real write and not a flag read. |
