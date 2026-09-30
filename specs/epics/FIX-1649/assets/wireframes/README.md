# App Lab wireframes · for the Claude Design hand-off

> **Superseded as structure by the [Claude Design hand-back v1](../design/v1/README.md)
> (2026-09-30).** Where the two differ, the hand-back wins; [`../design/DESIGN.md`](../design/DESIGN.md)
> shows each wireframe beside the screen that replaced it. These stay as the history of what went
> to Claude Design. The rail, the run inspector and the five fixed destinations below no longer
> describe the shell.

Five low-fidelity screens of the App Lab shell ([FIX-1649](../../SPEC.md)). They fix
structure: regions, what each section holds, the states each must show, and who owns what
each surface means. They are not a visual design. Take them to Claude Design as they are;
what comes back sets the look.

| Screen | Shows |
|---|---|
| [01 · the shell](01-shell.svg) | Rail, sidebar, centre and run inspector at desktop width, with one channel open |
| [02 · the sidebar](02-sidebar.svg) | NEEDS YOU, CHANNELS, ON SHIFT, when busy, when quiet, and when a read failed |
| [03 · the centre](03-centre.svg) | The four surfaces on one channel: stream, board, brief, results |
| [04 · the run inspector](04-inspector.svg) | Nothing selected, running, waiting on you, finished |
| [05 · the destinations](05-destinations.svg) | Projects, workstreams, chat, attention, resources: what each opens today, and which sibling epic gives it meaning |

## Fixed, and open to the design

| Fixed by the epic | Claude Design's to decide |
|---|---|
| Four regions: nav rail, sidebar, centre, run inspector | Placement, proportions, breakpoints, whether the rail and sidebar merge |
| Five destinations, each one click from anywhere | How the destinations are drawn (icons, words, both) |
| Sidebar sections in order: NEEDS YOU, CHANNELS, ON SHIFT | Density, type scale, how a row reads |
| Four centre surfaces as tabs on the open channel | Tab treatment, empty and loading looks |
| The inspector summarises one run and links the full trace | Its collapsed form |
| Every state shown here: empty, failed with retry, waiting on you | How each state looks |

**Theme, from the ticket and nothing more:** brutalist, a beige ground, black ink and rules,
a yellow accent. Ochre on the wireframes marks where the accent applies: the active
destination and tab, a count that needs you, a running state, the primary action. The layout
is adjacent to Paperclip and Grok Bot (sidebar, centre, inspector) and must not become a
copy of either.

## What comes back, and where it goes

The refined design sets the App Lab theme's values and the shell's final layout. Who takes
what from it, and what waits for it, is in
[the plan](../../PLAN.md#the-design-hand-back-is-an-input-not-a-child).
