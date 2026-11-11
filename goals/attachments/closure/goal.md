# attachments › closure: every chat takes images and documents

**Issue:** FIX-2565, the closure of epic FIX-2516. Spec: `specs/issues/FIX-2565/`.

**Outcome:** In every chat in our apps, a person can attach images and documents by paste, + or drop, see and remove them before sending, and the reply shows the model or harness saw them, or says plainly why it can't. Proved on one `main` commit, through a real browser, after a real restart, against real models and real harnesses.

**Input:** drawn per run (`legs.mts` → `draw`), held out: two PNGs, each with one word from a list of twenty (`../reach-the-model/png.mts`); a three-page PDF whose only code word is on page 3 (`packages/engine/test/blobs/pdf-fixture.ts`); for the coding hand-offs and Shift Manager's task, two more words not in leg a's. No prompt names a word. Leg c: ten small PNGs and an 11th, a 25 MB file named `.png`, a HEIC-named file.

**Who is asked** (`<app>/run.mts`, each one runnable alone):

| Surface | Tag | Legs | And |
|---|---|---|---|
| Kitchen Sink, Flow State chat | `ks-fs` | a, b, c | |
| Kitchen Sink, Claude Code page | `ks-cc` | a, b, c | |
| Kitchen Sink, Codex page | `ks-cx` | a, b, c | b from the PDF's extracted text (FIX-2520 D1) |
| Kitchen Sink, Cursor page | `ks-cu` | a, b, c | b from the PDF's extracted text |
| Shift Manager, the Shift Coordinator | `sm` | a, b, c | a task filed from a line with two images: its run and a Retry each name both (`sm:task-run`, `sm:re-run`) |
| The Claude Code-style lab, main session | `cc-style` | a, b, c | the main session hands the images to a Claude Code run (`cc-style:coding`) |
| The Teammates lab, Chief of Staff | `teammates` | a, b, c | the Chief of Staff hands the images to the Claude Code teammate (`teammates:coding`) |

**Signal** (`legs.mts` → `walkSurface`, per surface; every failure is `[<tag>:<assertion>]`):

- **a** `shown` both images are drawn (loaded `<img>` by file name) in the composer before Send · `wire` the send carries exactly two `fsd-blob:` references and no base64 run of 1 KB · `names-both` the reply drawn on the page, after the person's line, names both words · `session-read` the session read, as the page's own connection reads it, holds both references and no base64 run over 1 KB · `reload` the user line draws both after a reload · `restart` and again after the server's process group is stopped and started on the same stores · `local-storage` no base64 run over 1 KB in the page's `localStorage` (ER-2).
- **b** `code-word` the composer takes the PDF (no refusal names it) and the reply carries the code word.
- **c** `refused` "Only 10 images per message", "huge.png is over 20 MB" and "photo.heic isn't supported" each show in the composer's notices, and no action request goes out.
- **host** a surface whose model has no key here, whose harness isn't signed in (or the runner is root, which Claude Code refuses), or which the app says is unavailable, is named `not run`: a FAIL, never skipped (DECISIONS, "A harness not signed in").

**Sweeps** (`sweeps/run.mts`, model-free, also `run.mts --sweeps-only`): `fix-824` and `fix-2518` re-run those goal checks unchanged; `kill-line-repo` measures the kill line's repo half from before the epic (`8e82e8ced^1`), allowing FIX-2520's `unpdf` and noting this repo's own workspace packages; `er-1`, `er-6`, `ephemeral-disk`, `seam-task-files`, `seam-task-delete`, `seam-steer` as the file header says.

**Anti-game:** nothing reads a hook's state, a stubbed model or the parts a model call held. The words and the code word are only inside the files, so only reading them names them; each is floored with `tell.over`. The reply is read past the person's own line. The run refuses to start (exit 2) with `GOAL_SCRIPTED`, either Kitchen Sink test-mode flag, `CLAUDE_CODE_STYLE_HARNESS`, `GOAL_HARNESS`, or a `DEVFORCE_LAB_HARNESS` other than `claude-code` set; Shift Manager's runner sets `claude-code` itself. The seam walks read through the public routes and a rendered hook, and each has a control that turns it red.

