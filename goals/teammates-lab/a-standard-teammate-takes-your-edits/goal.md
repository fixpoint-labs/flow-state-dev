# teammates-lab › a standard teammate takes your edits

**Issue:** FIX-2526

**Outcome:** In the Teammates lab, a user renames Chief of Staff and gives it new instructions. Its next turn is told the new name and follows the new text. Its id, conversation and history stay as they were. Another user in the same organization still gets the file's Chief of Staff. Reset puts the file's version back from the next turn. A teammate the user hired can be renamed the same way.

**Input:** the lab's own workers (`labs/teammates/workforce/`), a fresh store, two users (`alice`, `bob`). The new instructions carry a random marker, so a prompt can only hold them if the edit reached it.

**Signal:** the lab's host (`labs/teammates/host.mts`) in a child process (`host.mts` here), driven over HTTP through the public client and the workforce client. Only the model is scripted: it logs the prompt each turn's first step was handed.

- **a:** after Alice's edit, Chief of Staff's next turn says *"You are Chief of Staff"*, holds the new instructions and not the file's; researcher's next turn lists `teammates.chief-of-staff` as Chief of Staff.
- **b:** a fresh roster read lists it once, under the same id, with the new name, `standard` and `edited`; the conversation is the same session, and the turn after the edit still reads the line said before it.
- **c:** Bob's roster names it *Lead*, unedited, and his turn says *"You are Lead"* with the file's instructions.
- **d:** after Alice's Reset, her next turn says *"You are Lead"* with the file's instructions, in the same session; the roster shows it unedited.
- **e:** Alice hires `tester` and renames it *QA Bot*: its next turn says *"You are QA Bot"*, in the same session, and the roster keeps the id `tester`.

**Anti-game:** graded on the prompts the model received and the roster the server returns, never on the calls the adapter made.

**Model:** none (scripted).

**Run:** `pnpm tsx goals/teammates-lab/a-standard-teammate-takes-your-edits/run.mts`

**Controls:** on the same command:

- `GOAL_CONTROL=ignore-edits`: the host reads a standard id from its file even when the user has their own copy (a scratch patch to `installation.ts`'s `lookupWorker`, applied as the host loads). Leg **a** must FAIL.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-09 | (this PR) | scripted | PASS | Every leg. Chief of Staff's next turn said "You are Chief of Staff" with the new text, in the same session; Bob saw Lead; after Reset, Lead again; tester renamed QA Bot in the same session |
| 2026-11-09 | (this PR) | scripted | control `ignore-edits`: FAIL as required | a:identity ("You are Lead"), a:instructions (both), a:roster; the patch reached `installation.ts` |
