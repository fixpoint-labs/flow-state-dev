# FIX-1650 · Decisions

[Spec](SPEC.md) · **Decisions** · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The calls above any single issue. D1 to D3 are the sign-off surface. Two forks are open for
Jake, each with a recommendation, and only the children they touch wait on them. Scope,
vocabulary and invent-kills come from the Architect's guidance on FIX-1650; the prior locks on
the open forks are only these: `workforce/projects/` is invent-killed, single-user comes first,
project is product framing, and CoS and Ops are composed from the existing seat and kind
registers.

## The tree

```mermaid
flowchart TD
  E["FIX-1650"] --> D1["D1 · three issues and a closure"]
  D1 -.->|"rejected"| X1["five issues, one per noun"]
  E --> D2["D2 · no new noun, no new folder"]
  D2 -.->|"rejected"| X2["a project folder or record"]
  E --> D3["D3 · channels stay declared"]
  D3 -.->|"rejected"| X3["Ops opens and retires channels"]
  E --> Q1["Q1 · open · what a project is"]
  E --> Q2["Q2 · open · org seats and hire policy"]
```

<a name="d1"></a>
## D1 · Three issues and a closure; only the two the open questions touch wait

| | |
|---|---|
| **Instead of** | Five issues, one per noun: project, workstream, CoS, Ops, repair · or filing nothing until Jake answers |
| **Because** | A workstream already is a declared channel with its boards: Shift Manager lists them today, so it needs a rule, not an issue. CoS and Ops share one template and one approval policy, so they are one spec. Orphan repair (FIX-1621, adopted) needs no answer from Jake and Ops consumes it, so it is the issue that starts at the gate |
| **Locks in** | FIX-1621 starts at the gate. FIX-1718's spec starts when Q1 is answered and FIX-1719's when Q2 is. The workstream's definition is FIX-1718's to write ([ER-2](BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt)) |

**What would change my mind:** Q2's answer giving CoS behaviour of its own (routing asks,
standing reports). Then CoS splits from Ops at FIX-1719's spec.

![D1: three issues and a closure, chosen, beside five issues one per noun; decided by what waits on Jake](figures/d1-three-and-closure.svg)

It comes down to what waits on Jake: three lets repair start, five parks four issues.

<a name="d2"></a>
## D2 · Project and workstream are product framing over what the tree already holds; nothing new in L1, no new folder

| | |
|---|---|
| **Instead of** | A project folder or record of its own (`workforce/projects/`, invent-killed) · a Workstream type beside channels and boards |
| **Because** | The shell needs a grouping and four reads (stream, board, workstreams, brief); channels, their boards, their charters, teams and documents already carry all of them. Workforce is Layer 2: Agent, Team, Channel and Project stay out of core and engine |
| **Locks in** | Q1 is answered inside channels, teams, boards and documents. An answer that needs a folder or an L1 type is an escalation back to this epic, not a child's call. At most a key is added to `CHANNEL.md`'s closed list |

**What would change my mind:** a project that must own something no channel, team or document
can hold, such as a budget or a membership separate from its workstreams.

![D2: in the tree as it is, chosen, beside a project folder or record; decided by whether a new noun appears](figures/d2-no-new-noun.svg)

It comes down to a new noun: a folder of its own reopens an invent-kill.

<a name="d3"></a>
## D3 · Channels stay declared in this epic: no runtime open, retire or invite

