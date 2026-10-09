# workforce-mailboxes › a fresh host wakes its member agents

**Issue:** FIX-1602 (VG of the spec's PLAN; feeds the epic FIX-1592's closure, FIX-1601). Converted by FIX-1792 (BR-9): the mailbox is a coordinator's worker file now.

**Outcome:** An app with none of kitchen-sink's code hands each post in a person's conversation with a coordinator to every agent delegate once, and a delegate's answer wakes nobody, by declaring the coordinator in a `WORKER.md` (`flow: coordinator`, `routing: everyone`) and registering Workforce's `coordinator` flow. Kitchen-sink runs on that same flow.

**Converted (FIX-1792).** The folder name is kept so its verdict history stays in one place. Until FIX-1792 this read a `MAILBOX.md` whose post woke each agent member through `wakeMemberSeats` in the mailbox's notify slot. The mailbox is a coordinator now: `members:` became `delegates:`, and a file with no `routing:` line got `routing: everyone`, which is what its mailbox did. The **seat-post** leg (a member's own post wakes nobody) has no door to post through on a coordinator; its outcome, that what a worker says wakes nobody, is now **quiet** (a delegate's answer wakes nobody), and its control flips the setting that holds it.

**Input:** `fixtures/workforce/`: one team, two agent workers (no `flow:`), one worker of the app's own `note` flow (only a public action, no delegated-post entry), and one coordinator naming all three as delegates. `host.mts` is the app: the tree, the published packages, and the `coordinator` flow registered with the built-in `agent` as the flow its delegates take posts on. Held-out: who is an agent delegate is read off the tree (a worker with no `flow:`), never hardcoded, and each run's posts carry fresh tokens.

**Signal:** the host served in-process on in-memory stores and a scripted model. The person opens a conversation with the coordinator the way a page does (a session on `coordinator` naming it) and posts twice through its public `run` action. Everything graded is read back through the host's own router, the routes a page reads: the conversation's items, and each worker's conversations, dispatch runs included.

- **import**: `defineCoordinatorFlow` resolves from `@flow-state-dev/workforce`. Checked first; the rest needs it.
- **woken**: each agent delegate holds exactly one conversation under the person's, and in it each post is heard in exactly one `user` turn with an `assistant` reply right under it.
- **answers**: the person's conversation holds exactly one answer line per post from each agent delegate, under its name, and none by anyone else.
- **quiet**: no worker's conversation holds a delegate's answer as a turn it heard.
- **other**: the `note` delegate holds no conversation.
- **org**: the person's conversation and every delegate conversation under it carry the org the host names in `resolvePrincipal`, not the development default (FIX-1792 BR-25). Read from the host's session store, since the router scopes what it lists to the caller's org and could not show a session that landed in another.
- **source**: `host.mts` imports only `@flow-state-dev/*`, calls `defineCoordinatorFlow`, and builds no `dispatcher`, `keyedRouter` or `router`; the tree's coordinator routes to `everyone`. Kitchen-sink's `workforce/hire.ts` calls `defineCoordinatorFlow` and builds none of the three, and its `SEAT_ASKS` has no `wake` column.

**Anti-game:** no assertion on the router's output, a dispatch handle, a routing record, or a unit test. Only what each worker's own conversation kept and what the person's conversation holds count, read through the routes, and only this run's tokens. The wait before grading polls until every request has settled and then gives a wrongly woken worker 1.5s to run; none of it is graded. Kitchen-sink's runtime half is not re-proved here: `kitchen-sink-talk`'s goals are re-run on the converted app.

**Model:** n/a. The built-in agent flow answers from a scripted model (`@flow-state-dev/testing`), keyless (epic FIX-1592 D3). The goal is who ran, not what they said.

**Run:** `pnpm --dir goals exec tsx workforce-mailboxes/a-fresh-host-wakes-its-member-agents/run.mts`

**Controls:** on the same command. Each is applied by the check around the host, never inside the package.

- `GOAL_CONTROL=no-wake`: the coordinator flow is registered with no flow a delegate takes a post on. Must FAIL at **woken** and **answers**, and at nothing else.
- `GOAL_CONTROL=answers-go-on`: the coordinator's file is read with `rounds: 1`, so each round's answers go back out to the other delegates. Must FAIL at **answers** (each delegate answers the other's answer too) and **quiet**, and at nothing else.

- `GOAL_CONTROL=no-org`: the host's `resolvePrincipal` left out, so nothing names its org. Must FAIL at **org** (every session carries `__fsd_default_org__`), and at nothing else.

The **import** and **source** legs have no control: a checkout without the export fails **import**, and kitchen-sink's pre-conversion `workforce/hire.ts` fails **source**. Both were produced and are logged below.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-08 | `865abc573` + FIX-1788 P4 | scripted | FAIL (control) | `no-wake`: **woken** only (desk.amy and desk.oz hold 0 conversations). `no-author-filter`: **seat-post** only (desk.amy's own post heard by both). |
| 2026-10-08 | `865abc573` + FIX-1788 P4 | scripted | PASS | One copy each of `agent` and `note`; the wake runs `wakeMemberSeats(copies, { installation })`. desk.amy and desk.oz each hold one conversation of desk.front, a session on `agent` naming them, each post heard once and answered; desk.amy's own post heard by no worker; desk.ned (on `note`) none. |
| 2026-09-26 | FIX-1602 branch on a52bab37a, uncommitted | scripted | FAIL (control) | **`GOAL_CONTROL=no-wake`, taken first.** Failed at **woken** only: `desk.amy holds 0 conversations of desk.front (want 1)`, and the same for `desk.oz`. |
| 2026-09-26 | FIX-1602 branch on a52bab37a, uncommitted | scripted | FAIL (control) | `GOAL_CONTROL=no-author-filter`. Failed at **seat-post** only: `desk.amy's own post was heard by desk.amy ("u_fresh_host in desk.front: seat-token-… I looked; it is empty."), desk.oz (…)`. |
| 2026-09-26 | FIX-1602 branch on a52bab37a, uncommitted | scripted | FAIL (by hand) | The export removed from the mailbox barrel: failed at **import** (`@flow-state-dev/workforce exports no wakeMemberSeats`). Restored. |
| 2026-09-26 | FIX-1602 branch on a52bab37a, uncommitted | scripted | FAIL (by hand) | Kitchen-sink's `mailbox-notify.ts` and `workforce-shell.ts` put back as they were before the move: failed at **source** (`builds its own dispatcher`, `never calls wakeMemberSeats`, `SEAT_ASKS still carries a wake column`). Restored. |
| 2026-09-26 | FIX-1602 branch on a52bab37a, uncommitted | scripted | **PASS** | First verdict. `desk.amy` and `desk.oz` each hold one conversation of `desk.front` with both posts heard once and answered (`u_fresh_host in desk.front: wake-token-a… can someone look at the refund queue?`); `desk.amy`'s own post heard by no seat; `desk.ned` holds nothing; source clean. Also PASS with every folder and id renamed (`help.lobby`, `help.kai`/`help.bo` agents, `help.lu` note). |
| 2026-10-09 | `fix/FIX-1792-p1` on 54fcd1b15, uncommitted | scripted | FAIL (old check) | **Converted for FIX-1792 P1; the check before the conversion taken first.** The previous `run.mts` on the converted fixture (`desk.front` a coordinator `WORKER.md`): `TypeError` reading `declared` — the tree holds no mailbox for it to read. |
| 2026-10-09 | `fix/FIX-1792-p1` on 54fcd1b15, uncommitted, kitchen-sink not yet converted | scripted | FAIL (by hand) | The converted check before kitchen-sink's own conversion: every leg green but **source**, whose kitchen-sink half found `workforce/hire.ts` registering no `defineCoordinatorFlow`. |
| 2026-10-09 | `fix/FIX-1792-p1` on 54fcd1b15, uncommitted | scripted | **PASS** | **Converted.** `defineCoordinatorFlow` resolves from the package; the host registers it and builds no dispatcher or router; `desk.front` routes to everyone; kitchen-sink registers `defineCoordinatorFlow` too. `desk.amy` and `desk.oz` each hold one conversation under the person's conversation with `desk.front`, each post heard once and answered, two answer lines each, and neither heard the other's answer; `desk.ned` (on `note`) holds no conversation. |
| 2026-10-09 | same | scripted | FAIL (expected) | `GOAL_CONTROL=no-wake`: **woken** and **answers** only — `desk.amy` and `desk.oz` hold 0 conversations, and 0 answer lines. |
| 2026-10-09 | same | scripted | FAIL (expected) | `GOAL_CONTROL=answers-go-on`: **answers** and **quiet** only — 4 answer lines each, and each heard the other's answer (*desk.oz, through desk.front: [reply:fresh-host] noted.*). |
| 2026-10-09 | same | scripted | FAIL (by hand) | `defineCoordinatorFlow` dropped from the package barrel: failed at **import** only. Restored. |
| 2026-10-09 | `fix/FIX-1792-p1` on 343af0c77, uncommitted | scripted | FAIL | **The org leg added, the host not yet changed (FIX-1792 BR-25, from review).** **org** only: the conversation with `desk.front` and both delegate sessions carry `__fsd_default_org__`; the host had no `resolvePrincipal`, before the conversion and after it. Every other leg green. |
| 2026-10-09 | same | scripted | **PASS** | The host names `u_fresh_host` and `org_fresh_host` in `resolvePrincipal`. Every leg green; the conversation and its 2 delegate sessions carry `org_fresh_host`. |
| 2026-10-09 | same | scripted | FAIL (expected) | `GOAL_CONTROL=no-org`: **org** only — the conversation and both delegate sessions carry `__fsd_default_org__`. `no-wake` (**woken**, **answers**) and `answers-go-on` (**answers**, **quiet**) re-taken: each its own legs only, **org** green. |
