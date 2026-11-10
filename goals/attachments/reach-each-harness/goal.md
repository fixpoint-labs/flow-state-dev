# attachments › it reaches each harness

**Issue:** FIX-2519 (epic FIX-2516)
**Outcome:** A screenshot sent with a turn reaches whichever coding harness runs it, in the form that harness reads: Claude Code gets image blocks, Codex gets image files in a folder of the turn's own outside the checkout, Cursor gets base64 images. The reply names what is on them. After a Codex turn the checkout holds no image and the turn's folder is gone. A harness not signed in here is named in the verdict, never skipped.
**Input:** Two PNGs drawn per run, each with one word picked at random from a list of twenty (`../reach-the-model/png.mts` draws them). The prompt names neither word. One harness session flow per harness, each in a fresh git checkout, on the in-memory profile, in this process, driven through the one client over the engine's in-process fetch as a signed-in user: upload, then `turn` with the files beside the prompt. Held-out: any two distinct A–Z words pass a correct implementation. JPEG, WebP and GIF are each adapter's unit tests (`packages/{claude-code,codex,cursor}/test/**/turn-images.spec.ts`).
**Signal:**
- **names-both** (per harness signed in here): the turn's reply, the harness's final message on the request's result, contains both words.
- **checkout-clean** (Codex): `git status --porcelain --untracked-files=all` in the session's checkout is empty after the turn.
- **folder-gone** (Codex): no per-turn folder the run made is left under Codex's private temp root.
- **blocked** (per harness not signed in): its readiness check's reason is in the verdict.
**Anti-game:** The check reads each harness's reply and the checkout after the turn, never the SDK call: a stubbed SDK gets the parts while the real CLI drops `--image`. The words are drawn per run and appear in no text a harness is sent, so only reading the images names them. `names-both` reads its two words through `tell.over`, so a run that drew nothing is CAN'T TELL, not PASS.
**Model:** Claude Code `claude-haiku-4-5` (`GOAL_CLAUDE_MODEL`), Codex `gpt-5.4-codex` (`GOAL_CODEX_MODEL`), Cursor `composer-2.5` (`GOAL_CURSOR_MODEL`). Any model each harness runs that reads images must pass.
**Run:** `pnpm tsx goals/attachments/reach-each-harness/run.mts`
**Controls:** `GOAL_CONTROL=strip-attachments` patches the session flow's turn to hand the harness the prompt alone (`packages/harness-manager/src/session-flow.ts`). It must FAIL `names-both` for every harness that runs; `checkout-clean` and `folder-gone` still pass, since nothing is written.

**Not covered here:** a task's brief files reaching every run of the task (ER-7). The task row has no `attachments` yet (FIX-2522 adds it), so there is no brief file to hand on; that leg belongs to FIX-2522's check or the closure's Shift Manager re-run.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-10 | fix/FIX-2519-harness-attachments | none signed in | BLOCKED | No harness is signed in in this container: the run named all three (Claude Code: no API key or sign-in; Codex: not logged in; Cursor: no `CURSOR_API_KEY` or stored login). The plumbing was run once with scripted SDK clients through the same HTTP path (upload, claim, `turn`): Claude Code's query got one user message, text then two image blocks of 1,080 and 967 bytes; Codex got text then two `local_image` paths under `/tmp/fsd-codex-<uid>/turn-…/` holding those bytes, the folder gone after and the checkout clean; Cursor's `send` got two `image/png` images of the same sizes. The real-harness verdict is owed by a run where each is signed in |
