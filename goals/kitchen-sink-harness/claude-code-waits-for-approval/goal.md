# kitchen-sink-harness › Claude Code waits for approval

**Issue:** FIX-2432 (epic FIX-2369)

**Outcome:** In Kitchen Sink's Claude Code mode, a turn stops at each tool call that isn't already allowed, the conversation shows it waiting on the user, and their Allow or Reject reaches the same conversation, also after a server restart. No call runs that nobody allowed.

**Input:** a scratch git repository as the harness workspace (`KITCHEN_SINK_HARNESS_WORKSPACE`), so the checkout is never touched, and file names picked per run. The scripted Claude Code in test mode (`KITCHEN_SINK_TEST_MODE=1`), whose `[ask:<file>]` turn runs `touch <file>` in the session's worktree, asking first the way Claude Code does. A durable store (`STORE_TYPE=filesystem`).

**Signal:** one real browser against `next dev`.

- **a:waits**: the turn's request is suspended. The conversation shows the approval card naming the tool (`Bash`), the command (`touch <file>`) and the session's worktree, offering *Allow for this run*, and the turn's notice reads *Waiting on you*.
- **b:ran-after**: the command had not run while the turn waited, nor across the restart. After Allow it ran exactly once.
- **c:same-conversation**: the server restarts while the turn waits, then Allow goes through the client's answer route. The turn completes, the session stays on the conversation the waiting turn showed, and the resumed reply continues that conversation.
- **d:never-ran**: in a second session, Reject on the page's card. The command never ran, and the turn completed.
- **e:one-at-a-time**: a message sent while that second session's turn waits is refused, and the page says another turn is waiting for an answer about a tool call.

**Anti-game:** the answers go through the client's answer route (c) and the page's own card (d), never a store write. What ran is the file the scripted call appends to in the worktree, one line per run, which survives the restart; the conversation and the card are read off the page. The suspension's id is read off the card.

**Model:** none. The scripted Claude Code runs no model.

**Host setup:** none. Runs as root, without a Claude Code sign-in.

**Run:** `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/kitchen-sink-harness/claude-code-waits-for-approval/run.mts`

**Controls:** on the same command.

- `GOAL_CONTROL=no-approval`: the mode leaves the session flow's `approveTools` off, so the run is handed no approval feed and the scripted Claude Code can't ask. **a**, **b**, **c**, **d** and **e** FAIL: no card shows, nothing waits, and the call is denied unasked. Today's `main` fails **a** the same way, since its mode pre-allows every call (`bypassPermissions`).

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-02 | (this branch, before commit) | none (scripted) | **PASS** | Linux container, root, no sign-in. All five legs pass: the card named `Bash`, `touch allow-…` and the worktree under the scratch state home; after the restart and Allow through the client the turn completed, the file had one line, and the session stayed on the conversation the waiting turn showed; the message sent while the second session waited failed and the page said why; after Reject the turn completed and nothing ran. `GOAL_CONTROL=no-approval` FAILED **a**, **b**, **c**, **d** and **e**: no card showed and the turn completed with the call denied unasked |
