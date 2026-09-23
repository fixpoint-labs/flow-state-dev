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
| **Now** | **4 epics done** · 2 in flight · 1 at its objective gate · 1 not started. The floor is down: W3 and W4 both wrapped on Sep 20, so **every epic here that fenced its ship work on "after W4's first cut" is released**. 150 work issues, of which **74 sit under no epic** — the vocabulary era this project began in |
| **Kill line** | If real apps turn out to want to assemble Layer 2 themselves, this project is mis-shaped rather than unfinished: what changes is that the conventions become examples, not the remaining epic list |

![The territory](figures/territory.svg)

Above the fence is what this project owns; below it is the substrate it assembles but does not
own. The fence is one question — *is there exactly one of it?* — and it is the test every epic
under this project is checked against.

## The epics — derived live 2026-09-23 21:20 UTC

| Epic | What it owns | State | Issues |
|---|---|---|---|
| [FIX-1332](https://linear.app/fixpoint-labs/issue/FIX-1332) · **W2 foundation** | Conventions, seat factory, thin Agent | **done** | 5/5 |
| [FIX-1359](https://linear.app/fixpoint-labs/issue/FIX-1359) · **default agent flow** | OOTB replaceable `agent` flow kind | **done** | 8/11 |
| [FIX-1351](https://linear.app/fixpoint-labs/issue/FIX-1351) · **W3 file surface** | Channels, resources, skills + a thin pentest lab | **done** | 19/20 |
| [FIX-1407](https://linear.app/fixpoint-labs/issue/FIX-1407) · **W4 routing** | Work routing & package cohesion | **done** | 7/9 |
| [FIX-1457](https://linear.app/fixpoint-labs/issue/FIX-1457) · **W5 release QA** | Retitled in Linear: Devtool, a DevForce proof, multi-seat collab | **in flight** | 3/8 |
| [FIX-1455](https://linear.app/fixpoint-labs/issue/FIX-1455) · **kitchen-sink rebuild** | The always-on reference consumer — durable hire, channels, shipped UI | **in flight** | 4/8 |
| [FIX-1528](https://linear.app/fixpoint-labs/issue/FIX-1528) · **plane isolation** | A private team stays in the org and with the person it was built for — hire, catalog, session, restart | **at its gate** — [#2103](https://github.com/fixpoint-labs/flow-state-dev/pull/2103) | 3/7 |
| [FIX-1333](https://linear.app/fixpoint-labs/issue/FIX-1333) · **W1 MCP door** | Client door over intake, boards, dispatcher | *not started* — **scope disputed** | — |

4 done · 2 in flight · 1 at its gate · 1 not started. Every number above is re-derived from Linear
and the epic PRs each refresh; none is carried forward.

**This is the case the two-source rule exists for, and each half caught one epic.** W4 reads
**done** from [#1905](https://github.com/fixpoint-labs/flow-state-dev/pull/1905), closed unmerged
01:02 UTC, while Linear says *In Review*. W3 is the mirror: Linear completed it at 01:05 and left
[#1718](https://github.com/fixpoint-labs/flow-state-dev/pull/1718) **open** — the reverse of the
wrap convention, recorded rather than corrected, because that PR is not this artifact's to close.
W2 and the agent flow wrapped the ordinary way; W5 is
[#1944](https://github.com/fixpoint-labs/flow-state-dev/pull/1944).

**Plane isolation is the eighth epic, filed Sep 23 with most of its set already shipped.** Three
children landed before the epic existed (FIX-1529 via #2091, FIX-1525/1526 via #2079); both bug
fixes and the explore are in review, and FIX-1538 waits on the objective gate at
[#2103](https://github.com/fixpoint-labs/flow-state-dev/pull/2103). *Derived Sep 23. The paragraphs
below are the Sep 20 fold and have not been re-read against W5's retitle; that is the next
Update's job.*

**Both wraps are now folded.** What W3 and W4 settled for their siblings is in
[Decisions](DECISIONS.md) → *decided once*. What they **did not** settle is in the section below
it, kept separate on purpose: an unratified operating default, three items named out with no owner,
and a door whose owning issue reads Done while the code does not carry it. A wrap that recorded
those as answers would have manufactured four ratifications nobody gave.

**W5's set was cut in half today, and neither half was a setback.**
[#1944](https://github.com/fixpoint-labs/flow-state-dev/pull/1944) carries `spec approved`. Of the
two children it had at its gate, **FIX-1458 — people on the org chart — is canceled** and out of the
epic, revisitable when multi-user pain is real; **FIX-1455 is un-parented** and runs as its own epic
below. What W5 keeps is the living-assemblies half, now three children (FIX-1467 done; FIX-1468 and
FIX-1469 in backlog). **Its ship fence has lifted**: W4's first cut exists and W4 has wrapped, so
what remains is W5's own sequencing, not a hold on anything upstream ([Plan](PLAN.md)).

**The kitchen-sink rebuild is an epic in its own right, by the owner's call today.** FIX-1455 was
filed Sep 19 as W5's child and un-parented Sep 20: the reference consumer is not a spine item of the
living-assemblies epic, it is the always-on Proof this project's own outcome is read against — one
app someone copies, standing up a team from files. It enters setup now with one child (FIX-1429, the
unwired file-declared demo) and no epic PR yet. **It is the second epic released by the floor coming
down** ([Decisions](DECISIONS.md) → *decided once*): its ship half was fenced on W4's first cut, the
same condition W5's was, and that condition is met.

**W4 wrapped at 7 of 9 — growth, not a reopened set size.** The ratified five are all done;
FIX-1451 and FIX-1381 attached after the gate and are done too. What is left is two strays in
backlog — FIX-1460 (the fate of `unionAllowedTools`) and FIX-1461 (documenting
`registerCatalogTools`) — which the owner has said not to worry about, so they are **deliberately
deferred, not pending**. Whether the newcomers sat inside W4's exit gate was #1905's call and it
closed without saying; that orphan is carried in [Decisions](DECISIONS.md), still unresolved.

**W1's status comes from the issue; a second surface disagrees.** FIX-1333 has sat in **Todo**
since Sep 8 — never moved, nothing blocking it, priority **High**. The project's
[delivery countdown](https://linear.app/fixpoint-labs/document/workforce-delivery-countdown-e6b3b230c62d)
files it under *soft / follow-on*: **"W1 MCP (held) — not on the Workforce feature-complete
path."** Linear carries no hold, and the team has an **On Hold** status FIX-1333 is not in. *Not
started* and *out of scope* are different answers, so it stands as an ask:
[Decisions](DECISIONS.md) → Open.

**FIX-1359 is done with 7 of 11 issues closed** — a wrap that outran its children, or four issues
that should have left it. Left as Linear has it; the discrepancy is the signal.

```mermaid
flowchart LR
  W2["FIX-1332 · W2 foundation"] --> AF["FIX-1359 · agent flow"]
  W2 --> W3["FIX-1351 · W3 file surface"]
  AF --> W3
  W3 --> W4["FIX-1407 · W4 routing"]
  W3 --> W5["FIX-1457 · W5 release QA"]
  W3 --> KS["FIX-1455 · kitchen-sink rebuild"]
  W4 -.->|"first cut before ship"| W5
  W4 -.->|"first cut before ship"| KS
  KS -->|"the durable hire row"| PI["FIX-1528 · plane isolation"]
  W2 --> W1["FIX-1333 · W1 MCP door"]
  classDef done stroke-width:2px
  class W2,AF,W3,W4 done
```

Four heavy borders and three live nodes. Plane isolation fences the hire row the kitchen-sink rebuild made durable.
**Both dotted edges have gone slack** — they carried the same condition, W4's first cut, and it
exists. W5 and the kitchen-sink rebuild are siblings, not a nesting; that changed today. W1,
depending on no file surface, remains the one epic that can sit unstarted without blocking
anything.

## What this project is not

- **Not where primitives live.** Blocks, resources, the task board's claim system and dispatch are
  Layer 1. They are assembled here and owned in `core` / `engine` / `orchestration`.
- **Not the implementation of Tasks, Skills internals, or Memory.** Those run in their own
  projects. This one owns the vocabulary and the few epics that establish the surfaces.
- **Not a lock on the model.** The vocabulary is ratified by concrete code shapes, not by
  agreement; see [Decisions](DECISIONS.md) → PD-4.
