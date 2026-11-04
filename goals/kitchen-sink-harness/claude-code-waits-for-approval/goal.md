# kitchen-sink-harness › Claude Code waits for approval

**Issue:** FIX-2432, FIX-2503 (epic FIX-2369)

**Outcome:** In Kitchen Sink's Claude Code mode, a turn stops at each tool call that isn't already allowed, the conversation shows it waiting on the user, and their Allow or Reject reaches the same conversation, also after a server restart. No call runs that nobody allowed.

**Input:** a scratch git repository as the harness workspace (`KITCHEN_SINK_HARNESS_WORKSPACE`), so the checkout is never touched, and file names picked per run. The scripted Claude Code in test mode (`KITCHEN_SINK_TEST_MODE=1`), whose `[ask:<file>]` turn runs `touch <file>` in the session's worktree, asking first the way Claude Code does. A durable store (`STORE_TYPE=filesystem`).

**Signal:** one real browser against `next dev`.

- **a:waits**: the turn's request is suspended. The conversation shows the approval card naming the tool (`Bash`), the command (`touch <file>`) and the session's worktree, offering *Allow for this run*, and the turn's notice reads *Waiting on you*.
- **b:ran-after**: the command had not run while the turn waited, nor across the restart. After Allow it ran exactly once.
- **c:same-conversation**: the server restarts while the turn waits. After a reload the card is still there, and Approve on it resumes the turn. With no further reload, the page follows the turn to its end (the notice reads `continued`), the session stays on the conversation the waiting turn showed, and the resumed reply continues that conversation.
- **f:approve-then-send**: with no restart, Approve on the page's card. The page follows the turn to its end (the notice reads `continued`), the command ran once, and the next message runs: its turn completes and nothing says a turn still waits.
- **d:never-ran**: in a second session, Reject on the page's card. The command never ran, and the turn completed.
- **e:one-at-a-time**: a message sent while that second session's turn waits is held, not sent: no request is made, the page says the message waits on the answer to the card, the waiting card is in view with Approve and Reject, Stop is offered, the notice still reads *Waiting on you*, and the message stays in the composer.
- **s:stop**: while a third call waits, the server restarts and the page reloads. A message sent then is held the same way, and Stop ends the turn (the notice reads `stopped`). The call never ran, and the held message then sends and continues the conversation.

**Anti-game:** the answers are clicks on the page's own card (c, d), never a store write, and c reads the resumed turn off the page without a reload, so a page that stops following the turn after an answer fails it. What ran is the file the scripted call appends to in the worktree, one line per run, which survives the restart; the conversation and the card are read off the page. The suspension's id is read off the card.

**Model:** none. The scripted Claude Code runs no model.

**Host setup:** none. Runs as root, without a Claude Code sign-in.

**Run:** `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/kitchen-sink-harness/claude-code-waits-for-approval/run.mts`

**Controls:** on the same command.

- `GOAL_CONTROL=no-approval`: the mode leaves the session flow's `approveTools` off, so the run is handed no approval feed and the scripted Claude Code can't ask. **a**, **b**, **c**, **d** and **e** FAIL: no card shows, nothing waits, and the call is denied unasked.
- By hand: take `SuspensionResolverProvider` off the harness page (`components/harness-session.tsx`). **c** FAILS: after Approve the notice stays `waiting` and no resumed reply shows.
- By hand: show Stop only while the turn streams (`session.isStreaming`). **s** FAILS: the waiting turn offers no Stop.
- `main` before FIX-2503 (the page sends a message while a turn waits): **e** and **s** FAIL. The flow refuses the message, the refused turn becomes the latest one, so the notice reads `error` and Stop is gone, and the waiting turn can no longer be stopped from the page, also after a reload.
- By hand: drop the stop check from `turnWaitingOnApproval` (`lib/harness-turn.ts`). **s** FAILS: after Stop the notice stays `waiting`, because the session's record still says the turn waits when the page reads it.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-02 | 200461e | none (scripted) | **PASS** | Linux container, root, no sign-in. All five legs pass: the card named `Bash`, `touch allow-…` and the worktree under the scratch state home; after the restart and Allow through the client the turn completed, the file had one line, and the session stayed on the conversation the waiting turn showed; the message sent while the second session waited failed and the page said why; after Reject the turn completed and nothing ran. `GOAL_CONTROL=no-approval` FAILED **a**, **b**, **c**, **d** and **e**: no card showed and the turn completed with the call denied unasked |
| 2026-11-02 | 8d3c1e390 + FIX-2480 | none (scripted) | **PASS** | All six legs. c now answers on the page's card after the restart and reads the resumed turn off the page: the notice read `continued` and the reply continued the waiting turn's conversation; the file had one line. s: Stop showed while the turn waited, the notice read `stopped`, the call never ran, the next turn continued. Controls: `no-approval` FAILED every leg. `main`'s page (8d3c1e390) FAILED **c** (notice stayed `waiting`, no resumed reply) and **s** (no Stop). Taking the provider off alone FAILED **c** (and **s**, whose turn then starts from a page that never followed the Reject); hiding Stop while waiting alone FAILED **s** only |