| | |
|---|---|
| **Instead of** | Ops opening and retiring workstream channels at runtime |
| **Because** | Hire and fire ride a shipped capability (`createSeatHireCapability`). Channel admin was explored (FIX-1415, #2084), not shipped, and parked behind Collab mint (FIX-1341), with the Architect's fence: no worker-facing channel-admin tools until Collab and the inventory land. "Channels" in the PRD's CoS + Ops line reads, here, as Ops reading them |
| **Locks in** | A new workstream is a `CHANNEL.md` and a restart. Ops never writes a channel in this epic ([ER-3](BUSINESS-RULES.md#what-no-child-may-do)) |

**What would change my mind:** Jake wanting Ops to open workstreams in the first version. Then
this epic waits on FIX-1341 being un-parked, and that is his scheduling call.

![D3: channels stay declared, chosen, beside Ops opening and retiring them; decided by what exists to build on](figures/d3-channels-declared.svg)

It comes down to what exists: hire ships, channel admin is a parked explore.

<a name="open"></a>
## Open · for Jake

<a name="q1"></a>
### Q1 · What is a project: a channel of its own, a team, or a named pack of channels?

**In plain terms.** Shift Manager shows a project with a stream, a board, its workstreams and
a brief. Something in the Lab's files has to say which workstreams belong to which project, and
where its stream and brief come from. Nothing does today.

**The trade-off.** A **project channel**: a channel whose charter is the brief and whose
conversation is the project stream, which its workstream channels name. Stream and brief come
for free, and one team can work on several projects; the cost is one new key on a workstream's
`CHANNEL.md`. A **team**: a project is a team folder, its `TEAM.md` the brief, its channels the
workstreams. Nothing new, but a team has no conversation of its own, and a second project needs
a second team of the same people. A **pack**: a key that groups channels by name. Teams can
span projects, but there is no stream, and the brief needs a document.

**My recommendation:** a project channel. It is the only option where the project stream is a
real conversation the CoS can post to, and it keeps teams free to work across projects, as
DevForce's design (D-12) already assumes.

**What would change my mind:** if you think of a project as one team's body of work, one team
per project. Then a team is simpler and adds nothing.

**What being wrong costs:** about one issue's rework (FIX-1718), no stored data: the link is a
key in `CHANNEL.md` files. None of the three needs a folder or an L1 type, so none is an
escalation.

![Q1: its own channel, recommended, beside a team and a pack of channels; decided by where the project stream and brief come from](figures/open-project.svg)

It comes down to the project stream: only a channel already has a conversation.

<a name="q2"></a>
### Q2 · Which org seats does a Lab get, and may Ops hire and fire without asking?

**In plain terms.** The PRD names two default seats: a chief of staff (CoS) and Ops. Today a
person changes who works in a Lab by editing files and restarting. The question is which seats
a Lab gets, whether it gets them without asking for them, and whether Ops may add or remove a
worker on its own.

**The trade-off.** Approval on every hire and fire costs a click in Inbox each time and means
nothing changes overnight; letting Ops act within a list of allowed kinds removes the click and
means a model decides who works there. Booting the seats in every Lab saves a Lab one step and
gives seats to Labs that never wanted them.

**My recommendation:** two org-level seats, CoS and Ops, under `workforce/org/workers/`, both on
the built-in `agent` kind, which a Lab opts into. **CoS** is the person's one point of contact:
it reads the inventory and boards, posts to project streams, and holds no hire tool. **Ops**
holds the existing seat-hire capability: it hires and fires seats of kinds the Lab registers,
never an org seat and never itself, and every hire and fire is an approval the person answers
in Inbox. Ops also clears orphaned seats through FIX-1621. Neither opens channels ([D3](#d3)).
How a Lab opts in (a template it copies, or documents it names) is FIX-1719's spec's call.

**What would change my mind:** if you want hires to happen unattended, for example a Lab that
staffs itself overnight. Then Ops acts within an allowlist and the person is told after.

**What being wrong costs:** loosening approval later is a policy change in FIX-1719's
documents. Tightening it after unattended hires have shipped means auditing seats a model chose.

![Q2: CoS and Ops, opt-in, Ops asks first, recommended, beside Ops alone, always on, hiring freely; decided by who changes the roster](figures/open-org-seats.svg)

It comes down to who changes the roster: the person, or a model inside a list.

## Who owns what

![Who owns what: nine cross-cutting rules by FIX-1718, FIX-1621, FIX-1719 and FIX-1720, one decides or builds cell per rule](figures/ownership.svg)

Every rule has one owner. FIX-1621 decides what an orphan is, so Ops calls its read rather than
writing a second detector. FIX-1718 decides what a project and a workstream are, so CoS joins a
project's channel the way FIX-1718 defines it. The closure only checks.

## Decided in review, recorded so no child reopens them

- **FIX-1621 joins the set** as a child, moved into this project. It is the "fire" half of the
  Ops defaults, and leaving it out would give Ops a second orphan detector. Its own open walls
  (template or documented, delete-only or guided re-hire, banner or Ops seat) are answered by
  Q2 where Q2 reaches and by its spec otherwise.
- **Single user, one org per Lab run, from the principal.** No org id in a request body; nothing
  multi-user is built.
- **FIX-1715, FIX-1716 and FIX-1717 are not children.** They are Workforce EM's parallel tracks.
- **A fired seat leaves TEAMS.** Today `fire` keeps the seat's inventory row. FIX-1621 retires
  first, so it owns removing the row; FIX-1719's Ops fires through the same path
  ([PLAN.md](PLAN.md#coordination-seams-to-watch)).

## What the end-state POC showed

None built. Every piece the set composes ships today; the open questions are product calls a
POC can't answer.

## How it got here

- **Drafted (Oct 1)** from the Architect's guidance on FIX-1650, FIX-1649's ownership amendment
  (#2423) and the shipped code; FIX-1718, FIX-1719 and FIX-1720 filed, FIX-1621 adopted. Q1 and
  Q2 opened for Jake with recommendations.
