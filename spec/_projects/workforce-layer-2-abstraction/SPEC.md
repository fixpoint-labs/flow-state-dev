# Workforce: Layer 2 Abstraction

**Spec** · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md)

Layer 2 is the everyday API most people who use FSD will live in: Agents, Teams, and the
conventions that assemble them. It is transparently implemented on Layer 1 — no black box — but
the README, the docs and the common path lead with it. This project owns the vocabulary and the
epics that establish it.

## The outcome

| | |
|---|---|
| **Winning when** | Someone stands up a working team of agents from files alone — no TypeScript to declare a channel, a resource, or a skill — and Layer 1 stays fully available to anyone who wants past the conventions |
| **The read** | Layer 2 nouns that still require code to declare. Five at the start, and the count only moves when a convention ships with a reader and a proof |
| **Now** | 2 epics done · **2 in flight** · 1 not started. W4 cleared its objective gate on Sep 19 with three child specs running. 91 work issues, of which **40 sat under no epic** at the last Linear read — the vocabulary era this project began in |
| **Kill line** | If real apps turn out to want to assemble Layer 2 themselves, this project is mis-shaped rather than unfinished: what changes is that the conventions become examples, not the remaining epic list |

![The territory](figures/territory.svg)

Above the fence is what this project owns; below it is the substrate it assembles but does not
own. The fence is one question — *is there exactly one of it?* — and it is the test every epic
under this project is checked against.

## The epics — as of 2026-09-19

| Epic | What it owns | State | Issues |
|---|---|---|---|
| [FIX-1332](https://linear.app/fixpoint-labs/issue/FIX-1332) · **W2 foundation** | Conventions, seat factory, thin Agent | **done** | 5/5 |
| [FIX-1359](https://linear.app/fixpoint-labs/issue/FIX-1359) · **default agent flow** | OOTB replaceable `agent` flow kind | **done** | 7/11 |
| [FIX-1351](https://linear.app/fixpoint-labs/issue/FIX-1351) · **W3 file surface** | Channels, resources, skills + a thin pentest lab | **in flight** | 16/21 |
| [FIX-1407](https://linear.app/fixpoint-labs/issue/FIX-1407) · **W4 routing** | Work routing & package cohesion | **in flight** | 1/5 |
| [FIX-1333](https://linear.app/fixpoint-labs/issue/FIX-1333) · **W1 MCP door** | Client door over intake, boards, dispatcher | *not started* — **scope disputed** | — |

2 done · 2 in flight · 1 not started — the first time this project has run two epics at once.

**The epic PRs are the other half of this table**, because an epic wraps by closing its PR unmerged
and leaves its Linear state alone. W2 and the agent flow read *done* that way
([#1664](https://github.com/fixpoint-labs/flow-state-dev/pull/1664),
[#1730](https://github.com/fixpoint-labs/flow-state-dev/pull/1730)); W3 is *in flight* on
[#1718](https://github.com/fixpoint-labs/flow-state-dev/pull/1718), and W4 on
[#1905](https://github.com/fixpoint-labs/flow-state-dev/pull/1905), open and labelled *spec
approved*.

**W4 is five children, not seven.** Its objective gate (Sep 19) cut the set to FIX-1394, FIX-1405,
FIX-1385, FIX-1408 (done) and FIX-1430 as the proof. FIX-817 and FIX-1415 are now
**related-not-child**: they keep their dependency on FIX-1405 without holding W4 open past its own
exit gate. Three specs run in parallel — FIX-1394, FIX-1405, FIX-1385 — with FIX-1430 to follow.

**W1's status is derived from the issue; a second surface disagrees with it.** FIX-1333 has sat in
**Todo** since Sep 8 — one state-history entry, never moved, nothing blocking it, priority still
**High**. Re-derive it there. The project's
[delivery countdown](https://linear.app/fixpoint-labs/document/workforce-delivery-countdown-e6b3b230c62d)
(Sep 18) instead files it under *soft / follow-on*: **"W1 MCP (held) — not on the Workforce
feature-complete path."** Linear carries no hold — the team has an **On Hold** status and FIX-1333 is
not in it. *Not started* and *deliberately out of scope* are different answers, so the disagreement
is left standing as an ask: [Decisions](DECISIONS.md) → Open.

**One number in that table is recorded rather than tidied.** **FIX-1359 is marked done with 7 of
11 issues closed** — either a wrap that outran its children, or four issues that should have moved
out of it. It is left as Linear has it, because the discrepancy is the useful signal. (The arc
carries the other oddity: the numbering is not the order.)

```mermaid
flowchart LR
  W2["FIX-1332 · W2 foundation"] --> AF["FIX-1359 · agent flow"]
  W2 --> W3["FIX-1351 · W3 file surface"]
  AF --> W3
  W3 --> W4["FIX-1407 · W4 routing"]
  W2 --> W1["FIX-1333 · W1 MCP door"]
```

W2's conventions and seat factory are what everything else builds on. W1 is the one epic that does
not depend on the file surface, which is why it can sit unstarted without blocking anything.

## What this project is not

- **Not where primitives live.** Blocks, resources, the task board's claim system and dispatch are
  Layer 1. They are assembled here and owned in `core` / `engine` / `orchestration`.
- **Not the implementation of Tasks, Skills internals, or Memory.** Those run in their own
  projects. This one owns the vocabulary and the few epics that establish the surfaces.
- **Not a lock on the model.** The vocabulary is ratified by concrete code shapes, not by
  agreement; see [Decisions](DECISIONS.md) → PD-4.
