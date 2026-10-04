# POC · the dogfood turn

Retained evidence for [FIX-1774](../../SPEC.md). Not production code, not a goal check, and
nothing outside this folder imports it.

**Question:** when a person asks the DevTeam Lab's chief of staff for coding work, what does it
do, and would a correct hand-off start a run?

**Run:** `pnpm tsx specs/issues/FIX-1774/poc/the-dogfood-turn/run.mts` (needs a model key).
`LINES="a||b"` replaces the lines it says. It serves DevTeam through Shift Manager's start
script on a fresh SQLite file, says the lines to `chief-of-staff`, and prints the turn's tool
outputs, the replies, the hired roster, the seat inventory and the server log path.

## What it showed (2026-10-04, `openai/gpt-5.4-mini`, scripted harness)

**1 · Jake's two lines reproduce the transcript.** "Build a simple React hello-world app with
Claude Code. Hire a worker if you need to." then "Just do it, I don't care how."

- Turn 1: `discover` (seats) listed `eng.coder` — *"Does the work a filed row names, in a
  checkout of its own"* — then the chief of staff hired `worker` on the `agent` kind and replied
  that it would need "the actual Claude Code workflow or repo details".
- Turn 2: it hired `coder` on the `coder` kind and offered to "set up the project structure".
- The feature board held **no row**. Two roster rows, no task.
- The hire tool's own output warned that rows on `eng.feature.work` "will sit pending until
  something drains them". The model did not act on it.

**2 · The hunch holds: a hired worker has no way in.** Read off the inventory and the host:
`devforce-lab.worker` has a `run` door but is on no mailbox; `devforce-lab.coder` has only the
`message` door, which resumes a stopped run. The feature mailbox's address map holds the EM
members only, and the board hands rows to the one coder the tree declares. Nothing hands a hired
worker work, whatever its kind. This is the Lab's wiring, not the coordinator's instructions.

**3 · A correct post files a row, and nothing starts it.** With the chief of staff told to post
exactly `hello-world: a simple React hello-world app, Vite and TypeScript` to `eng.feature`,
`post-to-mailbox` handed it over, the mailbox delivered it to `eng.em`, and the EM's post door
returned `{"filed":true,"taskId":"hello-world--implement"}`. No drain followed: no board claim,
no harness run. The row waits for something to run the board. Only the EM's Inbox ask runs the
board after it files.

**4 · Running the board after a filed post starts the coder.** With the post door changed
locally (not committed) to run the board after a new row, the same post led to a board claim,
the hand-off to `eng.coder`, and `harness-manager` building the prompt *"# Your task — a simple
React hello-world app, Vite and TypeScript"*. The scripted harness ran.

Findings 2–4 settle the premises [D1](../../DECISIONS.md#d1) and the post-door change rest on;
see [DECISIONS.md → Settled](../../DECISIONS.md#settled).
