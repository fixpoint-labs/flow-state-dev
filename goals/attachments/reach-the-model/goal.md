# attachments › it reaches the model

**Issue:** FIX-2517 (epic FIX-2516)
**Outcome:** A person's message with two images reaches a real model as one turn with the text and both images. The model names what is on them. After a reload the conversation still shows both files on that line, and two turns later the model can still answer about the second image. A hand-built send with an eleventh image is refused by name before anything runs.
**Input:** Two PNGs drawn per run, each with one word picked at random from a list of thirty (`png.mts` draws them; no image library). The words are the only place the answer exists: the prompt names neither. A generator flow (`send`, with `userMessage`, `history: true`) on an on-disk SQLite store in a scratch folder, in this process, driven through the one client over the engine's in-process fetch as a signed-in user. Held-out: any two distinct A–Z words pass a correct implementation. Other image types and counts are unit tests (`packages/engine/test/blobs/send-attachments.test.ts`, `packages/engine/test/context/history-files.test.ts`).
**Signal:**
- **names-both**: turn 1's reply ("What word is written on each image?") contains both words.
- **reload**: the session read afresh holds exactly one user line for turn 1, its text first, then two `file` parts whose `data` is a blob reference.
- **later-turn**: turn 3 ("What word was on the second image?"), after a turn with no files, is answered with the second word.
- **limit**: a send naming eleven images is refused with `attachment_limit`, and the session's request count does not change.
**Anti-game:** The check reads the model's reply and the reloaded session through the client, never the messages the engine built: a stub model or an assertion on `itemToLLMMessages` would pass while a real call drops the parts. The words are drawn per run and appear in no text the model is sent, so only reading the images names them. `names-both` reads its two words through `tell.over`, so a run that drew nothing is CAN'T TELL, not PASS.
**Model:** `openai/gpt-6-luna` (through the Vercel AI Gateway; `GOAL_MODEL` overrides)
**Run:** `pnpm tsx goals/attachments/reach-the-model/run.mts`
**Controls:** `GOAL_CONTROL=drop-file-parts` patches the history build to keep a user line's text only (`packages/engine/src/context/history.ts`). It must FAIL `names-both` (and with it `later-turn`); `reload` and `limit` still pass, since the line itself is unchanged. `main` before this change fails at the send: the action route claims the files but nothing writes them on the line or sends them to the model.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-10 | fix/FIX-2517-attachments-reach-model | none (no gateway or OpenAI key in this container) | BLOCKED | The script's plumbing was run once with a stand-in model that reports what it was sent: turn 1's call held one user line with the text and 2 image parts; turn 3's call held all 3 user lines, the first still with its 2 images; `reload` and `limit` passed (1 user line, text + 2 references; 11 images → 400 `attachment_limit`, requests unchanged). Under `drop-file-parts` the same stand-in saw 0 image parts. The real-model verdict is owed by a run with `AI_GATEWAY_API_KEY` or `OPENAI_API_KEY` set |
