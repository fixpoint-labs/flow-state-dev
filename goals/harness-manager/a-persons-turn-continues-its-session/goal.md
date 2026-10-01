# harness-manager › a person's turn continues the coding session it was sent into

**Issue:** FIX-1690

**Outcome:** A person sends a running coding run a message. The run stops where it is, and its
next attempt continues **the same conversation** with the message, rather than starting over in a
tree it has never seen. What that buys is everything the stopped attempt had in its head, plus what
the person said, and it costs the task none of its retries.

**Input:** `fixtures/input.json` — the issue and phase the row is seeded under, the two phase jobs
and the person's turn. The **fact the proof turns on is generated per run**, never stored.

**Signal:**

1. Attempt 1 is `in_progress`, waiting, with a **harness session id** on its run row, when the turn
   is sent.
2. The conductor's `message` action, called in the run's own session, answers **`continuing`**.
3. The **fact file exists in the run's checkout and holds the generated fact**, which attempt 2 was
   never told in any form.
4. Attempt 2's run row carries the **same harness session id** as attempt 1.
5. The board row settles **`completed`** after **2 claims with 1 turn re-entry**: retry standing
   (`attempts − abandonments − turnReentries`) is **1**, with `maxAttempts: 1`.

Signal 3 is the one that discriminates. Signal 4 is corroboration: where the Agent SDK runs inside
a Claude Code session it can report the ambient session id (the answered-run goal measured this),
which is why the run command below clears the parent session's variables.

**Anti-game:** Attempt 2's phase prompt and the person's turn must contain **neither the fact nor
the session id**; the check asserts that on the strings it built. The manager adds only the kept
turn to attempt 2's prompt. Before the turn is sent, the check sweeps the shared checkout and fails
if attempt 1 left the fact anywhere on disk. Nothing reads the vendor's session store.

**What this establishes, and what it does not.** That a real Claude Code session, stopped by a
person's message through the manager's door and resumed by id, still holds what it knew, end to end
through a real board, a real hand-off and a real checkout. It does not establish a second harness,
a stop landing mid-edit, or a turn that arrives while the harness is between tool calls in another
process.

**Model:** real — Claude Code's own, through the Agent SDK.

**Run:** from inside a Claude Code session, clear the parent session's variables so the run gets
sessions of its own:

```bash
GOAL_CONDUCTOR_REPO=<a clone that ignores **/.fsdev/> \
  env -u CLAUDECODE -u CLAUDE_CODE_SESSION_ID -u CLAUDE_CODE_REMOTE_SESSION_ID \
      -u CLAUDE_CODE_CHILD_SESSION -u CLAUDE_AUTO_BACKGROUND_TASKS \
  pnpm tsx goals/harness-manager/a-persons-turn-continues-its-session/run.mts
```

Requires a real Claude Code Agent SDK. Attempt 1 waits on a long-running `node -e` timer in the foreground (Claude Code refuses a bare `sleep`), so the
agent is allowed `Bash` here as well as file edits.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-01 | door PR | Claude Code (Agent SDK, default model) | PASS | Same session id both attempts, fact file written, 2 claims / 1 turn re-entry. Control with the resume feed returning null: FAIL at signals 3, 4 and 5 |
| 2026-10-01 | door PR, review round | Claude Code (Agent SDK, default model) | PASS | After the refusal-withdraws change and the backed-off stop wait: same session id both attempts, fact file written, 2 claims / 1 turn re-entry |
