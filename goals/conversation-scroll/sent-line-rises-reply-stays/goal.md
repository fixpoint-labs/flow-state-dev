# conversation-scroll › a sent line rises, and its reply stays in view

**Issue:** FIX-2360; the registry surfaces FIX-2456

**Outcome:** In DevTool, Shift Manager, the Claude Code-style lab, the Teammates lab and an app built from the registry's components, a line you send rises to near the top of the view and its reply streams in below it, where you can read it. After that, nothing you didn't do moves the view.

**Input:** each app's own conversation views, built by the app's own Vite config from a scratch copy of its source, with the goal's page (`pages/`) as the entry. The page mounts the app's real components with the app's stylesheet, and replaces only the data source with a script (`pages/script.ts`): two conversations of 28 earlier lines each, a send that lands the person's line 150 ms later (as a server's echo does), then a reply that streams one sentence every 70 ms. A short reply is two chunks; a long one is 72 sentences, a few screens. A line that isn't the person's is a 30-sentence block.

- **DevTool**: `StreamView`. Each line sent is a request named by the line, as the panel dispatches an action; a send counts in `sends` first and its request lands after. A switch remounts the workspace by the session's key, as the panel does. A second `StreamView` (`first-send`) opens a session with no requests: it draws its empty state in place of the feed, so the first send is counted before the feed exists and the feed mounts with that request.
- **Shift Manager**: `Conversation` (sends through its own composer) and `TaskSession`. A second `Conversation` (`first-send`) has no conversation until its first line opens one: `ensure` sets the new session's id before the line lands, as the real one does. Its reads, the task and the send (`src/lib/{lab-data,conversation,send,task,run}`) are swapped at build time for `pages/shift-manager/fakes/`, which keep every other export of the real module. The task session's composer is the task frame's, so a send is counted in the task's `sent`, as that composer does.
- **Claude Code-style**: `Thread` and `ThreadView` (send through their own composers) and `Sheet`, the task panel, which never sends.
- **Teammates**: `Conversation` (sends through its own composer) and `SessionPopup`, which never sends.
- **Registry**: not an app in the repo. The registry is built from this checkout and served, and `fsdev ui add conversation request-group prompt-input message` installs it into a fresh host shaped as `shadcn init` leaves one (`goals/lib/registry-host.mts`). Every installed copy must be its registry source byte for byte before anything runs. `tokens` comes in as the items' dependency: named on the command line it is a theme, and shadcn stops to ask. The page (`pages/registry.tsx`) is an adopter's chat page over the script's lines as items. `registry/send` makes the feed with `useJumpToLatest`, passes it to `Conversation`, and its `PromptInput` calls `feed.sent()`. `registry/read-only` is a `Conversation` with no feed, keyed by the open conversation, which never sends.

**Signal:** read off rendered boxes and `scrollTop` in headless Chromium, per surface. The sent line is found by its text, never as "the last element".

- **a.short**: a send from the end with a short reply: the top of the sent line's text is 0 to 48 px below the feed's top edge, once the move ends and again when the reply ends.
- **a.long**: a send after scrolling to the top, with a long reply: the same.
- **b**: as the long reply grows past the bottom edge, `scrollTop` moves no more than 1 px, there is content below the view, and the jump-to-latest arrow shows. On the two views that never send, the worker writes a long reply while the reader is at the end.
- **c**: a wheel turn over the feed mid-reply, then `scrollTop` moves no more than 1 px for the rest of the reply.
- **d**: at the end (reached by the arrow), a line that isn't the person's lands: `scrollTop` stays, and the arrow shows.
- **e**: from scrolled up, a switch to the other conversation: every frame that draws it, for 40 frames, is at its end (2 px).
- **f** (Shift Manager's `first-send` only): a first line into a conversation the send creates, with a long reply: the line lands 0 to 48 px below the feed's top, then `scrollTop` moves no more than 1 px as the reply grows past the bottom edge, and the arrow shows.
- **f.empty** (DevTool's `first-send` only): the same, for a first send made while the view draws its empty state, before the feed mounts. The first request is the feed's first element, so its top is near the feed's top in any case; the `scrollTop` drift is the part that can fail.

- **g** (`registry/send` only): from where d left it, the page calls `sent()` and what lands is a line from someone else, so no line of the person's is marked: `scrollTop` moves no more than 1 px.

The views that never send have b, d and e only; each `first-send` has f or f.empty only.

**Anti-game:** nothing reads the hook's return values or counts `scrollTo` calls. The line is found by a fresh token in its text. Each app builds from its own config, so its own CSS lays the feed out. The page replaces data, not views.

**Model:** n/a (scripted replies).

**Run:** `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/conversation-scroll/sent-line-rises-reply-stays/run.mts`. It builds the five pages itself (the registry's after its install), in its own scratch folder. About five minutes. `GOAL_ONLY=<surface prefix>` runs only the surfaces whose id starts with it.

**Controls:** `GOAL_CONTROL=<name>` on the same command. Each serves `useJumpToLatest` patched in every page's build (`build.mts`), and must fail exactly its own signals on every surface that has them; any other red, or one of its signals green, is reported as `WRONG:`.

- `main-rule`: the hook as it was on `main` before this change (581142fb), plus a `mine` that only sets the attribute. A send goes to the end. Must fail **a.short** and **a.long** on all seven surfaces that send, **f**: the first send's conversation reopens at its end and the reply scrolls the view, **f.empty**: the reply scrolls the view, and **g**: the old `sent()` goes to the end on the next change, whatever lands.
- `main-registry` (registry surfaces only): the host's `conversation`, `request-group` and `prompt-input` put back as on `main` (f459e5fce) after the byte-equal check, and the page wired as `main`'s docs show it (`ScrollOnNewRequest`, no feed, no `sent()`). Must fail **a.short** and **a.long** on `registry/send` (the line lands over the 70dvh last group), **d** on both (`ScrollOnNewRequest` scrolls for any new request), and **g** for the same reason. The spec named a.short, a.long and d; g is the signal added with these surfaces, and it fails for d's reason. c and e stay green: `main`'s registry opens at its end, and doesn't follow the reply after a wheel. **b is not graded under this control:** `main`'s registry never follows a stream, but with no hook holding the view, the browser's layout sometimes nudges `registry/send` by up to 3 px as the reply grows, and sometimes not at all. The same code reads either way from run to run (seen 0 px three times, then 3 px four times in five). The run prints b's reading and holds it to neither colour.
- `no-reserve`: the hook keeps no space under the sent line. Must fail **a.short** and **a.long** on all seven surfaces that send. The spec expected the short reply only; the person's line lands before its reply starts, so with no space it can't rise under either length. Must fail **f** too: with no space under it, the first line can't rise (64 px down against 44 px).
- `key-reset`: the hook reopens the feed when a key arrives where there was none after a send, as a switch does. Must fail **f**.
- `mount-history`: the hook counts the person's lines a feed mounts with as already shown, even with a send waiting, so the line sent before the feed existed is opened on as history. Must fail **f.empty**: the reply scrolls the view as it grows.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-04 | dabee4a3 | n/a | PASS | all 42 signals on 8 surfaces. Risen line 16–46px below the feed's top; b drift 0–1px with the arrow shown; e at the end on every drawn frame |
| 2026-11-04 | dabee4a3 | n/a | FAIL (expected) | `main-rule`: a.short and a.long red on all six sending surfaces (the line 441–709px down, at the bottom edge), every other signal green |
| 2026-11-04 | dabee4a3 | n/a | FAIL (expected) | `no-reserve`: a.short and a.long red on all six sending surfaces, every other signal green |
| 2026-11-04 | b9a505ad + working tree | n/a | PASS | all 42 signals on 8 surfaces after the short-feed space, attach-time shown lines and typed-key fixes. Risen line 16–33px below the feed's top |
| 2026-11-04 | (same tree) | n/a | FAIL (expected) | `no-reserve`: a.short and a.long red on all six sending surfaces (441–709px down), no `WRONG:` |
| 2026-11-04 | a3e122cb + working tree | n/a | PASS | all 43 signals on 9 surfaces, with the new `shift-manager/first-send` leg: the first line 44px below the feed's top, scrollTop moved 0px while the long reply grew, arrow shown |
| 2026-11-04 | (same tree) | n/a | FAIL (expected) | `key-reset`: f red (the line 64px down, scrollTop moved 19px as the reply grew), no `WRONG:` |
| 2026-11-04 | (same tree) | n/a | FAIL (expected) | `main-rule`: a.short and a.long red on all six sending surfaces, f red (64px, moved 19px), no other red |
| 2026-11-04 | (same tree) | n/a | FAIL (expected) | `no-reserve`: a.short and a.long red on all six sending surfaces, f red (64px), no other red |
| 2026-11-04 | 6278d20c | n/a | PASS | all 44 signals on 10 surfaces, with the new `devtool/first-send` leg: the first request 13px below the feed's top, scrollTop moved 0px while the long reply grew, arrow shown |
| 2026-11-04 | 6278d20c | n/a | FAIL (expected) | `main-rule`: a.short and a.long red on all six sending surfaces, f red (64px, moved 19px), f.empty red (moved 33px), no `WRONG:` |
| 2026-11-04 | 6278d20c | n/a | FAIL (expected) | `no-reserve`: a.short and a.long red on all six sending surfaces, f red (64px), f.empty green (the first request is the feed's first element), no `WRONG:` |
| 2026-11-04 | 6278d20c | n/a | FAIL (expected) | `key-reset`: f red (64px, moved 19px), no `WRONG:` |
| 2026-11-04 | 6278d20c | n/a | FAIL (expected) | `mount-history`: f.empty red (moved 33px as the reply grew), no `WRONG:`. The hook at ee26bdc fails f.empty the same way (moved 33px) |
| 2026-11-06 | 1a6f0689 | n/a | PASS (registry) | FIX-2456: all 10 signals on `registry/send` and `registry/read-only`, on a fresh `fsdev ui add` host with byte-equal copies. Risen line 44px below the feed's top; b drift 0px with the arrow shown; d and g held at 4643; e at the end on all 40 frames |
| 2026-11-06 | 1a6f0689 | n/a | FAIL (pre-existing) | full run: 42 signals PASS on the other 10 surfaces that set up. `shift-manager/task-session` and `claude-code-style/task-thread` fail setup (feed never drawn; the lab's page throws `taskActions is not a function`): the same on `main`'s `run.mts`/`build.mts` (f459e5fce), from the apps changing after their fakes. Not this change |
| 2026-11-06 | 1a6f0689 | n/a | FAIL (expected) | `main-registry`: a.short and a.long red on `registry/send` (the line 149px down, over the 70dvh group), d red on both (scrollTop 4643 → 5191, 2776 → 3324), g red (5191 → 5407); b, c, e green; no `WRONG:` |
| 2026-11-06 | 1a6f0689 | n/a | FAIL (expected) | `no-reserve` (`GOAL_ONLY=registry/`): a.short and a.long red on `registry/send` (569px, 553px down), no `WRONG:` |
| 2026-11-06 | 1a6f0689 | n/a | FAIL (expected) | `main-rule` (`GOAL_ONLY=registry/`): a.short and a.long red (569px, 553px), g red (4643 → 5075); g added to its expected reds |
| 2026-11-06 | 3dceb2af + working tree | n/a | FAIL (expected) | `main-registry`, rerun: b read 3.0px on `registry/send` in 4 of 5 runs (0.0px in the 3 before). Made ungraded under this control. Then a.short, a.long, d (both), g red; no `WRONG:` in two runs. PASS run unchanged: all 10 signals |
| 2026-11-06 | 7c57e4de | n/a | PASS (10 surfaces) | Shift Manager and both labs on the registry's `ConversationScrollButton`: all 42 signals PASS on the 10 surfaces that set up, the arrow found by its *Jump to latest* label on every one. Risen line 16–45px below the feed's top. `shift-manager/task-session` and `claude-code-style/task-thread` still fail setup, as logged above (pre-existing) |
| 2026-11-06 | 7c57e4de | n/a | FAIL (expected) | `main-rule`: a.short and a.long red on all six sending surfaces that set up, f red (64px, moved 19px), f.empty red (moved 33px), g red; no `WRONG:` |
| 2026-11-06 | 7c57e4de | n/a | FAIL (expected) | `no-reserve`: a.short and a.long red on all six sending surfaces that set up, f red (64px); no `WRONG:` |
