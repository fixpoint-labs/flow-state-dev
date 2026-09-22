# FIX-1497 · ER-Collab proof: a graded multi-seat scenario, with the handoff visible

**Spec** · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md)

Feature · `goals/` only · **small–medium** · 1 PR · epic
[FIX-1457](https://linear.app/fixpoint-labs/issue/FIX-1457) ·
[epic spec](../../epics/FIX-1457/SPEC.md) ·
[ER-Collab](../../epics/FIX-1457/BUSINESS-RULES.md#er-collab), and this issue owns
[ER-1](../../epics/FIX-1457/BUSINESS-RULES.md)

## Five people, before and after

| Someone who… | Today | After |
|---|---|---|
| **is deciding whether Workforce is ready to ship** | "Seats collaborate" rests on two checks that each prove a half — a row reaching the seat a file named, and a queue routing to desks. Nothing has run them as one scenario, and nothing has watched work change hands | One command runs the whole thing on a real hire, and a dated verdict row says which seats ran what, in which sessions, and what was observed |
| **asks what happens when the work needs a person** | The substrate can park a row for review and take an answer back. That leg has never run on a hired workforce, and nobody has seen an answer arrive | The run stops on a real question, a person answers through the owning seat's own door, and the answer is on the row where the next reader finds it |
| **wants to watch it hand over** | Nothing to watch. The labs run headless, so a handoff exists only as rows in a store nobody opens | The seats are served by the ordinary dev server. **Three screens, one click apart**: the row and where it went, why it waited and what it was told, and both rows with their two owners |
| **has to re-run this proof next release** | Impossible. It has never been run once | One command and a browser. Each claim carries the control that makes it go red, and each control has been seen red |
| **is worried this grows a second, human work plane** | The fence is written down and nothing has pushed on it | Two red states push on it: an answer sent as a second person does not land, and nothing drains the board on a person's behalf |

**Why now.** W5 is done when three exit proofs pass, and none has run
([FIX-1457](../../epics/FIX-1457/SPEC.md)). ER-Collab is the one that decides whether *"two seats
can work a shared channel and you can see it happen"* is a claim or a fact. The finding is that
every piece already exists: this composes them and writes down what a run has to show.

## What changes

![Four lanes against time. The planner seat files a row for the build desk; the builder seat claims it and parks it with a reason; the person answers through a flow action on the owning seat, with no claim and no drain on the person's lane; the builder finishes the row and, in finishing, files a second row for the review desk, which the reviewer seat claims and completes. Below a dashed fence, three DevTool screens and the route between them: the seat session's Tasks tab with the row and a link to its child session, the child session's Tasks tab carrying the parked reason and then the answer, and the Resources panel's ledger collection holding both rows with their two assignees.](figures/the-run.svg)

Read left to right. The crossing from the builder's lane to the reviewer's is the handoff, and it
is one board's rows changing hands — not a field on a row and not a status
([D2](DECISIONS.md#d2)). The person's lane has no claim on it and no drain: that is
[ER-1](../../epics/FIX-1457/BUSINESS-RULES.md) drawn.

**Below the fence is where you read it, and it is three screens rather than one.** That is a
property of the substrate, not a compromise: a task board's changes are emitted into the session
that made them, so a row claimed by a seat and parked inside its child session has its story
written in two places. The two questions a reader actually asks are different anyway — *why did
this row wait* is per-row and lives on the child session's Tasks tab, with no expander; *where are
both rows now* is a question about the ledger and lives in the Resources panel, which holds it
whole. The route between them is the ChildSession link the DevTool already ships.

**The whole scenario, as the person who writes it types it** — one channel file and three worker
files, and nothing else declares the team:

```diff
+ # teams/eng/channels/queue/CHANNEL.md
+ ---
+ members: [eng.planner, eng.builder, eng.reviewer]
+ boards: [work]
+ ---
+
+ # teams/eng/workers/builder/WORKER.md
+ ---
+ flow: worker
+ answersFor: build
+ ---
```

The board's local name is `work` and the desk keys are `build` and `review`. **No file names the
ledger the framework mints**, and no desk key is spelled like a seat id — the two are different
nouns ([ER-7](../../epics/FIX-1457/BUSINESS-RULES.md)) and the check would pass for the wrong
reason if they matched.

**Where it runs.** Under the shipped `fsdev dev`, which registers a file-declared hire as ordinary
flow copies — three seats and the channel singleton, with the channel's own four doors. That is
executed, not assumed ([the POC](poc/served-hire-observable/README.md)).

## What stays as it is

- **The substrate.** Boards, channels, inventory, dispatch honesty, org identity. Composed, never
  extended ([ER-4](../../epics/FIX-1457/BUSINESS-RULES.md)). Nothing under `packages/` changes, and
  no new substrate arrives under a polish label ([ER-25](../../epics/FIX-1457/BUSINESS-RULES.md)).
- **`TaskStatus`.** No value for *handed-off* or *notified*
  ([ER-8](../../epics/FIX-1457/BUSINESS-RULES.md)). *Waiting on you* stays a reading over parked
  plus its reason.
- **The two labs that already pass.** `channel-boards` and `manager-queue-lab` keep their claims
  and their verdict logs. This is a sibling, not a rewrite of either.
- **The DevTool.** This reads the rows [FIX-1481](https://linear.app/fixpoint-labs/issue/FIX-1481)
  ships and adds none. Its two code PRs are **content-complete and unmerged** — the reason on the
  row is [#2032](https://github.com/fixpoint-labs/flow-state-dev/pull/2032), and
  [#2039](https://github.com/fixpoint-labs/flow-state-dev/pull/2039)'s read-only mark
  (`writable === false`, and nothing else) is checklist row 6's, which this proof does not read.
- **Kitchen-sink, and any Lab product surface.** Out
  ([ER-24](../../epics/FIX-1457/BUSINESS-RULES.md#er-24),
  [ER-11](../../epics/FIX-1457/BUSINESS-RULES.md)).
- **[FIX-1474](https://linear.app/fixpoint-labs/issue/FIX-1474)'s composed notify-plus-file path.**
  Optional when it lands, never a gate — its own body says so.

## Sign off

1. **[D1](DECISIONS.md#d1) · The proof runs the shipped dev server and reads the handoff in a real
   browser, rather than asserting on a store.** *If wrong:* the proof needs a browser and built
   DevTool assets to run at all, and it is only ever as strong as the DevTool rows it reads —
   which are another issue's and not yet merged.
2. **[D2](DECISIONS.md#d2) · A handoff is a second row, filed by the seat that finished the
   first.** *If wrong:* we have fixed what "handed over" means for every later proof, and a
   future notify-based compose has to be shown equivalent to this rather than simply replacing it.
3. **[D3](DECISIONS.md#d3) · This proof stands up its own hire rather than sharing the DevForce
   proof's.** It reached outside this issue, so it went up rather than being decided here
   ([ER-17](../../epics/FIX-1457/BUSINESS-RULES.md#er-17)) — and **the owner closed it on
   2026-09-22**: *"keep them separate… we can combine them later"*
   ([#2045](https://github.com/fixpoint-labs/flow-state-dev/pull/2045#issuecomment-5780729223)).
   Recorded, not asked.

**Nothing in this set is open.** Number 1 is the decision to read closely. The reasoning and what lost:
[DECISIONS.md](DECISIONS.md). The cases: [BUSINESS-RULES.md](BUSINESS-RULES.md).
