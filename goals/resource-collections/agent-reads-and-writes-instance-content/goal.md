# resource-collections › it reads and writes instance content via the generic tools

**Issue:** FIX-842
**Outcome:** A resource collection that opts in (`llmReadable` / `llmWritable`) has its instance bodies read and rewritten by an agent through the GENERIC content tools (`readResourceContentTool` / `writeResourceContentTool`), addressed by scope-qualified uri — no per-collection read/write blocks. A user wiring those two tools to a generator gets a working read-then-write loop over a collection.
**Input:** `fixtures/note.json` — the seeded instance body, the `secret` token that body carries, and the instance key. Held-out: the runner reads `secret` from the fixture and never hardcodes "daffodil", and the prompt never names the secret, so swapping in a different body + secret must still pass a correct implementation.
**Signal:** after the run, the instance's persisted content (read back from the real `ContentStore`) (a) is no longer the seed body and (b) contains the fixture's `secret` token (case-insensitive). Both must hold.
**Anti-game:** the gameable pass is asserting the write tool was called, or that the run's `result.success === true` — both hold if the model wrote a hardcoded string or echoed the prompt without reading. The secret appears nowhere in the prompt, only in the seeded body, so it can only reach the stored content by the model actually reading the instance and writing it back. The check therefore grades the final persisted body against the held-out `secret` (proves read) AND that it changed from the seed (proves write). It does NOT assert tool-call presence, item counts, or the success flag, and it does not seed the secret into the instruction.
**Model:** real — resolved by the env model ladder (`FSDEV_DEFAULT_MODEL`, e.g. `vercel/openai/gpt-5-nano` in CI containers). Non-flow goal: it builds a throwaway flow and drives the public `runAction` API directly (deps resolve via the `goals` workspace package).
**Run:** `pnpm tsx goals/resource-collections/agent-reads-and-writes-instance-content/run.mts`

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-06-23 | 55e5561 | vercel/openai/gpt-5-nano | PASS | In-process `runAction` over a session collection `notes/**` (`llmReadable`+`llmWritable`); generator wired with `readResourceContentTool()`/`writeResourceContentTool()`. Model read `session/notes/a` and rewrote it to `CONFIRMED: daffodil`; persisted body read back from `ContentStore` changed and carried the held-out secret. |
