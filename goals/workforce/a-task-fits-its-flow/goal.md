# workforce › a task fits its flow

**Issue:** FIX-2894 (epic FIX-2876). Its spec's goal: `specs/issues/FIX-2894/SPEC.md` → "The goal, and how we'll know it's met".

**Outcome:** a filer learns what a delegate takes, and a task that doesn't fit is refused at filing with the field named, so no worker runs on input it can't read and no filer writes a field the server owns.

**Input:**

- **discover**: one in-process host on the real engine and a SQLite store, acted on over its HTTP router as one verified person (`goals/lib/client-actions`). The tree in `fixtures/workforce/`: `ops.desk` on a goal-local `desk` flow (the person's conversation, no model), delegate `ops.lead`; `ops.lead` on the built-in `agent` flow and a real model, delegate `ops.triager`; `ops.triager` on a goal-local `triage` flow whose `work` entry declares `{ ticket: /^ENG-\d+$/, kind: "fix" | "probe", requestedBy }`, `requestedBy` server-owned. The lead's file says to hand triage on and never says what a triage task takes. The person files five tasks for the lead, each naming a fresh ticket and saying nothing should change; the ask never names a field or the kind's words.
- **scripted**: the workforce suite for this issue (`packages/workforce/test/task-input.test.ts`, `task-input-race.test.ts`, `task-input-sources.test.ts`), on the real engine and the real board: a scripted `triage` flow, a second declared flow (`intake`), an open flow (`helper`), a raw-handle writer, a project-requiring flow, a conversation with one and with several delegates, a row rewritten between filing and claim, and two edits raced on one row.
- Held out: the ticket number is fresh per run.

**Signal:** each failure is tagged `<leg>:<assertion>`.

- **discover** `discover:first-filing-fits`: in at least 4 of 5 runs, the lead's first `createTask` for `ops.triager` is accepted: the stored row holds the ticket and `requestedBy` the filler wrote, the triage block was handed `kind: "probe"`, and no `input_refused` came before it.
- **scripted** `scripted:suite`: every test passes. Refuse: a misfit is refused `input_refused`, naming the path, with no row written, on `createTask`, a batch (whole), `updateTask`, a move, and the raw handle a task session is handed. Own: a filer's server-owned value is dropped and filled (one outside the schema only dropped), kept on an edit, and a `check` that changes one (new or nested in place) is refused. Stamp: a row stamped for another declaration is filled again at claim (`at: "claim"`). Race: an edit that loses re-runs its whole check on the new revision, and is refused `input_conflict` after three conflicts. Round trip: a `Date` a `check` puts in a `z.unknown()` field is refused by name; a schema that can break the round trip is refused at build. Move: an assign onto a declared flow runs the filler and the parse. Claim: a stored row that no longer fits fails its attempt and the block never runs; a row the flow's `stored` maps runs on the mapped input. Open: a flow with no declaration stores the input as sent. Project: `project: "required"` refuses `no_project`. Discover's other half: `listDelegates` shows inlined draft-07 JSON Schema without the server-owned fields.

**Anti-game:** discover reads the stored row and the input the triage block received; the tool's reply is read only to order the lead's calls (which came first), never as evidence a filing fit. The suite reads the stored rows and the block's input, never a stubbed board.

**Model:** real for the lead: the goals library's default model through the gateway (`gatewayModel(goalModel())`; `GOAL_MODEL` overrides). Gated on a key that serves it (`keysServing`); without one the run is blocked, not failed.

**Run:** `pnpm tsx goals/workforce/a-task-fits-its-flow/run.mts`. `GOAL_LEGS=discover` or `GOAL_LEGS=scripted` runs one leg. On demand only, never a CI gate.

**Controls:**

- `GOAL_CONTROL=hide-shape`: `listDelegates` shows `input: null` for every delegate (`delegates/worker-delegates.ts`), applied as the process loads (`goals/lib/module-patch.mts`). **`discover:first-filing-fits`** must fail (at most 1 of 5).
- The suite's controls are scratch patches to the source, each run against the two test files and reverted; vitest does not load through the goals' module-patch hook, so they are not `GOAL_CONTROL`s here. Each must fail the tests named: `filing-only` (only `createTask` checks) and `raw-handle-bypass` fail Refuse; `trust-filer`, `check-rewrites-owned` fail Own; `trust-stale-declaration` fails Stamp; `no-cas` fails Race; `build-time-only` fails Round trip; `move-unchecked` fails Move; `trust-stored` fails Claim. Their results are in the verdict log.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-23 | fix-2894-task-input, uncommitted, before the filing turn named the declared delegates | the default model (vercel gateway) | FAIL (discover) | 0 of 5: each first `createTask` was refused `input_refused` (`at "ticket", required` or `at "kind", required`): the model filed before reading `listDelegates`, then read it and filed again, accepted. The filing turn's context now names each declared delegate and says to read its `input` first |
| 2026-11-23 | fix-2894-task-input, uncommitted | the default model (vercel gateway) | PASS (discover) | 5 of 5 first filings fit: stored `{ ticket: "ENG-<n>", kind: "probe", requestedBy: "u:u_task_fits" }`, the triage block handed the same, one `createTask` call each, none refused |
| 2026-11-23 | fix-2894-task-input, uncommitted | the default model (vercel gateway) | FAIL (control `hide-shape`, expected) | 0 of 5: every first call refused `at "kind", required` (or `at "ticket", required`); `discover:first-filing-fits` failed, as it must |
| 2026-11-23 | fix-2894-task-input, uncommitted | — (scripted) | PASS (scripted) | the suite: 24 of 24 |
| 2026-11-23 | fix-2894-task-input, uncommitted | — (scripted) | FAIL (each suite control, expected) | each a scratch source patch, reverted after: `no-cas` 2 failed (both Race); `trust-filer` 1 (Own: drop); `check-rewrites-owned` 1 (Own: check); `build-time-only` 1 (Round trip); `trust-stored` 3 (Claim, Stamp); `trust-stale-declaration` 1 (Stamp); `move-unchecked` 2 (Move); `raw-handle-bypass` 1 (Refuse: raw handle); `filing-only` 7 (Refuse on updateTask, Move, Race, raw handle); `hide-shape` 1 (listDelegates shape) |
| 2026-11-24 | fix-2894-task-input, after the #5631 review round (registry by door and installation; unchecked writes clear the stamp; every move checked) | — (scripted) | PASS (scripted); each suite control FAIL, expected | the suite: 32 of 32. Controls re-run on it: `no-cas` 2, `trust-filer` 1, `check-rewrites-owned` 1, `build-time-only` 1, `trust-stored` 3, `trust-stale-declaration` 1, `move-unchecked` 3, `raw-handle-bypass` 2, `filing-only` 10, `hide-shape` 1 failed |
