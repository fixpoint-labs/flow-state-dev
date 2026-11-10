# attachments › both labs' composers attach files

**Issue:** FIX-2523, which also covers FIX-2524 (epic FIX-2516)
**Outcome:** In the Claude Code-style lab and the Teammates lab, a person can paste, pick or drop images, see and remove them before Send, and the worker the line goes to sees them. Its reply describes them, and the line still shows both after a reload.
**Input:** Two PNGs drawn per run, each with one word picked at random from a list of twenty (`../reach-the-model/png.mts` draws them). The line names neither word. Each lab's own host (`labs/*/host.mts`) runs in this process on a SQLite store in a scratch folder. Each lab is driven through its own adapter, using the calls its page makes: `upload` for each file, then `send` with the references beside the line. Held-out: any two distinct A–Z words pass a correct implementation.
**Signal:**
- **names-both** (the Claude Code-style lab's main session, the Teammates lab's Lead): the turn's answer on the thread names both words.
- **reload** (both): a fresh adapter's read of the thread holds the line with two `fsd-blob:` references, and each one's bytes read back through the lab's `readFile`.
- **coding legs** (a Claude Code task in the Claude Code-style lab, a coding worker in the Teammates lab): **blocked**. A coding run gets a line's files only through the task its worker files. A filed task carries no files until FIX-2522 lands. The run names this leg every time and never skips it.
**Anti-game:** The check reads the answer the thread shows, never the adapter call: a send can carry files that the worker's flow drops. The words are drawn per run and appear in no text the worker is sent, so only reading the images can name them. `names-both` reads its words through `tell.over`.
**Model:** `openai/gpt-6-luna` through the AI Gateway (`GOAL_MODEL` overrides).
**Run:** `pnpm tsx --tsconfig labs/teammates/tsconfig.json goals/attachments/lab-composers/run.mts` (the tsconfig resolves the `@/` imports the labs' adapters load)
**Controls:** `GOAL_CONTROL=drop-attachments` patches both adapters' `send` to carry no files, as on `main` before this change. It must FAIL `names-both` and `reload` in both labs.

**The browser half:** paste, +, the strip, Tab order and the thumbnails are the labs' screen tests (`labs/*/test/attachments.test.tsx`). The run checks them by hand in Chrome against each lab served by `fsdev dev`. See the verdict log.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-10 | fix/FIX-2523-lab-attachments | none (no gateway or OpenAI key in this container) | BLOCKED | No key serves the model here. The script was run once with a stand-in model that answers the two words only when the line's last user message carries two `image/png` parts: both legs named both words, and both reloads showed 2 references that read back. Under `drop-attachments` the same stand-in saw 0 images in both labs, and `names-both` and `reload` failed in both. The coding legs are blocked on FIX-2522. In Chrome, against each lab served by `fsdev dev` (no model key, so the turn failed after the line landed), the run pasted one image and picked a second with +. Both showed as thumbnails, and the send carried 2 `fsd-blob:` references and no base64. The strip emptied after Send, and after a reload the line drew both thumbnails, read through the read route. The real-model verdict is owed by a run with `AI_GATEWAY_API_KEY` set |
