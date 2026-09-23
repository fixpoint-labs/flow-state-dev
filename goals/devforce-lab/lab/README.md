# The DevForce lab

Two halves of one claim have each been proved and had never met. The pentest lab
shows that a post reaches seats declared in Markdown — but every seat in it
produces a line of text. `labs/conductor` shows that a board row becomes a
supervised coding run with its own checkout and a verdict read before the row
settles — but the thing that row reaches is a hand-written TypeScript flow, not a
seat that came out of a folder.

This runs the join. One tree of Markdown, pointed at once: a row filed by one
declared seat wakes a **different** declared seat, in its own flow instance, into
a supervised coding run whose prompt was built out of that seat's own files. A
third seat, declared on the same kind, is never reached.

Three checks drive it. The first two differ by **one expression** — the harness
slot; the third adds the two ends of the path neither of them reaches:

| | |
|---|---|
| [`../it-wakes-the-seat-a-file-declared/`](../it-wakes-the-seat-a-file-declared/) | The contract gate. A scripted stub in the slot, no model at all, every rule graded on what the plumbing carried. |
| [`../it-commits-from-the-seats-own-file/`](../it-commits-from-the-seats-own-file/) | The honesty check. A real coding agent in that same slot, and the one leg a stub cannot reach — a commit the base ref does not have. |
| [`../it-ships-an-artifact-a-person-can-open/`](../it-ships-an-artifact-a-person-can-open/) | The product check. A **post** is what starts the work, and the work is published to an address that outlives the run and judged against a condition the brief stated first. |

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
  teams/
    eng/
      resources/feature-brief.md                   the working seat's brief
      skills/commit-style/SKILL.md                 every eng seat holds it
      channels/feature/CHANNEL.md                  declared, walked, and driven by the third check
      workers/em/WORKER.md                         flow: em      — names no harness
      workers/coder/WORKER.md                      flow: coder
      workers/coder/skills/branch-naming/SKILL.md  the coder's alone
      workers/reviewer/WORKER.md                   flow: coder   — declared, never woken
```

Seven Markdown files, and **none of them is named anywhere in this directory's
code** except the root of the tree. Everything else is walked.

Nothing in either `WORKER.md` names Claude Code, Codex or Cursor. The harness is
one expression inside the `coder` kind, exactly as it is one expression in
`labs/conductor/src/flow.ts`.

## What this directory owns, and why each piece is here

The lab now opens the channel it declares. `CHANNEL.md` used to be walked and
never driven — the positive half of "an unwalked folder loads as nothing" and
nothing more. For the third check the feature channel is the front door: a post
on it is what reaches the EM seat, and the EM seat is what files the row. The
board hand-off underneath is unchanged.

These are the lab's rather than the framework's, each because the framework has
no opinion at that spot — not because a convention is missing.

| File | Why it is the lab's |
|---|---|
| `board.mts` | The loader walks four folders and silently ignores everything else, so a board declared as a tree folder would look declared and be read by nobody. Boards are declared in code, by design. |
| `workforce/flows/workers/em.mts` | The coordinator kind. It owns the board and files rows, and declares **no task entry at all** — so "the EM seat does no harness work" is a fact about the kind, not about one run. |
| `workforce/flows/workers/coder.mts` | The working kind. One task entry, `harnessManager` behind it, and the harness itself passed in as a slot. |
| `host.mts` | Read the tree, build the kinds, hire, register. The assignee → seat address is supplied by the caller, because a board's `workers` keys are assignees and which seat one reaches is a dispatcher's static `flowKind`. The HTTP door is wired with a host-owned `resolvePrincipal`, so an unauthenticated read is refused rather than waved through under the development-organization fallback. |
| the channel door in `host.mts`, with `notify.mts` | Which channel this lab opens, and when, is the app's — and so is which member resolves to which seat, because the dispatch seam refuses a target read out of stored data. `openChannels` takes no `orgId` and needs no wrapper: the server-created session carries the organization from the verified principal (FIX-1442). |
| the bare clone in `scratch-repo.mts` | Where an artifact has to survive to is the lab's question, not the framework's. A temp-directory repository plus a bare repository at a declared path the work is published to keeps the check re-runnable with no credential while still giving the artifact an address that outlives the process. |
| `acceptance-check.mjs`, with `acceptance.mts` | The requester's half of the brief. It names the module, the export and the behaviour, and is spawned from here against the produced tree — never copied into a checkout, because a check the run can reach is a check the run can satisfy by rewriting it. |

`harness-stub.mts`, `phase.mts` and `seat-config.mts` are supporting parts of
those.

## What it works around

**The `coder` kind declares the feature board a second time, and drains it
never.** Same `boardId`, same ledger id, its own same-flow dispatcher. Two
framework rules make that mandatory for a recipient of a cross-flow hand-off:
`defineFlow` refuses a flow that declares a task entry with no reachable board
handing off to it, and the claim gate refuses a dispatch whose `boardId` differs
from the one the recipient's own board was built with.
`packages/orchestration/test/task-board/hand-off-cross-flow.test.ts` documents the
same constraint in its own header.

**It is an interim tax, not a convention.** Board *authoring* — what an author
declares — is a channel-attached `TaskCollection` (FIX-1385). The cross-flow
claim-gate cost is a separate L1 constraint, carved onto FIX-1408. A kind that
needs a task entry may pay this tax today, labelled as one. A lab that taught it
as the rule would grandfather an asymmetry nobody chose.

**The two older checks drive the EM seat through its own actions rather than
through the feature channel, and still do.** For them the channel is declared,
walked, and used as the positive half of "an unwalked folder loads as nothing" —
a `channels/` folder loads while a `boards/` folder does not. Opening it is an
option on `openLab`, absent by default: an entry that is only there to do nothing
is worse than none, and widening every check that imports `openLab` to carry a
door only one of them uses would change what the other two prove.

**One automated leg, and the verdict says which leg ran.** CI runs the local leg:
the work is published to a bare repository at a declared path, and the artifact
resolves there after the process exits, with no network and no credential. The
pull-request release run is the same path with a real remote, and it is a human
release step rather than a second leg the lab carries. A proof that quietly ran
the weaker leg and reported the stronger one would be worse than no proof, so the
leg is named in the verdict rather than inferred from whether `gh` happened to be
installed.

## What the gate found

The manager reads a run's `status` for success and then asks the phase's
done-condition. The `outcome` word a harness reports is written to the run record
and never consulted — so a run that reports it stopped at its budget, having
committed the half it finished, settles its row `completed`.
`GOAL_CONTROL=stopped-at-limit` reproduces it. Recorded in the gate's `goal.md`
and filed upward; not worked around here.
