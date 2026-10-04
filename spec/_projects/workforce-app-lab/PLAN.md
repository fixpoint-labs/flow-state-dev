# Plan — Workforce App Lab

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan**

Sequencing, not building. What order the epics run in, what each hands the next, and what is
deliberately not next. Each epic's own plan owns its checks.

![The arc](figures/arc.svg)

Day two. The shell's epic spec ran from the evening of Sep 29 to approval at 01:33 UTC on Sep 30,
and its four children start their specs now. It is still the only bar; four lanes are open and
empty, which is the plan, not a gap.

## What each epic consumes and releases

| Epic | Consumes | Releases |
|---|---|---|
| **lab shell** · FIX-1649 | Workforce as shipped; reused FSD components | App Lab, one app that opens any Lab's tree: the sidebar, Inbox and Tasks, the project, workstream and task levels, and the design system, with a named empty state wherever a sibling's meaning hasn't shipped. The skinning example every later surface follows |
| **org primitives** · FIX-1650 | The shell to render in | Project and workstream, with CoS and Ops defaults, for one user |
| **eng workstream kit** · FIX-1651 | A workstream from FIX-1650 | Linear sync, a per-issue board, and the EM, Lead and specialist seats |
| **attention & inspect** · FIX-1652 | The shell's Inbox, and the task inspector's inspect depth. Resources has no place in the shell's v1 and is reached from Jump to until its design pass 2 | Needs-you, harness visibility, the resources list |
| **review & GitHub wake** · FIX-1653 | FIX-1637's wake spine | Review and GitHub events that wake the right seat |

## What is deliberately not next

- **FIX-1651 to FIX-1653** until the Cycle PM stamps a proof gap.
- **Anything in Cycle 1.** This project is a Cycle 2 candidate.
- **A second Lab's shell.** CyberForce arrives on this one.
