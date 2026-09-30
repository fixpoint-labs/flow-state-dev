# Decisions — Workforce App Lab

[Spec](SPEC.md) · **Decisions** · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md)

Calls that bind more than one epic under this project. A call one epic owns lives in that epic's
spec. No `PD` card yet: nothing has been decided here that a second epic would otherwise re-decide
beyond what the owner already settled below.

## Decided once

Settled by the owner on 2026-09-29, recorded so no epic reopens them. Sources: the project's
original Linear description ([absorbed](absorbed/linear-content.md)) and the FIX-1649 brief.

1. **The shell owns how a surface is reached and how it looks; the sibling epic owns what it
   means.** Projects and workstreams are FIX-1650 and FIX-1651, attention and resources FIX-1652,
   review wake FIX-1653. The shell never re-implements their product work; until a sibling ships,
   its surface shows a named empty state. Surface by surface, the split is FIX-1649's approved
   [who-owns-what table](https://github.com/fixpoint-labs/flow-state-dev/blob/main/specs/epics/FIX-1649/DECISIONS.md#who-owns-what);
   which sibling owns what a *workstream* means is open below.
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

## Open

### Who defines what a workstream is: org primitives, or the eng kit?

**Plain terms.** Two places disagree. Org primitives (FIX-1650) is filed as owning "workstream as
channel plus flow", and this set's epics table says the same. The shell's approved spec gives
"workstreams, tasks, a board row" to the eng kit (FIX-1651). Whichever owns it decides what a
workstream is when someone first opens one in the Lab, and the other builds on that.

**The trade-off.** FIX-1650 owning it keeps the workstream an org-level thing any Lab has, with
FIX-1651 filling it with engineering work. FIX-1651 owning it ties workstreams to the eng kit,
which is held, so a CyberForce workstream would wait on an engineering epic.

**My recommendation.** Split on the line both texts already draw: FIX-1650 owns the workstream
itself (the channel, its flow, that it exists); FIX-1651 owns what sits on its board (tasks, rows,
brief, results, task states). The shell's table then needs one row split, by amendment.

**What would change my mind.** FIX-1650 deciding, when it is specced, that it ships no workstream
of its own and only projects.

**What being wrong costs.** Small and reversible now: both epics are unstarted. It grows once
FIX-1662 names an empty state after the wrong epic and one of them specs a workstream the other
also builds.
