# kitchen-sink-harness › Claude Code waits for approval

**Issue:** FIX-2432 (epic FIX-2369)

**Outcome:** A user works a Claude Code session in Kitchen Sink. A tool call that isn't read-only stops the turn: the conversation shows an approval card naming the command and the folder, and the turn says it is waiting on them. Allow resumes the same conversation and the call runs, also when the server restarted while it waited. Deny tells the conversation it may not, and the call never runs. Nothing runs that nobody allowed.

**Input:** a fresh random token per run, naming the file the call makes. A durable store (`STORE_TYPE=filesystem`). A throwaway git repository as the harness workspace (`KITCHEN_SINK_HARNESS_WORKSPACE`), so no run touches this checkout.

**Signal:** one real browser against `next dev` in test mode, on the scripted Claude Code, whose `[touch:<file>]` call asks through the run's `canUseTool` as Claude Code does. Every answer is a click on the card, which sends it through the client's answer route.

- **a** `a:waits`: the turn asks to `touch` the token's file. The page shows an approval card naming `touch <file>` and the session's worktree, with *Allow for this run*. The notice reads *Waiting on you* (`data-kind="waiting"`), and the turn's request is `suspended`.
- **c** `c:same-conversation`: the server is stopped and started again while the card waits. After a reload the card is still there. Approve on it resumes the turn, the page follows it to its end (the notice reads `continued`), and the conversation the page shows is the one the turn started.
- **b** `b:ran-after`: the call didn't run while the turn waited or across the restart, and ran exactly once, no earlier than the click. The scripted call appends one timestamped line to its file per run.
- **e** `e:one-at-a-time`: while the next call waits, a message sent from the composer is refused, the conversation says why, and the card stays.
- **d** `d:never-ran`: Reject on that card ends the turn, and the call never ran.
- **s** `s:stop`: while a third call waits, the page offers Stop. It ends the turn (the notice reads `stopped`), the call never ran, and the next turn runs on the same conversation.

**Anti-game:** answers are clicks on the page's own card, never a store write. What ran is the file on disk, which only the scripted harness's allowed call writes. Leg **c** restarts the server process, and reads the turn's end off the page, not the store, so a page that stops following the turn fails it.

**Model:** none; the scripted Claude Code runs no model.

**Run:** `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/kitchen-sink-harness/claude-code-waits-for-approval/run.mts`

**Controls:** on the same command.

- `GOAL_CONTROL=no-approval`: Claude Code mode runs without approvals. **a** FAILS: no card shows, and the call is denied without asking. The other legs answer a card, so they are not graded under it.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-02 | f176a85da + this change | n/a (scripted) | **PASS** | Container (root, test mode). a, c, b, d pass: the card named `touch <file>` and the worktree, the notice read waiting and the request was suspended; after a server restart and reload the card was still there, Approve resumed the same conversation, and the file was made ~51 s after the click (the stopped server's worktree hold going stale). Control `no-approval` failed **a** only: no card, the file made unasked |
| 2026-11-02 | f176a85da + the run-count and refusal legs | n/a (scripted) | **PASS** | All five legs: **b** ran 0 times while waiting and across the restart, then once, ~50 s after the click; **e** the message sent while the next call waited was refused and the conversation said why. Controls: `no-approval` failed **a** only (no card, the call ran 0 times); taking the page's `SuspensionResolverProvider` out failed **c** only (the notice stayed `waiting` after Approve) |
| 2026-11-02 | f176a85da + Stop while waiting | n/a (scripted) | **PASS** | All six legs, **s** included. Control: hiding Stop while the turn waits (the old condition, `isStreaming` only) failed **s** only: "while the turn waits, the page offers no Stop" |