**Model:** real. Each app's own: Kitchen Sink's Flow State and Shift Manager's Shift Coordinator through the AI Gateway, the labs' `CLAUDE_CODE_STYLE_MODEL` / `TEAMMATES_MODEL`; each harness on this machine's own sign-in and default model.

**Run** (as a signed-in, non-root user, with `AI_GATEWAY_API_KEY` set, Claude Code signed in, `codex login` done, and `CURSOR_API_KEY` set or Cursor signed in):

```
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/attachments/closure/run.mts
pnpm tsx goals/attachments/closure/run.mts --sweeps-only
GOAL_APPS=kitchen-sink,teammates …        # a subset of the apps
```

**Controls:**

- `GOAL_CONTROL=strip-file-parts` plants, for the run and put back after (`goals/lib/plant.mts`), a strip of file parts on the final commit: the model message build keeps a user line's text only (`packages/engine/src/context/history.ts`), and every harness turn reads no file (`readHarnessTurnFiles`, `packages/core/src/types/harness-attachments.ts`). Must FAIL `names-both` and `code-word` in every surface, and the `coding`, `task-run` and `re-run` legs; `shown`, `wire`, `reload`, `restart` and `refused` still pass.
- The commit before FIX-824 merged (`8e82e8ced^1`) is the control that must fail every leg: its composers have no uploader. Run by checking that commit out and serving the apps from it; the runners are copied in, as they don't exist there.
- Sweeps: `GOAL_CONTROL=brief-shares-reference GOAL_SWEEPS=seam-task-files` must FAIL `brief` and `kept`; `GOAL_CONTROL=steer-files GOAL_SWEEPS=seam-steer` must FAIL `next-turn` and `not-steered`.

**Stated limits:** Kitchen Sink serves its default SQLite store (`apps/kitchen-sink/.fsdev/data`): it honours a scratch store file only in test mode, which this run refuses. A scanned PDF page is a stated limit, not a cell. The runners' page selectors for Shift Manager's task list and the labs' hand-offs were written against the code, not yet walked with a model (see the verdict log).

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-11 | 354a1033d (goal/FIX-2565-closure) | none here | BLOCKED (legs) | This container has no model key and runs as root: every surface named `not run` at **host** (no `AI_GATEWAY_API_KEY`; Claude Code refuses root; Codex and Cursor not signed in). The legs are owed by a run on a signed-in, non-root machine |
| 2026-11-11 | 354a1033d (goal/FIX-2565-closure) | n/a | FAIL (sweeps, findings) | See the PR's sweep table. PASS: `er-1`, `ephemeral-disk`, `seam-task-files`, `seam-steer`. FINDINGS: `fix-2518` flaky, 2 of 4 runs PASS, the other two timed out in leg c's `setInputFiles` with a 25 MB file (its own check, not the composer); `fix-824` (415 at its PDF upload: its random-byte 20 MB "PDF" is refused `pdf_unreadable` since FIX-2520 reads a PDF at upload), `kill-line-repo` (`nanoid` added to Shift Manager by FIX-2518), `er-6` (both labs' `attachments.tsx` copies predate FIX-2520: their composers take images only, so leg b would be refused there), `seam-task-delete` (blocked: nothing deletes a task) |
| 2026-11-11 | (same tree) | n/a | FAIL (expected) | `brief-shares-reference`: `seam-task-files` red on `brief` and `kept` (404 after the session's delete). `steer-files`: `seam-steer` red on `next-turn` and `not-steered` |
| 2026-11-11 | (same tree), by hand | n/a | FAIL (expected) | A scratch file in `apps/kitchen-sink/lib` with an `fsd-blob:` literal, an `atob(file.data)` and an `e.dataTransfer`: `er-1` red on both, `er-6` red on the handler; removed after |
