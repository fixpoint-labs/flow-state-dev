# harness-manager › an answered run continues the coding session that asked

**Issue:** LAB-154

**Outcome:** A supervised coding run asks a question and stops. A person answers it. The run picks
up **the same conversation** — not a new one told what was answered. What that buys is everything
the first attempt had in its head: what it had already read, what it had already tried, and why it
asked. Before this, the second attempt started over in a tree it had never seen.

**Input:** `fixtures/input.json` — the issue and phase the row is seeded under, and the shape of
the two prompts. The **fact the proof turns on is generated per run**, not held in the fixture: a
value baked into a file could be one a model had seen before.

**Signal:**

1. Attempt 1 parks with a question, and its run row carries a **harness session id**.
2. After `answer`, attempt 2's run row carries the **same session id**.
3. The **fact file exists in the run's own checkout and holds the generated fact** — which attempt
   2 was never told, in any form.
4. The board row for the issue-phase settles **`completed`**, read through the flow's `status`
   action.

Signals 2 and 3 are one claim from two sides. The id says the vendor resumed the conversation; the
file says the conversation actually carried the knowledge. Either alone is weaker than it looks —
an id can be recorded without being honoured, and a file can be written by a model that guessed.

**Signal 2 can be vacuous, and it was on the first real run of this check.** Where the Agent SDK is
itself invoked from inside a Claude Code session, it reports the *ambient* session id: two unrelated
runs with no resume between them report the same id, so "the ids match" is true whether or not
anything resumed. Measured, not assumed. **Signal 3 is the one that discriminates** — the same
measurement showed the two runs are conversationally isolated (an unresumed run asked for the fact
answers `NONE`), so a run that produces the fact did carry it across. Read signal 2 as corroboration
where the ids are per-run, and never as the proof on its own.

**Anti-game:** Attempt 2's prompt must contain **neither the fact nor the session id**, and the
check asserts that on the prompt string it built, before the run. The operator's answer must not
contain the fact either — it is the answer to a different question. Nothing may read the vendor's
session store or transcript.

**The fact must also not be reachable on disk.** Both attempts share one checkout and attempt 2 can
read it, so before answering, the check sweeps the whole checkout for the fact and fails if attempt 1
left a copy anywhere. Without that sweep, "attempt 2 wrote the fact" is satisfied by a stray scratch
file as easily as by a continued conversation, and the instruction telling attempt 1 not to write it
down is not evidence that it obeyed.

The prompt-based carry-forward the manager used to have is retired, and that is what makes this
check able to fail: while the prompt named the previous session, a run told the fact in attempt 1
still had it in attempt 2's prompt fold, so "resume worked" and "the model was told the answer"
were indistinguishable.

**What this establishes, and what it does not.** It establishes that a real Claude Code session,
resumed by id on the background path, still holds what the first attempt learned — end to end
through a real board, a real hand-off, a real checkout. It does **not** establish anything about a
second harness: Codex's resume is LAB-153's, and the two-harness proof is LAB-141's. It does not
establish that the vendor will resume a session of arbitrary age; the two attempts here run seconds
apart. And where the session ids are ambient (above), it does not establish that the *recorded id*
is the one that was honoured — only that the knowledge crossed.

**Model:** real — Claude Code's own, through the Agent SDK.

**Run:** `pnpm tsx goals/harness-manager/answered-run-continues-its-session/run.mts`

Requires a real Claude Code Agent SDK and `GOAL_CONDUCTOR_REPO` pointing at a clone the check may
cut worktrees from. That repository must ignore `**/.fsdev/` — a run writes the question it needs
answered under that path inside its own checkout, and provisioning refuses a repository that would
let the agent commit it. Unlike the LAB-138 goal, this one needs no `gh`: its done-condition is the
fact file, not a pull request.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| | | | | |
