# devforce-lab › it commits from the seat's own file

**Issue:** FIX-1426

**Outcome:** The seat a Markdown file declared, woken by a filed board row, runs a **real** coding
agent in a checkout of its own and leaves a commit the base ref does not have — working from a
prompt built out of that seat's own instructions, its own brief and its own team's conventions.

This is the one leg the model-free sibling cannot reach. `it-wakes-the-seat-a-file-declared` grades
what the plumbing carried with a scripted stub in the harness slot; this drives the same tree, the
same hire and the same wiring with a real harness in that slot, and nothing else differs. That one
expression is the whole of D2.

**Input:** the lab's own tree, unchanged, plus a git repository this check creates under the OS temp
directory with one commit on `main`. The four graded tokens are **held-out**: each is read off the
tree at run time and asserted to live in exactly one convention file and in none of the lab's own
code, before the run starts.

**Signal:**

1. The prompt the manager handed the agent carries all four held-out tokens — the coder seat's
   `WORKER.md` marker, its brief's marker, its team skill's marker and its own-folder skill's
   marker.
2. Exactly one branch under `conductor/` exists in the scratch repository, and it is at least one
   commit ahead of `main`.
3. The board row settles `completed`.

**Anti-game:** a model writes a plausible `GREETING.md` without reading anything, so **the file the
run produced is not graded and must not be**. Only the prompt is evidence that a file was read, and
it is read off the block input the agent actually received — a `.tap()` in front of the agent —
rather than by re-running this check's own copy of the prompt builder, which would grade a string
this file produced. That tap's composition is exercised model-free by the sibling gate's stub, so a
change that breaks it does not first surface here as a model failure.

Signals 2 and 3 are not one claim twice. The row can settle on a done-condition that read the wrong
tree; the branch says a commit exists where the row's own derivation put it.

**There is no stub fallback, deliberately.** A model-backed check that silently degrades to a
scripted run is exactly the failure its sibling exists to detect, so this one fails loudly when the
harness is not available.

**Model:** real — Claude Code's own, through the Agent SDK. Requires a signed-in SDK.

**Run:** `pnpm tsx goals/devforce-lab/it-commits-from-the-seats-own-file/run.mts`

Needs `git`, a writable temp directory, and a signed-in Claude Code Agent SDK. No `gh`: the
done-condition is a commit, not a pull request — conductor already proves the `gh` probe, and
re-proving it would make this check expensive to re-run a year from now.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-09-17 | 4d7a5749f | — | NOT RUN | Written and type-checked on a machine with no signed-in coding harness. The plumbing it shares with the gate — the tree, the hire, the board, the hand-off, the prompt builder and the prompt-recording tap — is green under the sibling check; the harness leg itself is unrun. |
