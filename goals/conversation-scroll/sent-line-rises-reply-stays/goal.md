# conversation-scroll › a sent line rises, and its reply stays in view

**Issue:** FIX-2360

**Outcome:** In DevTool, Shift Manager, the Claude Code-style lab and the Teammates lab, a line you send rises to near the top of the view and its reply streams in below it, where you can read it. After that, nothing you didn't do moves the view.

**Input:** each app's own conversation views, built by the app's own Vite config from a scratch copy of its source, with the goal's page (`pages/`) as the entry. The page mounts the app's real components with the app's stylesheet, and replaces only the data source with a script (`pages/script.ts`): two conversations of 28 earlier lines each, a send that lands the person's line 150 ms later (as a server's echo does), then a reply that streams one sentence every 70 ms. A short reply is two chunks; a long one is 72 sentences, a few screens. A line that isn't the person's is a 30-sentence block.

- **DevTool**: `StreamView`. Each line sent is a request named by the line, as the panel dispatches an action; a send counts in `sends` first and its request lands after. A switch remounts the workspace by the session's key, as the panel does.
- **Shift Manager**: `Conversation` (sends through its own composer) and `TaskSession`. Its reads, the task and the send (`src/lib/{lab-data,conversation,send,task,run}`) are swapped at build time for `pages/shift-manager/fakes/`, which keep every other export of the real module. The task session's composer is the task frame's, so a send is counted in the task's `sent`, as that composer does.
- **Claude Code-style**: `Thread` and `ThreadView` (send through their own composers) and `Sheet`, the task panel, which never sends.
- **Teammates**: `Conversation` (sends through its own composer) and `SessionPopup`, which never sends.

**Signal:** read off rendered boxes and `scrollTop` in headless Chromium, per surface. The sent line is found by its text, never as "the last element".

- **a.short**: a send from the end with a short reply: the top of the sent line's text is 0 to 48 px below the feed's top edge, once the move ends and again when the reply ends.
- **a.long**: a send after scrolling to the top, with a long reply: the same.
- **b**: as the long reply grows past the bottom edge, `scrollTop` moves no more than 1 px, there is content below the view, and the jump-to-latest arrow shows. On the two views that never send, the worker writes a long reply while the reader is at the end.
- **c**: a wheel turn over the feed mid-reply, then `scrollTop` moves no more than 1 px for the rest of the reply.
- **d**: at the end (reached by the arrow), a line that isn't the person's lands: `scrollTop` stays, and the arrow shows.
- **e**: from scrolled up, a switch to the other conversation: every frame that draws it, for 40 frames, is at its end (2 px).

The views that never send have b, d and e only.

**Anti-game:** nothing reads the hook's return values or counts `scrollTo` calls. The line is found by a fresh token in its text. Each app builds from its own config, so its own CSS lays the feed out. The page replaces data, not views.

**Model:** n/a (scripted replies).

**Run:** `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/conversation-scroll/sent-line-rises-reply-stays/run.mts`. It builds the four pages itself, in its own scratch folder. About four minutes. `GOAL_ONLY=<surface prefix>` runs only the surfaces whose id starts with it.

**Controls:** `GOAL_CONTROL=<name>` on the same command. Each serves `useJumpToLatest` patched in every page's build (`build.mts`), and must fail exactly its own signals on every surface that has them; any other red, or one of its signals green, is reported as `WRONG:`.

- `main-rule`: the hook as it was on `main` before this change (581142fb), plus a `mine` that only sets the attribute. A send goes to the end. Must fail **a.short** and **a.long** on all six surfaces that send.
- `no-reserve`: the hook keeps no space under the sent line. Must fail **a.short** and **a.long** on all six surfaces that send. The spec expected the short reply only; the person's line lands before its reply starts, so with no space it can't rise under either length.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-04 | dabee4a3 | n/a | PASS | all 42 signals on 8 surfaces. Risen line 16–46px below the feed's top; b drift 0–1px with the arrow shown; e at the end on every drawn frame |
| 2026-11-04 | dabee4a3 | n/a | FAIL (expected) | `main-rule`: a.short and a.long red on all six sending surfaces (the line 441–709px down, at the bottom edge), every other signal green |
| 2026-11-04 | dabee4a3 | n/a | FAIL (expected) | `no-reserve`: a.short and a.long red on all six sending surfaces, every other signal green |
