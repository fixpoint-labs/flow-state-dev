# mailbox-boards › it hands a task to a fresh hire

**Issue:** FIX-1778 (the spec's goal, check VG)

**Outcome:** A coordinator hires a worker for a skill nobody has, files it a task by name on a mailbox's task list, and the worker receives that task and runs it. The same holds for a worker hired before a restart, and for a worker the files declare on a list no code wired it to. A name nobody holds is refused when the task is filed.

**Input:** `fixtures/workforce/` — one team `ops`, one mailbox `desk` whose `MAILBOX.md` declares `boards: [work]`, and one declared worker `auditor` on the built-in `agent` kind. No worker kind is wired to the list. Each task's goal is "Reply with the word `<word>` and nothing else.", the word random hex picked at run time, so a result holding it can only come from a model that read this task.

**Signal:** four legs over a real `createFlowState` host. The host is played the way an app plays it: the `agent` kind takes tasks from the mailbox's lists, the mailbox checks assignees with the worker lookup's filing check, and a coordinator flow holds the hire tool and a board over the list whose fallback asks the lookup. The legs act only through the coordinator's `hire`, the mailbox's `fileTask` and the coordinator's `drain`.

(a) **Hired after start.** The coordinator hires an `agent` worker, then files it a task by name and drains. (b) **Hired before a restart.** Hired, the host disposed and rebooted over the same storage (its hires reloaded the way a host reloads them), then filed and drained. (c) **A declared worker** on the list. Each of a–c passes only when: the task settles `completed` with the word in its result; the run the row links to is on the named worker's own flow (its flow id is the worker's address); that run's input holds the task's goal; and no request on any other flow took the task. (d) **A name nobody holds** is refused by `fileTask`, naming it, and no row for it exists.

**Anti-game:** The check never registers a flow by hand (the hire tool registers, and the boot reload re-registers), never calls the lookup, and never seeds a row. It grades the run off the row's run link and the stored request records, never off the drain's report. The word is held out, so a canned result can't pass.

**Model:** `openai/gpt-5.4-mini` for the workers, through the AI Gateway (`AI_GATEWAY_API_KEY`).

**Run:** `pnpm tsx goals/mailbox-boards/it-hands-a-task-to-a-fresh-hire/run.mts`

**Controls:** each must FAIL leg a on "no run on the hire's flow", with the hire landing.

- `GOAL_CONTROL=fixed-routes`: the board holds one fixed route per declared worker and no lookup, the shape a list had before this change.
- `GOAL_CONTROL=pinned-gate`: the `agent` kind takes tasks only from a list of its own, the shape a kind that declares its own board has.

Under D3 (ii) legs a and c would subscribe the worker to the list before filing. That fence is checked in the filing door FIX-1779 ships, so this check does not subscribe; re-run it with the subscription once that door lands.

## Verdict log

| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-05 | claude/project-thread-x3ofux on 4c8e19ef, uncommitted | openai/gpt-5.4-mini | PASS | a: `licenses-eb4a`, hired after start, completed on `org%5Ffresh%5Fhire.licenses-eb4a` with result `"adff3827"`. b: `keeper-d107`, hired before the restart, completed on its address with `"905c7712"`. c: `ops.auditor` completed on `ops.auditor` with `"dd1b8034"`. d: `nobody-4988` refused, "unknown-assignee: No worker is named \"nobody-4988\"", no row. |
| 2026-10-05 | same (control: `fixed-routes`) | openai/gpt-5.4-mini | FAIL (expected) | a and b: "no run on the hire's flow", the row errored "no block registered under key \"licenses-8a38\" … Available: ops.auditor". The hires landed. c passed on its fixed route. |
| 2026-10-05 | same (control: `pinned-gate`) | openai/gpt-5.4-mini | FAIL (expected) | a, b and c: "no run on the hire's flow", the row left `in_progress`: the worker's task door refused a list it does not take tasks from, before reading the row. The hires landed. |
| 2026-10-05 | 3f7ee50d + review fixes (filer at hand-over, queued door) | openai/gpt-5.4-mini | PASS | a: `licenses-6d27` → "c9ceae73". b: `keeper-d1da` → "b0d3d9c2". c: `ops.auditor` → "6494cad9". d: `nobody-9103` refused "unknown-assignee". |
