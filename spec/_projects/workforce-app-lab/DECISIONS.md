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
   (P-FIX-40); an epic here that needs a new noun files it there.
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
   description; FIX-1649's who-owns-what table was amended on Sep 30 to match.

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
    [PR-2](BUSINESS-RULES.md).
12. **Projects are org-wide channels and usually cross-team** (Jake). A project belongs to the
    organization and names no team; one whose workstreams all sit in one team is allowed but is
    never the default ([FIX-1718 BR-2a](https://github.com/fixpoint-labs/flow-state-dev/blob/main/specs/issues/FIX-1718/BUSINESS-RULES.md)).
13. **A workstream's board is the one its channel declares.** Only `boards:` on a channel attaches
    one; a board declared in a kind's code is not a workstream's board. The five-column Board is
    Shift Manager's mapping of shipped task statuses, which FIX-1651 may replace; IN REVIEW holds
    nothing until FIX-1651 ships a review state.
14. **A worker's shift status has one rule.** On shift, on call and off shift are derived in
    Shift Manager from board rows and pending asks (FIX-1723), with no field in Workforce; a
    sibling that shows a worker's status uses that rule.
15. **The CoS seat's screen is called Shift Coordinator in Shift Manager only** (Jake, FIX-1747).
    The `chief-of-staff` seat and its persona keep their name everywhere else, FIX-1650's
    included.

## Open

None.
