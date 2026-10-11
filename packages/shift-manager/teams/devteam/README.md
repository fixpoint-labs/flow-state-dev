# The DevForce lab

This directory is two things at once: Shift Manager's DevTeam profile
(`fsdev.config.mts`), and the tree and host the DevForce lab's goal checks in
[`goals/devforce-lab/`](../../../../goals/devforce-lab/) open. It lives beside the
profile so the package never imports from the goal corpus; the checks reach in
here instead.

Two halves of one claim have each been proved and had never met. The pentest lab
shows that a post reaches seats declared in Markdown — but every seat in it
produces a line of text. `labs/conductor` shows that a board row becomes a
supervised coding run with its own checkout and a verdict read before the row
settles — but the thing that row reaches is a hand-written TypeScript flow, not a
seat that came out of a folder.

This runs the join. One tree of Markdown, pointed at once: a row filed by one
declared seat wakes a **different** declared seat, in a session of its own on
its flow's one copy, into a supervised coding run whose prompt was built out of that seat's own files. A
third seat, declared on the same kind, is never reached.

Seven checks drive it. The first two differ by **one expression** — the harness
slot; the third adds the two ends of the path neither of them reaches:

| | |
|---|---|
| [`goals/devforce-lab/it-wakes-the-seat-a-file-declared/`](../../../../goals/devforce-lab/it-wakes-the-seat-a-file-declared/) | The contract gate. A scripted stub in the slot, no model at all, every rule graded on what the plumbing carried. |
| [`goals/devforce-lab/it-commits-from-the-seats-own-file/`](../../../../goals/devforce-lab/it-commits-from-the-seats-own-file/) | The honesty check. A real coding agent in that same slot, and the one leg a stub cannot reach — a commit the base ref does not have. |
| [`goals/devforce-lab/it-ships-an-artifact-a-person-can-open/`](../../../../goals/devforce-lab/it-ships-an-artifact-a-person-can-open/) | The product check. A **post** in a workstream the EM leads is what starts the work, and the work is published to an address that outlives the run and judged against a condition the brief stated first. |
| [`goals/devforce-lab/it-keeps-its-rows-on-the-mailboxes-board/`](../../../../goals/devforce-lab/it-keeps-its-rows-on-the-mailboxes-board/) | The board check. A person opens Storefront's `feature` workstream with the EM as its lead; a row the EM files there ends as one completed row on that workstream session's board, which its owner reads and everyone else in the organization is refused. No model. |
| [`goals/devforce-lab/it-waits-for-a-person-before-it-files/`](../../../../goals/devforce-lab/it-waits-for-a-person-before-it-files/) | The approval check. With the ask turned on, the EM seat asks a person before it files a feature. Approve files the row and the coder starts; Deny files nothing. No model, and the answer goes through the session's own resume. |
| [`goals/devforce-lab/it-codes-in-the-projects-repository/`](../../../../goals/devforce-lab/it-codes-in-the-projects-repository/) | The project check. The coder runs on a workspace host whose source is the project holding the board's workstream: a project with a repository gets a branch of it, one without runs on its files, a remote the host does not allow is refused by name, and what a run keeps is saved to the project. No model. |
| [`goals/devforce-lab/it-answers-a-conversations-task/`](../../../../goals/devforce-lab/it-answers-a-conversations-task/) | The conversation check. A coordinator files a task for the coder from a conversation: the coder answers it from the right project's code in a checkout of its own, the conversation hears it once, and a task that can't be done is heard failing, with Jev judging the answer against the goal. Scripted legs, and a real-model leg when a key serves it. |
| [`goals/devforce-lab/it-names-the-project-a-coders-task-works-in/`](../../../../goals/devforce-lab/it-names-the-project-a-coders-task-works-in/) | The project-list check. Asked to have the coder look at "our repo", the chief of staff reads the person's projects and files the task for the one with a repository without asking; with two, it asks, naming both; a project the person isn't a member of never appears. Real model. |

It is **evidence, not an application**. Nobody opens it and clicks through it;
you re-run it a year from now and compare against the verdict logs in the two
`goal.md` files. It is also not the DevForce Lab — that is the showcase D-12
describes, and growing this into it is out of scope on purpose.

## What an author writes

```
workforce/
  flows/
    workers/em.mts                                 kind `em`    — basename is the kind id
    workers/coder.mts                              kind `coder`
  org/
    resources/engineering-handbook.md              the coordinator's document
    resources/projects.ts                          the projects collection
  teams/
    eng/
      resources/feature-brief.md                   the working seat's brief
      skills/commit-style/SKILL.md                 every eng seat holds it
      workers/em/WORKER.md                         flow: em      — names no harness; delegates: the coder and the reviewer
      workers/coder/WORKER.md                      flow: coder
      workers/coder/skills/branch-naming/SKILL.md  the coder's alone
      workers/reviewer/WORKER.md                   flow: coder   — declared, never woken
      workers/triage/WORKER.md                     flow: coordinator — hands every post to eng.em
    ops/
      workers/oncall/WORKER.md                     flow: coordinator — hands every post to eng.em
```

Nine Markdown files, and **none of them is named anywhere in this directory's
code** except the root of the tree. Everything else is walked.

Nothing in either `WORKER.md` names Claude Code, Codex or Cursor. The harness is
one expression inside the `coder` kind, exactly as it is one expression in
`labs/conductor/src/flow.ts`.

## What this directory owns, and why each piece is here

