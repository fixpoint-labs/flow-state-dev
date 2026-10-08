# Plan — Workforce: Shift Manager

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan**

Sequencing, not building. What order the epics run in, what each hands the next, and what is
deliberately not next. Each epic's own plan owns its checks.

![The arc](figures/arc.svg)

Day ten. The shell's bar closed at its closure merge on Oct 4, and Linear marked it Done
that afternoon. Org primitives runs to the now line: its closure merged Oct 6, and the bar closes
when the epic wraps. FIX-1786's bar runs from its Oct 6 approval to the now line. Hand-offs,
FIX-1815, was filed today as FIX-1786's follow-up; its tick sits just behind the now line, with no
bar until its objective is approved. Three lanes opened Oct 4 with a tick and no bar, none with an
approved objective. FIX-1763's children are building anyway, and its repository floor has merged.
That is the gap to watch. Three lanes stay empty by plan.

## What each epic consumes and releases

| Epic | Consumes | Releases |
|---|---|---|
| **lab shell** · FIX-1649 | Workforce as shipped; reused FSD components | Shift Manager, one app that opens any Lab's tree: the sidebar, Inbox and Tasks, the project, workstream and task levels, and the design system, with a named empty state wherever a sibling's meaning hasn't shipped. The skinning example every later surface follows |
| **org primitives** · FIX-1650 | The shell to render in | Project and workstream, with CoS and Ops defaults, for one user |
| **eng workstream kit** · FIX-1651 | A workstream from FIX-1650 | Linear sync, a per-issue board, and the EM, Lead and specialist seats |
| **attention & inspect** · FIX-1652 | The shell's Inbox, and the task inspector's inspect depth. Resources has no place in the shell's v1 and is reached from Jump to until its design pass 2 | Needs-you, harness visibility, the resources list |
| **review & GitHub wake** · FIX-1653 | FIX-1637's wake spine | Review and GitHub events that wake the right seat |
| **coding tasks** · FIX-1763 | FIX-1650's org-level projects (FIX-1718); the harness manager | A project's optional repository and a harness worktree mapped from it. Then a run's work survives losing its machine, a sandbox, and push and PR. **Holds FIX-1651 to FIX-1653** until the repo floor is real |
| **talk on a finished task** · FIX-1765 | The shell's task view; the existing needs-you signal | A message on a finished task that stays on it and reaches whoever acts next. No second inbox |
| **memory & context** · FIX-1775 | The shipped memory pack; the Shift Coordinator from FIX-1650 | Standard memory on the coordinator, then a long session kept inside its window. Takes long-lived session memory from FIX-1786 |
| **private & shared** · FIX-1786 | Everything in flight in Workforce, boards, engine scopes and Shift Manager, inventoried first (FIX-1787); FIX-1778's named assignment | Workers as private resources, coordinators in place of mailboxes and rooms, one-owner workstreams, and the retired terms gone from code and docs. **Releases nothing until its gate** ([Decisions](DECISIONS.md) → Open) |
| **hand-offs** · FIX-1815 | FIX-1786's assigned-task path, whose reply still ends the task (FIX-1794 BR-25); a feasibility spike that found ask viable as park-and-resume | Ask, a hand-off that waits for one answer and continues; assign, a job on the board whose session stays open until done; one answer-once fence under both |

## What is deliberately not next

- **FIX-1651 to FIX-1653** until the Cycle PM stamps a proof gap, and until FIX-1763's repo floor
  (FIX-1762) is real.
- **FIX-1786's refactor itself.** Its inventory comes first; most active work merges before it starts.
- **Anything in Cycle 1.** This project is a Cycle 2 candidate.
- **A second Lab's shell.** CyberForce arrives on this one.
