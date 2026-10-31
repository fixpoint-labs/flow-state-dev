# Decisions — Workforce: Shift Manager

[Spec](SPEC.md) · **Decisions** · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md)

Calls that bind more than one epic under this project. A call one epic owns lives in that epic's
spec. No `PD` card yet: every call below is settled, by the owner or by an epic at wrap, so it is
recorded once rather than argued as a card.

## Decided once

Settled by the owner on 2026-09-29, recorded so no epic reopens them. Sources: the project's
original Linear description ([absorbed](absorbed/linear-content.md)) and the FIX-1649 brief.

1. **The shell owns how a surface is reached and how it looks; the sibling epic owns what it
   means.** Projects and workstreams are FIX-1650 and FIX-1651, attention and resources FIX-1652,
   review wake FIX-1653. The shell never re-implements their product work; until a sibling ships,
   its surface shows a named empty state. Surface by surface, the split is FIX-1649's approved
   [who-owns-what table](https://github.com/fixpoint-labs/flow-state-dev/blob/main/specs/epics/FIX-1649/DECISIONS.md#who-owns-what);
   for workstreams, see 7.
2. **This project is not Layer 2 vocabulary.** It lives in Workforce: Layer 2 Abstraction
   (P-FIX-40); an epic here that needs a new noun files it there. *FIX-1786, filed here, rewrites
   that vocabulary: [Open](#open), ask 2.*
3. **DevForce is a Lab built completely on Workforce** (D-12, Conductor retired). The finish-line
   Labs are DevForce and CyberForce.
4. **Wake is FIX-1637's.** This project points at the wake spine and never builds its own
   heartbeat.
5. **Sequencing: FIX-1649 and FIX-1650 are the Cycle 2 candidates; FIX-1651 to FIX-1653 hold** until
   the Cycle PM stamps a proof gap. None of it pours into Cycle 1.
6. **One app opens every Lab; a Lab is the Workforce tree it opens.** Decided by Jake on
   2026-09-30 as FIX-1649 [D3](https://github.com/fixpoint-labs/flow-state-dev/blob/main/specs/epics/FIX-1649/DECISIONS.md#d3).
   No epic here builds a Lab app, a chrome kit or a wrapper; DevForce and CyberForce arrive as trees.
7. **A workstream is split between two epics.** FIX-1650 owns the workstream itself: the
   channel, its flow, and that it exists. FIX-1651 owns what sits on its board: tasks, rows,
   brief, results, and task states. Decided by the EM on 2026-09-30 from FIX-1649's Linear
   description; FIX-1649's who-owns-what table was amended on Sep 30 to match. *Contested by
   FIX-1786: [Open](#open), T3.*

### Settled by FIX-1649, recorded at its wrap on 2026-10-04

Each binds a sibling that ships into the shell. Sources: FIX-1649's retained
[spec](https://github.com/fixpoint-labs/flow-state-dev/tree/main/specs/epics/FIX-1649), its
children's specs, and Jake's calls during the build.

8. **One skin for every Lab.** The design-system package's Shift Manager theme is the only skin,
   and every Lab Shift Manager opens wears it; no epic adds a per-Lab theme. The registry's
   neutral token defaults stay their own installed file beside the copied components, and the
   theme overrides them from outside FSD; remove the theme import and every screen falls back to
   them (FIX-1663 leg c). A sibling's surface is drawn in v2's look ([PR-1](BUSINESS-RULES.md));
   FIX-1649's ER-16 exemption for a part waiting on a sibling's data ends when that data ships.
9. **The registry's Approve and Reject buttons stay v1** (Jake). The ask card keeps the
   registry's filled Reject, not v2's bordered Deny, and is not graded against v2. It changes
   only at the registry source, never in a Shift Manager copy, and the natural moment is
   FIX-1652 settling what Approve and Deny are called and do.
10. **An ask shows wherever its seat is.** A seat's pending ask is listed in Inbox and on the
    Stream of every channel the seat is a member of, with one rendering, so answering it anywhere
    clears it everywhere ([FIX-1662 BR-18](https://github.com/fixpoint-labs/flow-state-dev/blob/main/specs/issues/FIX-1662/BUSINESS-RULES.md#workstreams-and-posting)).
    Until FIX-1652 defines attention, Inbox holds the asks in the seat sessions the person can
    list; an org-wide ask read is FIX-1652's call.
11. **Shift Manager reaches the engine through a fixed seam list** (FIX-1649 ER-15, as the
    closure pins it). Its only room writes are `lib/talk.ts`'s `sendAction(` (a project room's
    read, post and join, on `ROOM_KIND`) and `lib/reads.ts`'s `createSession(` (the person's room
    session, on `ROOM_KIND`), both into the person's own sessions, never a worker's. Held as
    [PR-2](BUSINESS-RULES.md). *Contested by FIX-1786: [Open](#open), T2.*
12. **Projects are usually cross-team, and private or shared** (Jake). A project names no team;
    one whose workstreams all sit in one team is allowed but is never the default
    ([FIX-1718 BR-2a](https://github.com/fixpoint-labs/flow-state-dev/blob/main/specs/issues/FIX-1718/BUSINESS-RULES.md)).
    *Amended by FIX-1786
    [Q2](https://github.com/fixpoint-labs/flow-state-dev/blob/main/specs/epics/FIX-1786/DECISIONS.md#q2),
    Jake, 2026-10-06:* a project is private or shared, chosen at create, one project type; a
    shared one is read by the whole org. FIX-1762's stack merged first, then FIX-1763's *projects
    stay org-level* fence was lifted by name; its locks (one optional remote, a mapped worktree,
    side files outside the checkout) carry into FIX-1793 unchanged. It settled what was tension T1.
13. **A workstream's board is the one its channel declares.** Only `boards:` on a channel attaches
    one; a board declared in a kind's code is not a workstream's board. The five-column Board is
    Shift Manager's mapping of shipped task statuses, which FIX-1651 may replace; IN REVIEW holds
    nothing until FIX-1651 ships a review state. *Contested by FIX-1786: [Open](#open), T3.*
14. **A worker's shift status has one rule.** On shift, on call and off shift are derived in
    Shift Manager from board rows and pending asks (FIX-1723), with no field in Workforce; a
    sibling that shows a worker's status uses that rule.
15. **The CoS seat's screen is called Shift Coordinator in Shift Manager only** (Jake, FIX-1747).
    The `chief-of-staff` seat and its persona keep their name everywhere else, FIX-1650's
    included. *Contested by FIX-1786: [Open](#open), T4.*

### Settled by FIX-1815, recorded at its wrap on 2026-10-11

Each binds a sibling that hands work between workers or shows a waiting turn. Sources: FIX-1815's
retained [spec](https://github.com/fixpoint-labs/flow-state-dev/tree/main/specs/epics/FIX-1815)
and its children's, FIX-1816, FIX-1817 and FIX-1820. FIX-1870 (Orchestration Primitives, Backlog)
proposes `dispatchTask` in place of 16 to 18's surface; until it is decided, these stand.

16. **One word per thing** (FIX-1786
    [D10](https://github.com/fixpoint-labs/flow-state-dev/blob/main/specs/epics/FIX-1786/DECISIONS.md#d10)).
    A *hand-off* is Layer 1: work leaves the request and one answer comes back; *ask* and *assign*
    are its two kinds. *Delegation* is Layer 2: a hand-off to a worker on the roster. *Mailbox* is
    reserved for a future untrusted external inbox. Shift Manager's Inbox *ask* (10) is a person's
    pending approval, not a worker's ask.
17. **Ask is `addTask(task, { waitForResponse: true })`**: no new tool, no request-level wait. The
    turn parks and resumes; nothing holds a request open. A turn working a task cannot ask, so depth
    is 1, and an asked task cannot park on a question. `timeoutMs` defaults to five minutes, from 30 seconds to an hour; outside that
    it is refused, never clamped.
18. **A waiting turn never hangs.** An expired ask resumes with `wait_timed_out` and cancels its
    task; an expired approval resumes with the tool not run (FIX-1846). A person's stop ends the
    turn `aborted` and cancels the asked task; a cancel that fails is owed and paid on the next
    board touch (FIX-1844).
19. **Assigned work keeps its session.** An answered question re-enters the task's own session,
    and a question waits without limit. A finished task never changes: a reply is a turn in its
    session, more work a follow-up row (`followUpOf`) in that session, same worker; nothing
    reopens (FIX-1817
    [D2](https://github.com/fixpoint-labs/flow-state-dev/blob/main/specs/issues/FIX-1817/DECISIONS.md)).
    *Amended by Jake, 2026-10-13, on FIX-1764:* FIX-1765 declined that answer. A person's message
    on a finished task, completed, errored or canceled, resumes the task's session and puts the task
    back in progress; no note-only reply and no follow-up row. FIX-1765 closed into FIX-1764 the
    same day, and FIX-1981 moved the `task-session-stays-open` goal to match.
20. **No new answer-once fence.** Tasks ride the board row's claim ticket, posts FIX-1791's
    delivery-ledger token. FIX-1818 was canceled into that rule.
21. **Skill sub-agents are gone** (FIX-1814). A skill's private team is FIX-1819's question, in
    Backlog here, unparented.
22. **A closure's control passes only on an exact red set**: it fails at the signal its plan
    names, and only that group; anything else is a finding (FIX-1820 QR-12). It binds FIX-1797
    and every later closure here.

### Settled by FIX-1903, recorded at its wrap on 2026-10-14

Each binds a sibling that changes the dev Lab, runs coding work, or gives a worker a tool from
outside FSD. Sources: FIX-1903's retained
[spec](https://github.com/fixpoint-labs/flow-state-dev/tree/main/specs/epics/FIX-1903), amended
by [#3179](https://github.com/fixpoint-labs/flow-state-dev/pull/3179), and its children's,
FIX-1904, FIX-1905 and FIX-1906.

23. **`pnpm shift-manager:dev` opens the `fsd` profile by default, and `fsd` is not DevTeam.** It
    opens FSD and Shift Manager on this repository with its own store, its own documents (the
    brief) and its own skills (the commit style); DevTeam keeps its demo projects, brief and skills
    for the goal checks that read them, served with `--config`
    (FIX-1903 [D2](https://github.com/fixpoint-labs/flow-state-dev/blob/main/specs/epics/FIX-1903/DECISIONS.md#d2), FIX-1904
    [D2](https://github.com/fixpoint-labs/flow-state-dev/blob/main/specs/issues/FIX-1904/DECISIONS.md#d2), FIX-1971). An epic changes one profile's set
    without editing the other's.
24. **A coding run works in a worktree cut from the user's own checkout.** The project row keeps
    naming a remote; the host config maps that remote to a checkout, bound to the shared projects
    it names and never resolved from a row's remote alone
    (FIX-1903 [D3](https://github.com/fixpoint-labs/flow-state-dev/blob/main/specs/epics/FIX-1903/DECISIONS.md#d3), FIX-1906
    [D1](https://github.com/fixpoint-labs/flow-state-dev/blob/main/specs/issues/FIX-1906/DECISIONS.md#d1)). It binds FIX-1763's open children, a sandbox
    (FIX-1767) and push and PR (FIX-1768), which add to this mapping and do not replace it.
25. **FSD holds a project's MCP connection, and each user sets their own key.** The key is set on
    the Settings page; there are no admins. A row names a host-approved server only. Claude Code
    receives the tools through `mcpTools` and never the key
    (FIX-1903 [D4](https://github.com/fixpoint-labs/flow-state-dev/blob/main/specs/epics/FIX-1903/DECISIONS.md#d4) and its post-merge calls; FIX-1905
    [D2](https://github.com/fixpoint-labs/flow-state-dev/blob/main/specs/issues/FIX-1905/DECISIONS.md#d2) and [D4](https://github.com/fixpoint-labs/flow-state-dev/blob/main/specs/issues/FIX-1905/DECISIONS.md#d4)).
    Cursor and Codex get project servers later, on this path
    ([D3](https://github.com/fixpoint-labs/flow-state-dev/blob/main/specs/issues/FIX-1905/DECISIONS.md#d3)).

### Settled by FIX-2152, recorded at its wrap on 2026-10-31

The labs are Workforce apps beside Shift Manager, so what they settled binds any sibling that
hires workers, runs coding work, or names the coordinator. Sources: FIX-2152's retained
[spec](https://github.com/fixpoint-labs/flow-state-dev/tree/main/specs/epics/FIX-2152) and its
children's, as merged to `main`. Its closure, FIX-2156, ran on 07753056: all six lab goals pass
and every control fails ([#4278](https://github.com/fixpoint-labs/flow-state-dev/pull/4278)).

26. **Projects are not required to run work.** Jake, 2026-10-29 (FIX-2335): the Teammates lab has
    no projects. Every run works in one folder the operator names at start, `TEAMMATES_WORKDIR`,
    on the existing constant run source; unset or missing, the lab fails at start and never falls
    back to the current directory or its own checkout, and no model sees or names a path. This
    amends FIX-2152 [ER-8](https://github.com/fixpoint-labs/flow-state-dev/blob/main/specs/epics/FIX-2152/DECISIONS.md#who-owns-what)
    and FIX-2154 [D3](https://github.com/fixpoint-labs/flow-state-dev/blob/main/specs/issues/FIX-2154/DECISIONS.md)
    **for that lab only**. Shift Manager and every other lab still run in a project's checkout
    (24), and Workforce stays project-agnostic, with no no-projects mode in the package. A sibling
    that wants projectless runs does it in its host, as this lab did.
27. **A coding run is a background task, not a teammate** (FIX-2332, amending FIX-2154 D4). The
    coding worker stays on the roster but off the list of people you talk to. Each coding task
    shows as a background item and as a card in the conversation that started it, both opening
    to the run read only, and its result lands as the task's. A person never types to a harness.
    It binds FIX-1652's harness visibility and FIX-1763: a harness run is reached through its task.
28. **The Teammates lab's coordinator is Chief of Staff** (FIX-2336), `chief-of-staff`, and it acts
    rather than offering: it asks a teammate when asked about one and hands work to whoever fits.
    The name is the lab's. Shift Manager's coordinator is still the Shift Coordinator (FIX-1775),
    and FIX-1650's CoS default is the same role; an epic that renames either records it here.
29. **A worker knows who it is, and work for a delegate goes as a task** (FIX-2334, then #4262).
    Workforce's default prompt layer, read from the roster each request, gives a worker its name,
    team and description, and the teammates it can reach. Since #4262 it marks each messageable
    delegate whose flow takes tasks, with a line that work for a delegate goes as a task, not as a
    message. The closure's first run found a main worker messaging work instead (0 of 6 filed),
    and #4262 is the fix. An app adds no prompt text to say any of this
    ([default worker flow](https://github.com/fixpoint-labs/flow-state-dev/blob/main/docs/architecture/workforce-default-worker-flow.md)).
30. **The Teammates lab's default coding harness is Cursor** (FIX-2342, #4226). A coding worker
    whose file names no harness runs on Cursor; Claude Code and Codex stay one `harness:` line
    away. Lab-scoped: the dev Lab's Claude Code runs (25) don't change.
31. **An agent flow never reads an app's settings to change how it behaves** (FIX-2341). The
    built-in `agent` flow takes an app's own settings, such as a worker's icon or color, through
    `defineAgentWorkerFlow({ settings })`, for the app to read. The flow never looks at them, so
    they can't change how a worker runs; a setting that should is one of the flow's own.

## Open

### What FIX-1786 would change. These are tensions, not decisions

FIX-1786 (approved Oct 6) carries the owner's PRD. T1 was answered on Oct 6 (item 12); T2 to T5
stay open as written. Until the owner answers each, **every item above stands** and siblings
build to it.

| | In force today | FIX-1786 proposes | Binds |
|---|---|---|---|
| **T2** | Project-room seams (11, PR-2) | Rooms removed | FIX-1649's seam list, FIX-1650 |
| **T3** | Workstream = channel plus flow; its board is the channel's (7, 13) | One owner; a project entry plus the lead's session board. *Still open in FIX-1786* | FIX-1650, FIX-1651 |
| **T4** | Org-visible hires; a `chief-of-staff` seat (15) | Private worker resources; *seat* retired; CoS a standard coordinator | FIX-1650, FIX-1775 |
| **T5** | FIX-1320 INST-5, hires as collection kinds (another project) | Flow instances and owner pins deprecated | FIX-1320 |

### Ask 2 · Does FIX-1786 belong here or in Workforce: Layer 2 Abstraction? Owner

**Plain terms.** Item 2 says this project is not Layer 2 vocabulary. FIX-1786, filed here, retires
*seat*, *kind*, *mailbox* and *room*, while Layer 2 Abstraction's PD-6 still calls *seat* and *kind*
settled. **Trade-off.** If it stays, item 2 and *what this project is not* are rewritten. If it
moves, the vocabulary's owner sees the change and this project keeps T2 to T4.
**Recommendation: move it, or at least relate it there**, so two projects do not answer *what is a
seat* differently. **What would change my mind:** you mean Shift Manager to drive the Workforce
model now. Layer 2 Abstraction is eight of nine done. Then item 2 changes, and that is an outcome
change. **Cost of being wrong:** low. It is one Linear field, plus a stale answer meanwhile.