The tree declares no mailbox. The profile's seed opens two workstreams in
Storefront, `feature` and `release`, as the lab's second user, each led by the
EM. A line said in a workstream, or a project coordinator's hand-off to it,
reaches the EM in that workstream's session, and the EM files the coder's tasks
on that session's board, each naming its issue and its phase. The hand-off from
the board to the coder underneath is unchanged.

These are the lab's rather than the framework's, each because the framework has
no opinion at that spot — not because a convention is missing.

| File | Why it is the lab's |
|---|---|
| `workforce/flows/workers/em.mts` | The coordinator kind. It keeps a board on each of its sessions and files rows there, with the task tools its `delegates:` give it, and declares **no task entry at all** — so "the EM worker does no harness work" is a fact about the kind, not about one run. |
| `workforce/flows/workers/coder.mts` | The working kind. One task entry, taking the feature board's rows and any conversation's tasks, with two `harnessManager`s behind it (feature work, which needs a commit, and a person's ask, which needs an answer), one message door over both, and the harness itself passed in as a slot. |
| `judge.mts` | What the coder's judge asks Jev about a conversation's task, and the confidence floor it reads the verdict against: the same model and floor the chief of staff's best fit runs on. |
| `host.mts` | Read the tree, build the installation and the kinds, register one copy of each. The `coder` assignee's address is supplied by the caller, so a control can point it at the wrong worker; any other assignee, filed through the doors or the task tools, is resolved by the Workforce worker lookup. The HTTP door is wired with a host-owned `resolvePrincipal`, so an unauthenticated read is refused rather than waved through under the development-organization fallback. |
| the bare clone in `scratch-repo.mts` | Where an artifact has to survive to is the lab's question, not the framework's. A temp-directory repository plus a bare repository at a declared path the work is published to keeps the check re-runnable with no credential while still giving the artifact an address that outlives the process. |
| `acceptance-check.mjs`, with `acceptance.mts` | The requester's half of the brief. It names the module, the export and the behaviour, and is spawned from here against the produced tree — never copied into a checkout, because a check the run can reach is a check the run can satisfy by rewriting it. |

`harness-stub.mts`, `harness.mts`, `phase.mts` and `seat-config.mts` are
supporting parts of those.

## What it works around

**The two older checks drive the EM through its own actions rather than a
person's line.** Its `file` door files one row on the session it runs in, with
no model, so those checks grade the hand-off and the run, not the EM's judgment.

**One automated leg, and the verdict says which leg ran.** CI runs the local leg:
the work is published to a bare repository at a declared path, and the artifact
resolves there after the process exits, with no network and no credential. The
pull-request release run is the same path with a real remote, and it is a human
release step rather than a second leg the lab carries. A proof that quietly ran
the weaker leg and reported the stronger one would be worse than no proof, so the
leg is named in the verdict rather than inferred from whether `gh` happened to be
installed.

## The ask

Nothing in this tree asked a person anything, so an Inbox pointed at it had nothing to show.
The EM worker now has a third door beside `file` and a person's line in a workstream: it pauses on a stock
approval before it files, and files only if a person approves. Deny files nothing and says so.

The door is off unless the host asks for it. `openLab` takes the feature to ask about, turns on
durable execution, and raises the ask once in the EM seat's own session, as the lab's person.
Opening again over the same store finds the earlier ask, answered or not, and raises nothing;
a denied feature stays denied until the store is fresh. The other checks don't ask for
it, so they run exactly as before.

A host that builds its own flow state instead of calling `openLab` turns on durable execution
itself and calls the same step, `raiseAsk` in `ask.mts`, after it registers the worker flows.

```ts
const lab = await openLab({
  stores,
  harness: stub.slot,
  workspace,
  coderSeatId,
  ask: { issue: "search-bar", goal: "Add a search bar to the header" },
});
// The EM's session now holds one pending approval. Answer it through
// POST /em/requests/<requestId>/resume with "approve" or "reject".
```

## Serving it

This tree is served as Shift Manager's `devteam` profile. The profile's config,
`fsdev.config.mts` beside this file, opens it through `openLab`, and
`fsdev dev --config` takes the same file. `DEVFORCE_LAB_HARNESS` picks what runs an approved
row (`harness.mts`):

| Value | What runs |
|---|---|
| unset or `stub` | The scripted run, no model. It says what it's doing in the run's session and commits one file, so the row settles `completed`. |
| `claude-code` | Claude Code through its Agent SDK, set up as the honesty check sets it up. Needs a signed-in SDK or an Anthropic key. Nothing falls back to the stub. |

The scripted run pauses 2 s before each of its five steps so you can watch them arrive.
`DEVFORCE_LAB_STEP_MS` changes the pause; a test that only needs the row to settle sets it to `0`.

```bash
DEVFORCE_LAB_HARNESS=claude-code pnpm --filter @flow-state-dev/shift-manager start
```

A row the run leaves unfinished goes back to `pending` with its reason, and waits for the next
drain of the EM's board. Nothing in the served lab drains it again on its own.

## What the gate found

The manager reads a run's `status` for success and then asks the phase's
done-condition. The `outcome` word a harness reports is written to the run record
and never consulted — so a run that reports it stopped at its budget, having
committed the half it finished, settles its row `completed`.
`GOAL_CONTROL=stopped-at-limit` reproduces it. Recorded in the gate's `goal.md`
and filed upward; not worked around here.
