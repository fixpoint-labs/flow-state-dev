# Plan — Workforce: Shift Manager

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan**

Sequencing, not building. What order the epics run in, what each hands the next, and what is
deliberately not next. Each epic's own plan owns its checks.

![The arc](figures/arc.svg)

Day thirty-three. Five bars are closed: the shell's at its closure merge on Oct 4, hand-offs'
(FIX-1815) at its Oct 11 wrap, the dev Lab's (FIX-1903) at its Oct 14 wrap, FIX-1786's at Linear
Done on Oct 23, and the labs' (FIX-2152) at its closure merge on Oct 31, eight days after approval.
FIX-1786's wrap reached this spec on Oct 31, a week after its bar closed. Org primitives runs to the
now line: its closure merged Oct 6, and the bar closes when the epic wraps. FIX-1765's lane ends in
a cross on Oct 13, canceled into FIX-1764. Memory's (FIX-1775) ends in a done mark on Oct 9 with no
bar, and its long-session half was never filed. Coding tasks (FIX-1763), gaps between epics
(FIX-2273) and Workforce over MCP (FIX-2331) carry filing ticks and no approved objective. Three
lanes stay empty by plan.

## What each epic consumes and releases

| Epic | Consumes | Releases |
|---|---|---|
| **lab shell** · FIX-1649 | Workforce as shipped; reused FSD components | Shift Manager, one app that opens any Lab's tree: the sidebar, Inbox and Tasks, the project, workstream and task levels, and the design system, with a named empty state wherever a sibling's meaning hasn't shipped. The skinning example every later surface follows |
| **org primitives** · FIX-1650 | The shell to render in | Project and workstream, with CoS and Ops defaults, for one user |
| **eng workstream kit** · FIX-1651 | A workstream from FIX-1650 | Linear sync, a per-issue board, and the EM, Lead and specialist seats |
| **attention & inspect** · FIX-1652 | The shell's Inbox, and the task inspector's inspect depth. Resources has no place in the shell's v1 and is reached from Jump to until its design pass 2 | Needs-you, harness visibility, the resources list |
| **review & GitHub wake** · FIX-1653 | FIX-1637's wake spine | Review and GitHub events that wake the right seat |
| **coding tasks** · FIX-1763 | FIX-1650's projects (FIX-1718), private or shared since FIX-1786's Q2; the harness manager | A project's optional repository and a harness worktree mapped from it. Then a run's work survives losing its machine, a sandbox, and push and PR. **Holds FIX-1651 to FIX-1653** until the repo floor is real |
| **talk on a finished task** · FIX-1765 | Canceled Oct 13, an epic of one issue | Nothing of its own. FIX-1764 shipped its outcome: a person's message reopens a finished task ([Decisions](DECISIONS.md), 19) |
| **memory & context** · FIX-1775 | The shipped memory pack; the Shift Coordinator from FIX-1650 | Standard memory on the coordinator, which shipped (FIX-1776). The long session kept inside its window was never filed, though Linear reads the epic Done. Takes long-lived session memory from FIX-1786 |
| **private & shared** · FIX-1786 | Everything in flight in Workforce, boards, engine scopes and Shift Manager, inventoried first (FIX-1787); FIX-1778's named assignment | Workers as private resources, coordinators in place of mailboxes and rooms, one-owner workstreams, and the retired terms gone from code and docs. Released Oct 23: private or shared projects (Q2), one-owner workstreams, the task tools by delegate. What siblings inherit is [Decisions](DECISIONS.md) 32 to 37 |
| **hand-offs** · FIX-1815 | FIX-1786's assigned-task path, whose reply still ends the task (FIX-1794 BR-25); a feasibility spike that found ask viable as park-and-resume Released Oct 11: ask, `addTask` with `waitForResponse`, which parks and resumes with one answer; assign, whose session stays open through a question and after it finishes, with follow-ups in that session. Both on the board's existing answer-once checks; skill sub-agents removed. What siblings inherit is [Decisions](DECISIONS.md) 16 to 22 |
| **dev Lab** · FIX-1903 | FIX-1763's repository floor (FIX-1762: a project's one remote, a worktree mapped from it); FIX-1650's shared projects; DevTeam's tree, unedited | The `fsd` profile as the default dev Lab: FSD and Shift Manager on this repository, worktrees cut from the user's checkout through a host-config mapping, and a project's MCP servers, Linear first, given to Claude Code runs as tools with each user's own key. What siblings inherit is [Decisions](DECISIONS.md) 23 to 25 |
| **same pieces, different apps** · FIX-2152 | Workforce's one task primitive (FIX-2056) and worker messaging (FIX-1989), outside this project; the design system and the `packages/ui` registry | Two labs under `labs/`, a Claude Code-style app (session and threads modes) and a Grok Bot-style Teammates app, each with an inventory of what it adds. Into Workforce: a person's sessions of one worker, a public take of a settled notice for the running turn, and the default prompt layer that tells a worker who it is. What siblings inherit is [Decisions](DECISIONS.md) 26 to 31 |

## What is deliberately not next

- **FIX-1651 to FIX-1653** until the Cycle PM stamps a proof gap, and until FIX-1763's repo floor
  (FIX-1762) is real.
- **The hand-off corners FIX-1815 left behind.** FIX-1843, FIX-1850, FIX-1851, FIX-1860, FIX-1861,
  FIX-1862, FIX-1864 and FIX-1865, in Backlog here, unparented: they left the epic at its closure (FIX-1820's Q1). FIX-1851 waits
  on FIX-1786's FIX-1802 P2; FIX-1850 is about approvals.
- **What FIX-1903 left behind.** FIX-1934, in Backlog here, unparented: a host restart re-pins a
  local checkout's fetch settings from config a run could have rewritten. FIX-1955 (the engine's
  debug routes showed a user's stored MCP key) and FIX-1969 (the EM guessed a project on the coder's
  task, so the run was refused) left with it and are already Done, FIX-1969 under FIX-1786. Two rows
  only Jake's machine can run: FIX-1904's V1 row, a Claude Code run signed in through a claude.ai
  subscription (OAuth), and a confirming run of goal leg c.
- **What FIX-2152 left behind.** FIX-2359 (the Claude Code-style lab's finished-task panel) in
  review; FIX-2349 and FIX-2350 (a Teammates coding task shown failed while running, and started
  twice), FIX-2340 (one session overlay for both labs), FIX-2323 (a crashed run's tokens) and
  FIX-2167 (coordinator sessions in `listWorkerSessions`) in Backlog, still its children. Owed on
  Jake's machine: browser checks at 1440 and 1920 wide (FIX-2337), and real-model runs of both labs
  on the Cursor default harness.
- **A skill's private team** (FIX-1819), Backlog until someone needs one now that ask has shipped.
- **Anything in Cycle 1.** This project is a Cycle 2 candidate.
- **A second Lab's shell.** CyberForce arrives on this one.
