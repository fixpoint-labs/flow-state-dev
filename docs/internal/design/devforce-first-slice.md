# DevForce — the first slice

DevForce is design-only today (D-12). Every noun in it has a home on the
Workforce atlas, and none of them has been run together. This is a proposal for
the smallest thing that would show it works, shaped like the pentest lab:
**evidence, not an application.**

## The one claim it has to make

The pentest lab proved the four file conventions compose — a post into a channel
reaches two seats declared in Markdown, and each answers out of its own
documents, skills and instructions. Every seat in it produces **a line of text**.

DevForce exists because a seat's output is supposed to be a pull request. That
seam has never been crossed. Conductor and `@flow-state-dev/harness-manager`
prove the other half — a board row becomes a supervised coding run with its own
checkout and a verdict read before the row settles — but the thing that row
reaches is a flow, hand-written in TypeScript. Nothing has ever connected a seat
that came out of a folder to a run that produces a commit.

So the first slice makes exactly one claim:

> A row filed on a feature board wakes the seat a Markdown file declared, and
> that seat's answer is a supervised coding run — its own checkout, a verdict
> read before the row settles — with the prompt built out of the seat's own
> files and nothing about the harness anywhere except the seat's `flow:` line.

Everything below is what it takes to make that claim failable.

## The anti-game, first

A hollow pass here is easy and would look convincing: the row settles `done`, a
commit exists on the branch, the transcript reads well. All of that is equally
true of a lab that ran conductor's own hard-coded prompt and never opened the
tree. So:

- Every convention file carries a **held-out token** that appears in exactly one
  file and **nowhere in the lab's own code or in the operator's post**. Leg 0
  scans the whole tree and the whole of `lab/*.mts` to prove it before anything
  is built.
- The check grades those tokens in **what the harness was handed** — the prompt
  the manager built — not in what the run produced. A model can write a good
  commit while holding none of them.
- The checkout path is graded as **derived from the row**, not as "a directory
  exists". Conductor's own rule: a derived identity must be injective over its
  components.
- A **third seat is declared and never woken**, which is what makes "the row
  reached the seat it named" a graded claim rather than an absence. Same role
  `audit.scribe` plays in the pentest lab, and it costs nothing — it never runs.
- The verdict leg is paired with its opposite state: a run that satisfies the
  done-condition and a run that does not must settle differently, or the
  supervision is decoration.

## The tree an author writes

Six convention files. No file is named anywhere in the lab's code except the
root of the tree.

```
workforce/
  org/
    resources/engineering-rules.md      every team reads it
  teams/
    eng/
      resources/feature-brief.md        what this feature is
      skills/commit-style/SKILL.md
      channels/feature/CHANNEL.md       members: em, dev
      workers/em/WORKER.md              flow: em      — names no harness
      workers/dev/WORKER.md             flow: coder   — names one
      workers/reviewer/WORKER.md        flow: coder   — declared, never woken
```

Three seats, and each earns its place. `em` carries the atlas's sharpest
opinion — **the EM seat does harness work never** — which is only gradeable if a
seat that does exists beside it. `reviewer` is the silent probe. `dev` is the
one that runs.

## What the lab writes itself

Four pieces, each because the framework has no opinion at that spot.

| File | What it is | Why it is the lab's |
|---|---|---|
| `seat-kinds.mts` | Two kinds: `em` (a channel delivery becomes a filed row) and `coder` (a task entry running `harnessManager`) | The built-in `agent` kind declares no internal map and no `task.actions`, so neither a channel delivery nor a board hand-off can wake it. The pentest lab wrote a kind for the first reason; this one adds the second. |
| `board.mts` | The feature board, and its static seat-address map | `flowKind` on a dispatcher is a static instance id, not a function — the pentest lab settled this at its own notify slot. So the roster a board can address is bound at host assembly, and that is a stated limit rather than a hidden one. |
| `phase.mts` | One phase: a prompt built from the seat's own files, `isDone` = a commit the base ref does not have | So the verdict is graded on a real side effect in a real git tree. |
| `host.mts` | Read the tree, build the kinds, hire, open the channel, register the board | The assembly an app writes anyway. |

## Two checks, differing by one block

The pentest lab's shape exactly, and for the same reason: a model improvising
around a missing document reads as a pass, so the contract is graded without one.

| | |
|---|---|
| `a-filed-row-wakes-the-declared-seat` | The contract gate. A **stub** in the harness slot returning a scripted run handle, no model, every rule graded on what the plumbing carried — the prompt's tokens, the derived checkout, the addressed seat, the settlement the verdict produced. |
| `a-seat-commits-from-its-own-file` | The honesty check. A real coding harness in that same slot, against a **local scratch repository**, making one small real change. The one leg a stub cannot reach. |

The honesty check runs against a local bare repo rather than GitHub and Linear,
and the done-condition is a commit rather than a pull request. Conductor already
proves the `gh` probe; re-proving it here buys nothing and makes the check
expensive to re-run a year from now, which is the whole point of a goal.

**The EM's filing stays deterministic in both halves.** In v1 its job is
mechanical — a post in the feature channel becomes a row on the feature board.
Giving it judgment is a second slot and a second model, and nothing about "the
EM seat does no harness work" needs it to think. That is deferred, not forgotten.

## The premise to settle before writing any of it

Conductor's board hands off to an entry on **its own flow**. DevForce's hands off
across flows, to a seat instance. Nothing on this pin proves that works:

1. Does `taskBoard`'s `workers` map accept a dispatcher carrying `flowKind`?
2. Does the claim gate's rule — a gated task entry may keep no session state
   beneath it — still hold when that entry lives on another flow?

This is leg 0 of the slice and the only thing that could make it not the
smallest one. Run it as a `settle-claim` POC first, in a day.

**If it refuses**, the fallback still proves the headline claim: put the board on
the same flow as the `coder` kind, conductor-style, and let the seat's file
supply the prompt, instructions and skills while the manager stays where
conductor has it. What is lost is the opinion that a seat *is* the board's
worker, which then becomes a named framework gap rather than a guess.

## What it deliberately leaves out

Each of these is in the atlas's DevForce picture and none of them is failable
until a seat can do work:

- **The questions and decisions channels, and the philosophy resource.** They are
  about a team converging. Later.
- **The org project board, and features coming off a backlog.** One board, one
  row. Two boards is a routing claim, not a work claim.
- **Design / architect / QA seats.** One seat that runs, one that never does.
- **The product team.** D-12 already says later.
- **MCP.** Held, per D-12.

## The call this needs from you

**Do we run this before W3, or wait for it?**

D-12 says DevForce is design-only until Workforce can host it, and lists
"running the Lab before W3" as a thing that would fake it. That line is aimed at
DevForce shipping as a second product or claiming to run. A check in `goals/` is
neither, and the precedent is directly on point: the pentest lab ran on W2's
conventions and found two framework bugs their own green suites had missed
(FIX-1412, and FIX-1367 — which landed on `main` in #1833 while this was being
written). That is the calibration D-12 says DevForce is for.

**Recommendation: run it now, as `goals/devforce-lab/`, named a goal and not the
Lab** — with its README opening the way the pentest lab's does, so nothing claims
the Lab runs. W3 is about to be designed around the seam between a declared seat
and real work. Right now nobody has evidence about what breaks there.

- **What would change my mind:** if W3's brief (#1702) already commits to a
  specific shape for how a board addresses a seat. Then this would be testing a
  surface that is about to be replaced, and it should wait.
- **What being wrong costs:** roughly a week, and a check W3 later invalidates.
  The atlas's "design only" line would also need an honest amendment — the
  cheaper half of the cost, but the one people will notice.

