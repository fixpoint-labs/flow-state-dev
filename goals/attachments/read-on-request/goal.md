# attachments › the model reads an earlier document on request

**Issue:** FIX-2636
**Outcome:** In a flow that installs the attachments capability, a person asks about any document their session was sent, however many turns back, and the model reads it on request through the one resolver and answers from it; no call carries an earlier turn's document text unless the model read it in that turn. A flow without the capability still re-sends its newest documents (FIX-2517 D1).
**Input:** `host.mts` is a local server on an on-disk SQLite store hosting one chat twice, each with a three-turn history window: `with-capability` taps `recordAttachments` and installs `attachmentsCapability`; `without-capability` has neither. The model is scripted: it records what each call sent it (the provider seam) and reads a file the person asks about by the id it was shown, or by its name when it was shown none. Three fresh code words per run, one each in a PDF built per run (`q3-report.pdf`, doc 1), a `.md` (`plan.md`, doc 2) and a `.csv` (`numbers.csv`, doc 3), all through the upload route. Session A: turn 1 sends doc 1; turn 2 doc 2 and four small files; turn 3 doc 3 and four more; turn 5 asks about doc 2; the server is crashed (SIGKILL to its process group) and started on the same store; turn 8 asks about `Q3-Report.pdf`. Session B (without the capability): the three documents over three turns, then a fourth. Session C asks to read doc 1's id. Held-out: the words and bytes are random each run.
**Signal:**
- **turn8**: turn 8's model input holds doc 1's word in a tool result, while what it was shown before the read (history and file list, the person's own question aside) names doc 1 nowhere.
- **turn5**: turn 5's history names doc 2 with its id, and its model input holds doc 2's word in a tool result.
- **quiet**: the model inputs of turns 4 to 7 hold no code word, except turn 5's read result (file parts decoded).
- **stored**: every `tool_output` item of session A, read through `@flow-state-dev/client`, is under 2 KB with no word; the `attachments` list holds no word and each entry is under 2 KB.
- **other-session**: session C's read of doc 1's id answers "not in this conversation", with no word.
- **without**: session B's turn 4 input holds all three words.
**Anti-game:** Real processes, a real SQLite file, a real crash, a real PDF's stored text, the public routes only. The prompts are read where the provider gets them (the scripted model's received messages, after the model call prepared them), and the items and list through the client, never the block or the store. The scripted model finds an id only in what it was shown, so a read by name happens only when nothing showed one. Every list graded goes through `tell.over`.
**Model:** n/a (scripted model at the provider seam)
**Run:** `pnpm tsx goals/attachments/read-on-request/run.mts`
**Controls:** On the same command:
- `GOAL_CONTROL=resend` sets the capability's history rule back to the window. It must FAIL `quiet`. It also fails `turn5`'s history line, which only the rule writes.
- `GOAL_CONTROL=name-only` resolves a read to the file's name, not its text. It must FAIL `turn8` and `turn5`.
- `GOAL_CONTROL=id-only` makes the tool refuse a name. It must FAIL `turn8` (doc 1 is in neither window), and nothing else.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-11 | a45831990 + goal | n/a | PASS | SIGKILL and restart on SQLite; turn 8 read doc 1 by name (2 calls), turn 5 read doc 2 by id; turns 4-7 (5 calls) carry no other document text; 2 tool_output items and 11 list entries hold no word; another session's id answers "not in this conversation"; without the capability turn 4 carries 3 of 3 words |
| 2026-11-11 | a45831990 + goal, `resend` | n/a | FAIL (expected) | `quiet` (turns 4, 5, 6 carry doc 3's word) and `turn5` (no named line) |
| 2026-11-11 | a45831990 + goal, `name-only` | n/a | FAIL (expected) | `turn8` and `turn5`: the read results hold the names only |
| 2026-11-11 | a45831990 + goal, `id-only` | n/a | FAIL (expected) | `turn8` only: "Pass a document's id or its name." |
