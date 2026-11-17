# kits › an app is configuration, UI and small flows

**Issue:** FIX-2629, the closure of epic FIX-2618. Its spec's goal: `specs/issues/FIX-2629/SPEC.md` → "The goal, and how we'll know it's met".

**Outcome:** On one commit, the Claude Code-style lab runs on the workforce and harnesses kits with
no adapter: in a browser, on a real model, a person starts a thread, has it delegate a coding task,
sees the task's row change and pins it, and every write the client makes to a user or org resource
is a request in a flow. The teammates host installs the same kits.

**Input:** a held-out ask (`fixtures/input.json`): a one-line change to a file of a fresh `file://`
repository, with a marker filled in per run. No worker file, prompt or flow names it. One user per
run, a fresh data folder per leg, Chromium through `goals/lib/playwright.mts`. The coding task runs
on harness-manager's scripted coder (`CLAUDE_CODE_STYLE_HARNESS=stub`, a step every 2 s) through the
harnesses kit's slot, coding flow and board view (spec D2).

**Signal:**
- `a:thread` — in a new session on a repository (the Projects view), your line and the lead's reply show in the thread.
- `a:delegate` — the lead files a coding task for `desk.thread-coder`; its row shows in the Tasks pane, and the session's board (`listTasks_tasks`) lists it.
- `a:row-changes` — the task goes from `in_progress` to `completed` (its review resolved with *Resolve* on its card); each change of its status or column shows on its row within 1 s of the store's change, timed by a `MutationObserver` in the page against the store's watcher; then in 10 s idle the page sends 0 view reads.
- `a:pin` — *Pin* in the task's view shows it pressed; after a reload the row is under *Pinned*; the store's `lab-pins` holds it; exactly one new request, on the default write flow (`fsd-default-write`), in a session owned by this user.
- `a:no-read-session` — every session the run made has a request, a task or a run in it (the probe flow's own session for leg w is left out by name).
- `a:inventory` — the lab's inventory rules (`labs/claude-code-style/test/inventory-rules.ts`, which its `pnpm test` runs) with no file exempt: no adapter, no code in `workforce/`, every file classed (L1), ER-1's caps (L2), no UI file reaching the server itself, `src/lab.ts` included (L3), no hand-written row type (L4), no host wiring (H), no own-session helper anywhere in product source (S).
- `b:installs` — the teammates host lists the workforce and harnesses kits and passes the host rule; it serves the kit's `coder` flow and no coding flow of its own; `goals/teammates-lab/a-coding-task-waits-for-your-review/` passes on it.
- `b:folder` — `workforce/teams/teammates/notes.json`, planted, stops the host starting, and the refusal names it.
- `b:one-home` — no app's `workforce/` holds code, and no flow an app keeps in `flows/` is defined by a package too.
- `w:routes` — every route of the router's table that isn't a read is in a class; the content routes' create, update and delete answer 501 at user and org scope on a skills collection (exempt by name until FIX-2633).
- `w:no-runby` — a write to a user resource with no `runBy` is refused by the action route, and to a user collection with no `runBy` by a content route; nothing is stored.
- `w:recorded` — every user or org resource version written while leg a ran matches a request by the signed-in user, in a flow session, running when the version was seen.
- `j4:one-row` — after the board's first read, a re-read on a task's change carries one row, not the board.
- `j4:no-rows` — no socket frame carries the task's title or goal.
- `j5:one-hook` — the retired-terms check passes the tree and fails a planted `reads: ReadConfig`.
- `j5:no-model` — a model call in a view is refused (`view_model_call`) at session, user and org scope, on the lab's host.

**Anti-game:** every grade reads the rendered page, the browser's own traffic, the store
(sessions, requests, every user and org resource's versions) or the source tree. Nothing reads a
view's answer, a lab hook's return or a kit's unit tests to pass a signal (the board's view answers
are read only to count rows for j4). The lab's poll timer is left as the lab ships it: the idle
window shows whether it fires while push is up.

**Retries:** up to `GOAL_ATTEMPTS` (3) fresh runs, only when the model filed no coding task. Never under a control.

**Model:** real for the thread: the lab's default (`openai/gpt-5.4`) through the AI Gateway. The coding task runs on the scripted coder (no model). `b:installs`'s teammates goal runs Cursor for real (`CURSOR_API_KEY`).

**Run:** `cd goals && pnpm tsx kits/an-app-is-config-ui-and-small-flows/run.mts` (`GOAL_LEGS=a,b,w,j4,j5`, the default, picks legs; w and j4 ride on a). The lab's pages built first: `pnpm --filter @flow-state-dev/claude-code-style build`.

**Controls** (`GOAL_CONTROL=<name>`, same command). Runtime ones patch the engine as the lab loads it (`goals/lib/module-patch`); nothing is written to the checkout's code.
- `todays-main` — the inventory on the lab at `705c14017a`, the parent of the epic's first implementation merge (#5090). Must FAIL `a:inventory`.
- `planted-adapter` — `src/glue.ts` planted in the lab: a client import, a `.subscribe(` and a row type. Must FAIL `a:inventory` on L3 and L4.
- `blind-recorder` — the view route answers the coding board's view with no topics, so no change reaches its watcher. Must FAIL `a:row-changes`.
- `direct-write` — the content routes write at user and org scope instead of answering 501. Must FAIL `w:routes` and `w:recorded`.
- `skip-unknown` — the kits' claim pass reports nothing unclaimed (FIX-2626's control). Must FAIL `b:folder`.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
