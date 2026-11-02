# kitchen-sink-harness › Claude Code waits for approval

**Issue:** FIX-2432 (epic FIX-2369)

**Outcome:** A user works a Claude Code session in Kitchen Sink. A tool call that isn't read-only stops the turn: the conversation shows an approval card naming the command and the folder, and the turn says it is waiting on them. Allow resumes the same conversation and the call runs, also when the server restarted while it waited. Deny tells the conversation it may not, and the call never runs. Nothing runs that nobody allowed.

**Input:** a fresh random token per run, naming the file the call makes. A durable store (`STORE_TYPE=filesystem`). A throwaway git repository as the harness workspace (`KITCHEN_SINK_HARNESS_WORKSPACE`), so no run touches this checkout.

**Signal:** one real browser against `next dev` in test mode, on the scripted Claude Code, whose `[touch:<file>]` call asks through the run's `canUseTool` as Claude Code does. Every answer is a click on the card, which sends it through the client's answer route.

- **a** `a:waits`: the turn asks to `touch` the token's file. The page shows an approval card naming `touch <file>` and the session's worktree, the notice reads *Waiting on you* (`data-kind="waiting"`), the turn's request is `suspended`, and the file doesn't exist.
- **c** `c:same-conversation`: the server is stopped and started again while the card waits. After a reload the card is still there; Allow resumes the turn, and the conversation the page shows is the one the turn started.
- **b** `b:ran-after`: after Allow the file exists in the worktree, holding a time no earlier than the click. It ran once, after the answer.
- **d** `d:never-ran`: a second turn asks to `touch` another file; Reject ends the turn, and that file never exists.

**Anti-game:** answers are clicks on the page's own card, never a store write. What ran is the file on disk, which only the scripted harness's allowed call writes. Leg **c** restarts the server process.

**Model:** none; the scripted Claude Code runs no model.

**Run:** `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/kitchen-sink-harness/claude-code-waits-for-approval/run.mts`

**Controls:** on the same command.

- `GOAL_CONTROL=no-approval`: Claude Code mode runs without approvals (`bypassPermissions`). **a** FAILS: no card shows, and the file is made unasked. The other legs answer a card, so they are not graded under it.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-02 | f176a85da + this change | n/a (scripted) | **PASS** | Container (root, test mode). a, c, b, d pass: the card named `touch <file>` and the worktree, the notice read waiting and the request was suspended; after a server restart and reload the card was still there, Approve resumed the same conversation, and the file was made ~51 s after the click (the stopped server's worktree hold going stale). Control `no-approval` failed **a** only: no card, the file made unasked |
