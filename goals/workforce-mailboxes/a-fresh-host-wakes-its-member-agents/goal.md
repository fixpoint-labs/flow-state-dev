# workforce-mailboxes › a fresh host wakes its member agents

**Issue:** FIX-1602 (VG of the spec's PLAN; feeds the epic FIX-1592's closure, FIX-1601)

**Outcome:** An app with none of kitchen-sink's code wakes each agent seat in a mailbox once per post, and never on a seat's own post, by putting one Workforce call in the mailbox's notify slot. Kitchen-sink runs on that same call.

**Input:** `fixtures/workforce/`: one team, two agent seats (no `flow:`), one seat of the app's own `note` kind (only a public action, no `onMailboxPost`), and one mailbox naming all three. `host.mts` is the app: the tree, the published packages, and `wakeMemberSeats(seats)`. Held-out: who is an agent member is read off the tree (a worker with no `flow:`), never hardcoded, and each run's posts carry fresh tokens. Renaming the team, the mailbox and every worker, and reordering `members:`, passed unchanged.

**Signal:** the host served in-process on in-memory stores and a scripted model. Two person posts through the public action, then one post on the mailbox's internal seat entry (the door a seat's own post uses), carrying that member as `author`. Everything graded is read back through the host's own router, the routes a page reads: each seat's conversations, dispatch runs included.

- **import**: `wakeMemberSeats` resolves from `@flow-state-dev/workforce`. Checked first; the rest needs it.
- **woken**: each agent member holds exactly one conversation of the mailbox, and in it each person's post is heard in exactly one `user` turn with an `assistant` reply right under it.
- **seat-post**: no seat's conversation holds the agent's own post.
- **other**: the `note` member holds no conversation.
- **source**: `host.mts` imports only `@flow-state-dev/*`, calls `wakeMemberSeats`, and builds no `dispatcher`, `keyedRouter` or `router`. Kitchen-sink's `workforce/mailbox-notify.ts` calls `wakeMemberSeats` and builds none of the three, and its `SEAT_ASKS` has no `wake` column.

**Anti-game:** no assertion on the router's output, a dispatch handle, a router decision, or a unit test. Only what each seat's own conversation kept counts, read through the routes, and only this run's tokens. The wait before grading polls until the agents answer and then gives a wrongly woken seat 1.5s to run; none of it is graded. Kitchen-sink's runtime half is not re-proved here: FIX-1590's `a-post-runs-each-member-agent-once` and FIX-1594's `agent-replies-in-the-mailbox` are re-run on the thinned app.

**Model:** n/a. The built-in agent kind answers from a scripted model (`@flow-state-dev/testing`), keyless (epic FIX-1592 D3). The goal is who ran, not what they said.

**Run:** `pnpm --dir goals exec tsx workforce-mailboxes/a-fresh-host-wakes-its-member-agents/run.mts`

**Controls:** on the same command. Each is applied by the check around the host's wake, never inside the package.

- `GOAL_CONTROL=no-wake`: the mailbox gets no notify block. Must FAIL at **woken**, and at nothing else.
- `GOAL_CONTROL=no-author-filter`: the host strips `seatAuthored` from each delivery before the helper sees it. The agent's own post then wakes both agents. Must FAIL at **seat-post**, and at nothing else.

The **import** and **source** legs have no control: a checkout without the export fails **import** (as `main` did before this issue), and kitchen-sink's pre-move `mailbox-notify.ts` and `workforce-shell.ts` fail **source**. Both were produced by hand and are logged below.

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
