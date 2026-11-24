# attachments › kitchen-sink-chats

**Issue:** FIX-2521 (epic FIX-2516)

**Outcome:** In Kitchen Sink's Flow State chat and on each coding harness page (Claude Code, Codex, Cursor), a person pastes one image and picks a second with +, sees both above the text before Send, and sends. The reply shows the model or the harness saw both. After a reload the user line still shows both. An 11th image, a file over 20 MB and a HEIC are each refused in the composer by name, and nothing is sent.

**Input:** two PNGs drawn per run, each with one word picked at random from twenty (`../reach-the-model/png.mts` draws them). The prompt names neither word. Held out: any two distinct A–Z words pass a correct implementation. The leg-c files: ten small PNGs and an 11th, a 25 MB file named `.png`, and a HEIC-named file.

**Signal:** one real browser against `next dev`, one page per mode, each assertion `<mode>:<leg>`, mode `fs`, `cc`, `cx` or `cu`.

- **host**: the picker shows the mode available; for `fs`, a key that serves Flow State's model is set. A mode that isn't is named with its reason, and is not walked.
- **shown**: both images are drawn (a loaded `<img>` with the file's name) in the composer before Send.
- **wire**: the turn's request holds exactly the two files as `fsd-blob:` references, and no base64 run of 1 KB or more.
- **names-both**: the run's reply on the page names both words.
- **reload**: after a reload, the user line draws both images, read back from the server.
- **refused**: "Only 10 images per message", "<huge> is over 20 MB" and "<photo>.heic isn't supported" show in the composer's notices; no turn request goes out.

**Not graded yet:** a PDF answered on every page (FIX-2520). Until FIX-2520 widens the composer's types, the composer refuses a PDF, so the leg would read the refusal, not the reply. It is added here when FIX-2520 lands.

**Anti-game:** nothing reads the composer's state. The references are counted in the request body on the wire, the images are ones the browser loaded, and the reply is the page's text. The words are drawn per run and appear in no text the model or harness is sent, so only reading the images names them; `names-both` reads its words through `tell.over`.

**Model:** Flow State's default model through the AI Gateway (`AI_GATEWAY_API_KEY`), and each harness's own default model as its mode runs it. Any model that reads images must pass.

**Run:** `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/attachments/kitchen-sink-chats/run.mts`

**Dry run:** `GOAL_SCRIPTED=1` on the same command serves the scripted model and harnesses (test mode), so `shown`, `wire`, `reload` and `refused` run on any host. The scripted ones read no image, so `names-both` fails there by design, and the run always FAILs with a `[scripted]` line: never a verdict.

**Controls:** today's `main` before this change is the control. Its reproduction is `apps/kitchen-sink/test/flow-state-page-attachments.test.tsx` and `harness-session-attachments.test.tsx`, red there on *the request carries the image* (the composer had no uploader and the send no files). On this goal, `main` would fail `shown` on every page, each image refused as unavailable (expected from the unit control; this goal was not run on `main`).

**Host:** a signed-in, non-root host. Run as root, Claude Code mode is unavailable, and the others need their own sign-ins; the run names each such mode at **host** and walks the rest.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-10 | fix/FIX-2521-kitchen-sink-attachments | none here | BLOCKED | No model or harness can run in this container: no `AI_GATEWAY_API_KEY` (fs), the server runs as root (cc), Codex not logged in (cx), no Cursor sign-in (cu). Each named at **host** |
| 2026-11-10 | (same tree) | scripted model and harnesses | FAIL (dry run, by design) | `GOAL_SCRIPTED=1`: on all four pages **shown**, **wire**, **reload** and **refused** held; only **names-both** failed, as it must on a model that reads no image. The dry run first caught Flow State dropping a file attached before the session's snapshot arrived, fixed in this branch |
