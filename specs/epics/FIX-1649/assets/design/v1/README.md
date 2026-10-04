# Claude Design hand-back · v1

> **Superseded as the look by [v2](../v2/README.md)**, the final hand-back (design pass 2,
> 2026-10-01). v1's structure stands except where the
> [v2 amendment](../../../EVOLUTION.md#amendment--2026-10-01--design-v2s-structure) changed it
> (Chief of Staff, Roster, TEAMS as status squares); kept as history.

Five dark-theme screens of App Lab, handed back from Claude Design by Jake on 2026-09-30:
01 to 03 first, then 04 and 05 ("Latest designs, show Inbox and Tasks sections").
They replace the [wireframes](../../wireframes/README.md) as the structure
[FIX-1649](../../../SPEC.md) fixes; the wireframes stay as history. How each screen works,
beside the wireframe it grew from, is in [`../DESIGN.md`](../DESIGN.md).

| Screen | Shows |
|---|---|
| [01 · workstream stream](01-workstream-stream.png) | Workstream `#payments-api`, Stream tab, with the workstream's right panel |
| [02 · task session](02-task-session.png) | Task PAY-14, Session tab, with the task inspector |
| [03 · project board](03-project-board.png) | Project checkout-v2, Board tab |
| [04 · tasks](04-tasks.png) | Tasks: every task across all streams, grouped by state; the sidebar with Inbox and Tasks |
| [05 · inbox](05-inbox.png) | Inbox: the list of what waits on you, and the selected approval's detail pane |

**Jake's correction, with the hand-back:** "I think this is a closer match for the most part.
Some things are off, like teams doesn't show workers below them." Under TEAMS, each team lists
its workers below it (seat, harness, status); the team row is not just status squares. The
spec is written on the corrected sidebar; the screens still show the uncorrected one. In 04 and
05, Inbox and Tasks sit under Jump to and replace the NEEDS YOU section of 01 to 03.

**Not final visuals.** These are the dark variant, and the next design pass had open items
([`DECISIONS.md` → Design pass 2](../../../DECISIONS.md#design-pass-2)). The final values came
with [v2](../v2/README.md) ([ER-9](../../../BUSINESS-RULES.md#how-the-set-is-run)).
