# kits › an app is configuration, UI and small flows

**Issue:** FIX-2629, the closure of epic FIX-2618. Its spec's goal: `specs/issues/FIX-2629/SPEC.md` → "The goal, and how we'll know it's met".

**Outcome:** On one commit, the Claude Code-style lab runs on the workforce and harnesses kits with
no adapter: in a browser, on a real model, a person starts a thread, has it delegate a coding task,
sees the task's row change and pins it, and every write the client makes to a user or org resource
is a request in a flow. The teammates host installs the same kits.

**Input:** a held-out ask (`fixtures/input.json`): a coder leaves a short note in a fresh `file://`
repository, as a new committed file. No worker file, prompt or flow names it. The coding flow's
judge (a model) reads every run against its goal, so the ask is one the scripted coder's single
committed file (`SCRIPTED-RUN.md`) meets; an ask it can't meet ends `errored`, never `completed`. One user per
run, a fresh data folder per leg, Chromium through `goals/lib/playwright.mts`. The coding task runs
on harness-manager's scripted coder (`CLAUDE_CODE_STYLE_HARNESS=stub`, a step every 2 s) through the
harnesses kit's slot, coding flow and board view (spec D2).

**Signal:**
- `a:thread` — in a new session on a repository (the Projects view), your line and the lead's reply show in the thread.
- `a:delegate` — the lead files a coding task for `desk.thread-coder`; its row shows in the Tasks pane, and the session's board (`listTasks_tasks`) lists it.
- `a:row-changes` — the task goes from `in_progress` to `completed` (its review accepted from its card, as a person does: *Merge locally*, or *Resolve* when the review lists no way to land); each change of its status or column shows on its row within 1 s of the store's change, timed by a `MutationObserver` in the page against the store's watcher; then in 10 s idle the page sends 0 view reads.
- `a:pin` — *Pin* in the task's view shows it pressed; after a reload the row is under *Pinned*; the store's `lab-pins` holds it; exactly one new request, on the default write flow (`fsd-default-write`), in a session owned by this user.
- `a:no-read-session` — every session the run made has a request, a task or a run in it (the probe flow's own session for leg w is left out by name).
- `a:inventory` — the lab's inventory rules (the shared `labs/test-support/inventory.mts` with the lab's `test/inventory-settings.ts`, which its `pnpm test` runs) with no file exempt: no adapter, no code in `workforce/`, every file classed (L1), ER-1's caps (L2), no UI file reaching the server itself, `src/lab.ts` included (L3), no hand-written row type (L4), no host wiring (H), no own-session helper anywhere in product source (S).
- `b:installs` — the teammates host lists the workforce and harnesses kits and passes the host rule; it serves the kit's `coder` flow and no coding flow of its own; `goals/teammates-lab/a-coding-task-waits-for-your-review/` passes on it.
- `b:folder` — `workforce/teams/teammates/notes.json`, planted, stops the host starting, and the refusal names it.
- `b:one-home` — no app's `workforce/` holds code, and no flow an app keeps in `flows/` is defined by a package too. Definitions are read whole, across lines; the leg checks its reader finds a multiline definition first.
- `w:routes` — every route of the router's table that isn't a read is in a class; the content routes' create, update and delete answer 501 at user and org scope on a skills collection (exempt by name until FIX-2633).
- `w:no-runby` — a write to a user resource with no `runBy` is refused by the action route, and to a user collection with no `runBy` by a content route; nothing is stored.
- `w:recorded` — every user or org resource write while leg a ran (its probes and the seam's pins included), and every write teammates' screen makes to the user's workers on leg b's host (hire, edit, reset, fire), matches a request by the signed-in user, in a session the store holds, running at the write, that touched that resource: it streamed a `resource_change` for that scope and key, or ran in the server's write session for that resource. Writes are read from a trigger log the goal installs on the store (`closure_write_log`), so a version written between two looks, or a delete, is never missed; a version gap in the log fails.
- `seam:pin-reaches-view` — five pins written through the default write flow each reach `pinsSeen`, a user view on another flow (the goal's probe flow) that reads the lab's pins, within 1 s of the write landing, watched with no poll timer (O2's host-wide publish, FIX-2623 against FIX-2624).
- `j2:renders` — Shift Manager over DevTeam opens Projects (`/p/storefront`), Usage and Schedules (`/routines`, titled *Routines*): each draws its title, with no failure and no page error.
- `j2:no-read-session` — every session made while the page read has a request, a task or a run.
- `j2:read-writes-nothing` — opening Schedules adds 0 requests; opening Usage adds only its one Re-check on the usage flow (FIX-2624 kept it: opening Usage asks for a fresh reading).
- `j2:identity` — the project drawn is one the store holds under the identity read's org. DevTeam serves one org, so the spec's "one user in two orgs" isn't set up: that needs a host option DevTeam lacks.
- `j4:one-row` — the goal files a second task, so the board holds two. Every re-read the page sends on a notice that names board rows (`changed.ids`, each a row key) answers only those rows, flagged `partial`. First reads, reloads and notices that name other ids are counted apart.
- `j4:no-rows` — no socket frame carries the task's title or goal.
- `j5:one-hook` — the glossary's vocabulary sweep (`goals/vocabulary/one-word-per-thing/sweep.mjs`) passes the tree and fails a planted `reads: ReadConfig` (`flow-reads`).
- `j5:no-model` — a model call in a view is refused (`view_model_call`) at session, user and org scope, on the lab's host.

**Anti-game:** every grade reads the rendered page, the browser's own traffic, the store
(sessions, requests, every user and org resource's versions) or the source tree. Nothing reads a
view's answer, a lab hook's return or a kit's unit tests to pass a signal (the board's view answers
are read only to count rows for j4). The lab's poll timer is left as the lab ships it: the idle
window shows whether it fires while push is up.

**Retries:** up to `GOAL_ATTEMPTS` (3) fresh runs, only when a model gave nothing to grade: the lead filed no coding task, or the judge sent the scripted run back. Never under a control.

**Model:** real for the thread: the lab's default (`openai/gpt-5.4`) through the AI Gateway. The coding task runs on the scripted coder (no model). `b:installs`'s teammates goal runs Cursor for real (`CURSOR_API_KEY`).

**Run:** `cd goals && pnpm tsx kits/an-app-is-config-ui-and-small-flows/run.mts` (`GOAL_LEGS=a,b,w,seam,j2,j4,j5`, the default, picks legs; w, seam and j4 ride on a). The lab's pages built first: `pnpm --filter @flow-state-dev/claude-code-style build`.

**Wall time:** a full run takes about 15 to 40 minutes. Most of that is two legs. Leg b runs the nested teammates goal `a-coding-task-waits-for-your-review`, a real Cursor run capped at 30 minutes. Leg a runs a real-model thread, about 5 minutes per attempt, up to 3 attempts. Leg j2 also builds Shift Manager's pages first, which takes about a minute. To re-grade one part, name its legs: `GOAL_LEGS=a,w,seam,j4,j5` skips leg b and j2, and `GOAL_LEGS=b` or `GOAL_LEGS=j2` runs that leg alone.

**Controls** (`GOAL_CONTROL=<name>`, same command). Runtime ones patch the engine as the lab loads it (`goals/lib/module-patch`); nothing is written to the checkout's code.
- `todays-main` — the inventory on the lab at `705c14017a`, the parent of the epic's first implementation merge (#5090). Must FAIL `a:inventory`.
- `planted-adapter` — `src/glue.ts` planted in the lab: a client import, a `.subscribe(` and a row type. Must FAIL `a:inventory` on L3 and L4.
- `blind-recorder` — the view route answers the coding board's view and the seam's `pinsSeen` with no topics, so no change reaches their watchers. Must FAIL `a:row-changes` and `seam:pin-reaches-view`.
- `direct-write` — the content routes write at user and org scope instead of answering 501. Must FAIL `w:routes` and `w:recorded`.
- `schedules-write` — Shift Manager's pages built from a copy whose Schedules sends a write on each read. Must FAIL `j2:read-writes-nothing`.
- `direct-write-busy` — `direct-write` made while the lead answers a line, so another request of the user's runs. Must FAIL `w:recorded`, which a match by time alone passes.
- `half-partial` — every other change-driven re-read of the coding board drops its notice and answers the whole board. Must FAIL `j4:one-row`, which "some re-read was partial" passes.
- `no-work-ask` — the lead is asked for no work, one attempt. Must FAIL `a:delegate`: running out of attempts is graded, never a pass.
- `skip-unknown` — the kits' claim pass reports nothing unclaimed (FIX-2626's control). Must FAIL `b:folder`.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-17 | main `c5c3b8d0f6` + this goal (`a4af152326`) | openai/gpt-5.4 (thread), scripted coder | FAIL | Run 1 of the closure. Only `a:inventory` fails: L2 configuration 528 lines, cap 300 (`host.mts` 272); L3 `src/lab.ts` imports 5 client values and makes 1 `.subscribe(` and 6 `.flow(` calls; H `host.mts:270` `as never`. Every other assertion passed: the lead filed the task on attempt 1; row latencies in_progress/working ≤0, in_progress/review 14 ms, completed/resolved ≤0 ms; 0 view reads in 10 s idle; the pin one `fsd-default-write` request, pinned after a reload; no read-only session; 21 non-read routes classed, content routes 501 at user and org; no-`runBy` writes refused (403, 501); 21 of 21 versions matched a request; 7 partial board re-reads, 0 of 399 frames carry a row; the sweep failed the plant; each scope's model view 422 `view_model_call` |
| 2026-11-17 | same tree | — | FAIL (expected) | `todays-main` (`705c14017a`): every rule red: the adapter and fake lab, 5 flows in `workforce/flows`, L2 402 lines, L3 `src/adapter.ts` 5 client imports, 3 subscribes, 10 flow calls, L4 14 types, H the installation, hire and 3 casts, S 59 own-session lines |
| 2026-11-17 | same tree | — | FAIL (expected) | `planted-adapter`: L3 `src/glue.ts` imports `createClient` and subscribes, L4 `src/glue.ts: BoardRow` (beside the standing L2, L3 and H findings) |
| 2026-11-17 | same tree | openai/gpt-5.4 | FAIL (expected) | `blind-recorder`: `a:row-changes` (the row never showed in_progress; no accept on the card), and `a:delegate`, `a:pin` with it: the board read once, empty, and never again |
| 2026-11-17 | `b413d969e6` | openai/gpt-5.4 | FAIL (expected) | `direct-write`: `w:routes` (content create 201, delete 200 at user and org) and `w:recorded` (3 user versions with no request), `w:no-runby` (noteBook create 201) |
| 2026-11-17 | `d22c25aa9d` | Cursor `composer-2.5` (teammates' run) | FAIL | Leg b: only `b:installs` fails, on `labs/teammates/host.mts` lines 340, 375, 392 (`as never`). Kits listed; flows `agent, claude-code, coder, github-service, harnesses, lab-context, workforce-roster`; `a-coding-task-waits-for-your-review` PASS 1 of 1; `notes.json` refused by name; `b:one-home` clean |
| 2026-11-17 | `d22c25aa9d` | — | FAIL (expected) | `skip-unknown`: `b:folder`: teammates started beside `workforce/teams/teammates/notes.json` |
| 2026-11-17 | `3665d07a44` (main `c5c3b8d0f6` merged up) | openai/gpt-5.4, scripted coder | FAIL | Run 2: still only `a:inventory` (L2, L3, H: FIX-2757). `seam:pin-reaches-view` PASS, 5 pins seen −2 to 6 ms after each write landed; a, w, j4, j5 as run 1 |
| 2026-11-17 | `3665d07a44` | openai/gpt-5.4 | FAIL (expected) | `blind-recorder`: `a:row-changes` and `seam:pin-reaches-view` (no pin reached `pinsSeen` in 3 s), with `a:delegate` and `a:pin` |
| 2026-11-17 | `6cbddb493b` | — | FAIL | `j2`: renders, read-writes-nothing (Schedules 0, Usage 1 Re-check) and identity (devforce-lab, 3 projects) PASS; `j2:no-read-session` FAILS: opening a project (`Project.tsx`, `ensureWorkerSession` for its coordinator) makes session `wks_…` (coordinator) with no request |
| 2026-11-17 | `6cbddb493b` | — | FAIL (expected) | `schedules-write`: `j2:read-writes-nothing`: opening Schedules added 1 request (`workforce-roster`) |
| 2026-11-17 | `b79b3b9279` | openai/gpt-5.4, scripted coder | FAIL | Run 3, after the grader fixes. Only `a:inventory` (FIX-2757). `w:recorded` 48 of 48 writes tied to a request that touched the resource, 0 gaps in the trigger log; `j4:one-row` 8 re-reads on notices naming board rows, all partial with 1 row, the board at 2 tasks; 3 re-reads on run notices answered whole and are counted apart; seam, j5 as before |
| 2026-11-17 | `f756a6a7a0` | openai/gpt-5.4 | FAIL (expected) | `direct-write-busy`: `w:recorded` fails 2 writes made while another request ran ("1 other request(s) were running"): a time-only match passed them. `w:routes`, `w:no-runby` too |
| 2026-11-17 | `b79b3b9279` | openai/gpt-5.4 | FAIL (expected) | `half-partial`: `j4:one-row` fails 6 whole answers (2 rows) to notices naming 1 row; 5 others were partial, which "some re-read was partial" passed |
| 2026-11-17 | `f756a6a7a0` | openai/gpt-5.4 | FAIL (expected) | `no-work-ask`: `a:delegate`: nothing to grade in 1 attempt. Before the fix, running out of attempts recorded no failure |
| 2026-11-17 | `f756a6a7a0` | Cursor `composer-2.5` | PASS | Leg b after main brought FIX-2758: `b:installs` (host rule clean), `w:recorded` (teammates) 4 of 4 writes (hire, edit, reset, fire on `workforce-roster`), `b:folder`, `b:one-home` |
| 2026-11-20 | `e2c6e814b9` (FIX-2766 #5514 head with main merged) | n/a | FAIL | FIX-2766, leg a only (`GOAL_LEGS=a`): the leg crashed before grading, `TypeError: Cannot read properties of undefined (reading '0')` in `columnOf`. `leg-a.mts`'s `columnOfStored` built the deleted `AppTask` shape (`openHold`); `columnOf` now reads the row's `asks`. The inventory note was all clean |
| 2026-11-20 | same + `columnOfStored` building `asks` | n/a | PASS | Leg a only: inventory clean on every rule (L4 included, `AppTask` gone); row latencies in_progress/working -604 ms, in_progress/review 42 ms, in_progress/working 39 ms, completed/resolved 57 ms; 0 view reads in 10 s idle; the pin one `fsd-default-write` request. Legs b, j2, j4, j5 not run |
