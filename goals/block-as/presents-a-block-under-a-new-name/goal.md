# block-as › it presents a block under a new name

**Issue:** FIX-1811
**Outcome:** An author shows any block to a model under a name and description of their choosing, with no wrapper. The renamed tool is called, suspends, resumes and shows up in the item log under that one name, in a generator and in Workforce's tool catalog alike.
**Input:** `fixtures/input.json` — the note to save, the worker that hires, and the id to hire. Held out: a different note, user, org, worker id or hire id must pass too (one such swap is in the verdict log).
**Signal:**
- **a** (a generator tool): asked to note something, the real model calls `saveNote` (a `notes.write` handler renamed with `.as()`, which asks for approval first). The run suspends with nothing written; after the approval it completes and the store holds exactly one note carrying the held-out text. The item log and the suspension record name `saveNote` and never `notes.write` (or its alias `notes_write`). Assertions: `a:calls-new-name`, `a:suspends`, `a:resumes`, `a:once`, `a:one-name`.
- **b** (Workforce's catalog): the built-in worker flow with catalog `{ hire: <Workforce's hire block>.as({ name: "hire", … }) }` loads. A worker whose `tools:` says `hire`, asked to hire the held-out id, calls `hire`, and exactly one row with that id appears on the person's roster, read through the shipped Workforce client. Assertions: `b:flow-loads`, `b:roster-row`.

**Anti-game:** Don't assert on the compiled tool list or on `block.name`: both pass while the catalog still refuses the entry, or while the log names the original. The note count is read from the store the tool writes, and the roster row through the roster client, never from items. The model's retelling is not graded. `a:one-name` has no isolating red state of its own: a handler tool doesn't read its own name, so the engine already names it by whatever `.name` the tool carries; the engine suite's negative control (`packages/engine/test/block-as.test.ts`) is where a half-rename goes red, on a generator and a router.
**Model:** real — openai/gpt-5.4-mini
**Run:** `pnpm tsx goals/block-as/presents-a-block-under-a-new-name/run.mts`
**Controls:** `GOAL_CONTROL=no-as` passes both blocks without `.as()`. It must FAIL `a:calls-new-name` (the model is offered `notes.write`, so never calls `saveNote`) and `b:flow-loads` (the catalog refuses a key that isn't the block's own name). Mutations recorded below: the worker's `tools:` line emptied fails `b:roster-row`; the tool's approval step removed fails `a:suspends`.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-08 | 7e896278 | vercel/openai/gpt-5.4-mini | FAIL (expected) | `GOAL_CONTROL=no-as`: `a:calls-new-name` (the model called `["notes.write"]`), `b:flow-loads` (defineAgentWorkerFlow refused 1 catalog entry) |
| 2026-10-08 | 7e896278 | vercel/openai/gpt-5.4-mini | PASS | a: called `["saveNote"]`, 0 notes at the suspension, 1 after approval with the held-out text; names in items and suspension: assistant, root, runtime, saveNote. b: the worker called `["hire"]`, roster gained `["night-desk"]` |
| 2026-10-08 | 7e896278 | vercel/openai/gpt-5.4-mini | PASS | held-out swap (another note, user, org, worker `ops.staffing`, hire `weekend-support`): same signals, roster gained `["weekend-support"]` |
| 2026-10-08 | 7e896278 | vercel/openai/gpt-5.4-mini | FAIL (expected) | mutation, worker `tools: []`: `b:roster-row` (0 rows added) |
| 2026-10-08 | 7e896278 | vercel/openai/gpt-5.4-mini | FAIL (expected) | mutation, approval step removed: `a:suspends` (the note was written before approval) |
