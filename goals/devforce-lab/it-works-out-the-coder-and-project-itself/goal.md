# devforce-lab › it works out the coder and project itself

**Issue:** FIX-2487

**Outcome:** A user tells the Shift Coordinator "Can you have cursor review the super app for any
security concerns". The coordinator reads "cursor" as the coding agent its coder runs on, not a
worker to look for, and "the super app" as a part of the code the coder finds, not a project to
ask about. It files the review for the coder in the FSD project, with no question, and says what
it picked. The same holds for Codex and Claude. When the coder runs on another agent than the one
named, it files nothing and says so, naming both. When the projects reach different code, it asks
one question naming them.

Before this, the coordinator said it couldn't find a worker called "cursor" or a project called
"super app", and asked which project and whether eng.coder should do it.

**Input:** `fixtures/input.json`: the ask, with the agent's word left as `{harness}`, the three
agents (the word a user types and what the coder's description calls it), and the other agent the
`missing` leg's coder runs on. The projects are the `fsd` profile's own (`FSD_PROJECTS`), with
their titles and briefs, both on one repository that holds `apps/super-app`, as Jake's Lab had
them.

**Signal:** five legs, each on a fresh DevTeam lab driven over its HTTP door as the lab's owner,
one turn in a new conversation, graded once. A real model plays the Shift Coordinator, on the
model its `WORKER.md` declares.

- **cursor, codex, claude**: the lab's coder runs on the named agent. The turn files exactly one
  task, for `eng.coder`, whose stored `input.project` is `fsd` (`<agent>:files-for-the-coder-in-fsd`),
  and its reply names the agent (`<agent>:states-the-agent`).
- **missing**: the coder runs on Claude Code and the ask names Cursor. The turn files nothing
  (`missing:files-nothing`), and its reply names Cursor and Claude Code (`missing:names-both-agents`).
- **two-repos**: Shift Manager gets a repository of its own. The turn files nothing
  (`two-repos:files-nothing`) and its reply names FSD and Shift Manager (`two-repos:asks-naming-both`).

**Anti-game:** a coordinator that files every ask for eng.coder in the first project would pass
the three agent legs, so `missing` and `two-repos` grade the cases where filing is wrong. The
filing is read off the stored row's `input.project`, not the reply.

**Controls:** `GOAL_CONTROL=list` prints them.

| Control | Perturbs | Goes red on |
|---|---|---|
| `no-harness-label` | the lab opened without `coderHarness`, so no coder's description names its agent | `cursor:files-for-the-coder-in-fsd`: the coordinator can't confirm the coder runs on Cursor, so it files nothing |

**Model:** `anthropic/claude-haiku-5-5` for the Shift Coordinator (its file's), through the AI
Gateway; other blocks on the models they name. Reports `blocked` when no key serves it. The
coder's harness is the lab's stub: the label is what the coordinator reads, and what a filed task
does next is not graded.

**Run:** `pnpm tsx goals/devforce-lab/it-works-out-the-coder-and-project-itself/run.mts`
(`GOAL_LEGS=cursor,missing` for some legs). Needs `git`, a writable temp directory and
`AI_GATEWAY_API_KEY`.

## What this establishes, and what it does not

It establishes that the coordinator routes a named coding agent to the coder that runs on it,
refuses to swap agents unasked, and stops asking which project when the projects share one
repository. It does **not** establish that the coder finds the super app or runs on Cursor: the
lab's coder is a stub, and one coding agent serves the whole Lab (a coder per agent is FIX-2486).
It also does not search repositories from the coordinator: when projects have different
repositories it still asks.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-02 | `0519b6fb` (main, before the fix) | `anthropic/claude-haiku-5-5` | FAIL (reproduces FIX-2487) | `cursor` and `claude` legs: filed nothing; "There's no Cursor worker on your roster … I don't see a project called "super app" … Which one is the super app?", as Jake saw. |
| 2026-11-02 | branch `claude/project-thread-130ymj` | `anthropic/claude-haiku-5-5` | PASS; `no-harness-label` FAIL (expected) | All five legs: cursor, codex and claude each filed one task for eng.coder in fsd and named the agent; missing filed nothing and named Cursor and Claude Code; two-repos filed nothing and asked naming FSD and Shift Manager. The control filed nothing: "its record doesn't name an agent, so I can't confirm what it runs on". |
