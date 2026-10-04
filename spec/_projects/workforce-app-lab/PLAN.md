# Plan — Workforce: Shift Manager

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan**

Sequencing, not building. What order the epics run in, what each hands the next, and what is
deliberately not next. Each epic's own plan owns its checks.

![The arc](figures/arc.svg)

Day six. The shell's bar is closed: spec from the evening of Sep 29, approval at 01:33 UTC on
Sep 30, closure merged at 10:56 UTC on Oct 4. Linear still shows it Spec Approved; the status
writes are pending with Jake, and the bar follows the merged PRs. Org primitives has run since its
approval on Oct 1 and is the one bar crossing the now line. Three lanes stay empty, which is the
plan, not a gap.

## What each epic consumes and releases

| Epic | Consumes | Releases |
|---|---|---|
| **lab shell** · FIX-1649 | Workforce as shipped; reused FSD components | Shift Manager, one app that opens any Lab's tree: the sidebar, Inbox and Tasks, the project, workstream and task levels, and the design system, with a named empty state wherever a sibling's meaning hasn't shipped. The skinning example every later surface follows |
| **org primitives** · FIX-1650 | The shell to render in | Project and workstream, with CoS and Ops defaults, for one user |
| **eng workstream kit** · FIX-1651 | A workstream from FIX-1650 | Linear sync, a per-issue board, and the EM, Lead and specialist seats |
| **attention & inspect** · FIX-1652 | The shell's Inbox, and the task inspector's inspect depth. Resources has no place in the shell's v1 and is reached from Jump to until its design pass 2 | Needs-you, harness visibility, the resources list |
| **review & GitHub wake** · FIX-1653 | FIX-1637's wake spine | Review and GitHub events that wake the right seat |

## What is deliberately not next

- **FIX-1651 to FIX-1653** until the Cycle PM stamps a proof gap.
- **Anything in Cycle 1.** This project is a Cycle 2 candidate.
- **A second Lab's shell.** CyberForce arrives on this one.
