# FIX-1793 · Decisions

[Spec](SPEC.md) · **Decisions** · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

Two open questions and one decision are the sign-off surface. Q1 is the epic's own ask
([epic Q2](../../epics/FIX-1786/DECISIONS.md#q2)), put here as it said. Q2 is the Architect's.
D1 answers the epic's cost check. The model itself (a workstream is an entry plus its lead's
session, rooms removed, progress computed) is the epic's, and is not reopened.

## The tree

```mermaid
flowchart TD
  I["FIX-1793"] --> Q1["Q1 · open · the shared half stays in the MVP"]
  Q1 -.->|"recommended against"| XQ1["private only · shared as a fast follow"]
  I --> Q2["Q2 · open · a shared project's members open workstreams"]
  Q2 -.->|"recommended against"| XQ2["anyone in the org"]
  I --> D1["D1 · a private project is the same row in user scope"]
  D1 -.->|"rejected"| X1["an org row under the owner-private fence · no browser read"]
  I --> E1["engineering · the owner rule is a mode of the owner-key fence"]
  E1 -.->|"rejected"| XE1["the owner stamped in state · a Workforce-only gate"]
```

Solid edges are what you're signing. Dashed edges lost, and the label says why.

<a name="q1"></a>
## Q1 · open · Does the shared half stay in the MVP?

**The fork.** Keep shared projects, with workstreams owned by different users and the new
engine rule behind them, in the MVP; or ship private projects only and make sharing a fast
follow?

**In plain terms.** With shared projects, Alice and Bob each own part of one project and see
each other's progress in the app. Private only, every project is one user's, and a teammate's
work is invisible in the app until the follow.

**The trade-off.** Keeping it costs this issue one engine rule, a second mode of a check the
engine already has (PR 1 of four), and the cross-owner reads in the project view and the
coordinator. Cutting it saves that, but today's projects are all shared org rows: a private-only
MVP needs an operator step that gives each one to a single user, and takes sharing away from
the people on it.

**My recommendation: keep shared projects.** Sharing is what projects do today, so cutting it
removes a feature rather than deferring a new one, and the rule it needs is the epic's one
planned Layer 1 change here. The library (FIX-1795) is the other part of the epic's "shared
half"; its cost is FIX-1795's to price at its own gate, and nothing here depends on it.

**What would change my mind.** If no installation shares a project today (the DevTeam lab is run
by one person) and the MVP's users are single-user installs, then cut it here, take the rows to
their creators, and the epic drops leg b's two-owner half.

**If wrong.** Keep, wrongly: the owner rule and its tests land about one PR before anyone uses
them. Cut, wrongly: a team's shared projects become one person's until the follow. Either is
an epic amendment ([ER-24](../../epics/FIX-1786/BUSINESS-RULES.md#how-the-set-is-run)).

![Q1, a live fork: keep shared projects in the MVP, recommended, beside private only with sharing as a fast follow. Decides it: today's projects are already shared, so cutting removes a feature. The price of keeping: one engine rule. Flips if no installation shares a project and the MVP is single-user](figures/open-shared-half.svg)

It comes down to today's projects: they are shared already, so private-only takes sharing away.

<a name="q2"></a>
## Q2 · open · Who may open a workstream on a shared project?

**The fork.** Only the project's members, or anyone in the org?

**In plain terms.** Members are the people the project's creator listed when making it, as
today. With anyone, every user in the org can attach a workstream they own to any shared project.

**The trade-off.** Members keeps the creator in charge of who works on the project, with a list
projects already keep. But nothing changes members after create today, so a teammate who joins
later can't take a workstream until that write exists. Anyone needs no list, but the project's
creator can't remove a workstream someone else attached: the owner rule protects it.

**My recommendation: members.** It reuses what a project already has, it is one check, and it
keeps a stray workstream off a project nobody can then tidy. Changing members after create is a
small follow-up ([PLAN](PLAN.md#follow-ups)).

**What would change my mind.** Shared projects turning out to be org-wide efforts that anyone
should be able to join without asking, such as a standing "engineering" project.

**If wrong.** Members, wrongly: a late teammate waits for the member write. Anyone, wrongly:
projects collect workstreams their creators can't remove. Either flips by changing one check.

![Q2, a live fork: a shared project's members open workstreams, recommended, beside anyone in the org. Decides it: who can tidy a project afterwards. Price: members are fixed at create until a follow-up. Flips if shared projects are open to the whole org](figures/open-who-opens.svg)

It comes down to tidying: with anyone, a creator can't remove a workstream they don't own.

<a name="d1"></a>
## D1 · A private project is today's project, kept in its owner's user scope

| | |
|---|---|
| **Instead of** | Private only by a flag on the org row, hidden by the owner-private fence · or no private projects (the epic's cost condition) |
| **Because** | The [POC](poc/scope-config/README.md) shows one row schema declared at org scope and at user scope in one flow: both land, Bob lists none of Alice's private ones, and the browser reads each (S1 to S4). The owner-private fence has no browser read, so Shift Manager couldn't list such rows (G3). User scope is where the epic keeps a user's private things: their workers are there. The cost, against the epic's "mostly a scope configuration": three declarations at user scope, one `visibility` option on create, a second list read, and an address that names the visibility |
| **Locks in** | A private project needs FIX-1790 merged first: today user scope crosses orgs and Alice's private project reads in her second org (POC O1). A project's address is its visibility and its id, so a private and a shared project can share an id. No write turns a private project into a shared one: it would move rows between scopes, and nothing asks for it |

![D1: a private project as the same row in user scope, chosen, beside private only by a flag under the owner-private fence. Decides it: whether the browser can list the rows. Price: an address that names the visibility, and a wait on FIX-1790. Flips if user scope can't be kept per org](figures/d1-scope-config.svg)

It comes down to the browser: the owner-private fence hides the rows from the app's own list.

**What would change my mind:** FIX-1790 slipping past this issue's build. Then private projects
wait, and this issue ships shared ones first rather than hold.

<a name="decided-not-asked"></a>
## Decided, not asked

Engineering calls, recorded so nobody re-derives them.

- **The owner rule is a mode of the owner-key fence: `ownerWrites: { param }`.** The owner is
  read off the key, as for `ownerPrivate`: every read path admits the row to anyone the scope
  serves, and a create, update or delete is refused loudly unless the session's user is the one
  the key names. The startup fence applies, so no wider collection can reach the rows. The
  epic's `workstreams/<project>/<workstream>` gains the owner segment for it. POC G1 and G2:
  neither shape the engine has today is the rule.
- **The visibility is where the row lives**, not a field on it, so the two can't disagree. A
  create with no visibility makes a shared project, as today.
- **Room rows stay in the store, unread.** No history view: rooms are removed, and nothing is
  deleted (BP-030). An operator can still read them.
- **Claims and a row's mailbox list stay, deprecated, until FIX-1792.** They place a mailbox
  board's coding runs in a project today; they go when FIX-1792 converts each board, and its
  per-board table can use them. This moves their removal to FIX-1792, so it binds once the epic
  records it ([ER-24](../../epics/FIX-1786/BUSINESS-RULES.md#how-the-set-is-run)).
- **No engine record of the collections a turn wrote.** It would be a fourth Layer 1 change
  ([ER-22](../../epics/FIX-1786/BUSINESS-RULES.md#what-no-child-may-do)); it is raised to the
  epic. Shift Manager reads the Lab again after each project coordinator turn (#2720's floor)
  and when a project view opens, and special-cases no tool name.
- **The project coordinator is a session of a standard coordinator worker the installation
  names**, linked to one project when it is created, through FIX-1788's helpers with a
  `project` criterion. Its delegates are the user's own workstreams in that project, read on each
  post. Delivery goes into the lead's workstream session through FIX-1791's ledger.
- **A workstream's lead is chosen when it opens and doesn't change**, because a session's
  worker never does (FIX-1788). A workstream id is unique per project and owner.
- **Out of scope:** changing members after create, private to shared, and waking a lead on a
  schedule. A quiet entry shows as stale.
- **`mintFor:` and `defineProjectsCollection({ talk })` are refused by name**, with the reason.

## Considered and dropped

| Alternative | Why not |
|---|---|
| A project row listing its workstreams | Every owner's update races every other's (the concept) |
| Progress kept on the row | It drifts from the entries and becomes another shared write (ER-7) |
| The owner stamped in the entry's state and checked on write | A stored field direct flow code can set, and a rule only processes that loaded it enforce |
| The owner rule as a Workforce check | Another flow declaring the collection writes around it; the epic put it in Layer 1 (D3) |
| A room kept read-only for its history | A second reader for a removed feature |
| The project coordinator as its own flow | The epic's D2: one coordinator flow |
| A delivery ledger for project coordinators | FIX-1791's ledger, reused (the EM's note) |

## What the POC showed

`bash specs/issues/FIX-1793/poc/scope-config/run.sh`, 8 legs, all as pinned
([README](poc/scope-config/README.md)). The premise of D1 held: one row at two scopes, apart,
with a browser read each. Today's user scope crosses orgs, so D1 waits on FIX-1790. Neither
existing shape is the owner rule. Nothing moved the design.

## How it got here

- **Draft** — framed as the epic's leg b; private projects as a scope configuration, workstream
  entries under a new owner-writes mode of the owner-key fence, a project coordinator on
  FIX-1791's flow and ledger, rooms removed with their rows kept; four PRs.

**Open: Q1 and Q2.**
