# Claude Design hand-back · v2 (final)

**The final hand-back.** Design pass 2, from Jake, 2026-10-01. It is the source for Shift
Manager's final visual values ([ER-9](../../../BUSINESS-RULES.md#how-the-set-is-run)): the day
and night themes in `labs/design-system/shift-manager.css` are taken from it. It supersedes
[v1](../v1/README.md) as the look. It does **not** on its own move the structure v1 fixed: see
[Where v2's structure differs](#where-v2s-structure-differs-from-v1).

| File | What it is |
|---|---|
| [`shift-manager-v2.dc.html`](shift-manager-v2.dc.html) | The export as handed back, unedited (sha256 `c5270ef8…2136270`) |

**No screenshots.** The export is a Claude Design component: its markup is a template
(`{{ … }}` bindings, `sc-if` and `sc-for` blocks) that a runtime, `./support.js`, renders. That
file was not handed back. Opened in Chromium without it, the page shows the raw template, so
there is nothing faithful to capture. Read the file for the screens, tokens and states; open it
in Claude Design to see it drawn.

## What it draws

Seven screens in one app, a day and a night theme, and a "streamlined" density switch:

| Screen | What it shows |
|---|---|
| Chief of Staff | **New.** The default screen: a conversation with a chief-of-staff worker who briefs you on what needs you, lets you answer asks inline, and routes requests to workers. Right rail: every stream's live and needs-you counts, and who is on call |
| Workstream | `#payments-api`'s Stream, as v1, with the right panel: epic progress, workers on this stream (status, slots used, what each holds), tasks by state with a show/hide DONE group, filter by worker |
| Task session | PAY-14's session: brief, narration, tool calls, inline diff, your messages, the ask card. Header: Interrupt/Resume, Hand off, Open `#stream`. Right panel: worker and reassign (hand off to a teammate with a free slot), harness, started, time, cost, acceptance, harness plan, files, linked |
| Project board | checkout-v2: team strip, one swimlane per workstream, columns QUEUED · RUNNING · IN REVIEW · NEEDS YOU · DONE (done as one-line rows) |
| Inbox | The list with All · Approvals · Questions, the detail pane (approval with SQL, question with options), what waiting costs, From the session, reply composer, **Resolved today** with undo, and an empty state |
| Tasks | Every task in flight, grouped by **State, Worker or Stream**, queued shown or hidden |
| Roster | **New.** Every worker by status (on shift · on call · off shift), its slots, the tasks it holds, and what it is on call for (webhooks, routines, waits on you); filter by team |

Sidebar: Chief of Staff, Inbox, Tasks, Roster; PROJECTS with workstreams; TEAMS with one
status square per member; on-shift and on-call counts; a **Day shift / Night shift** switch that
is the theme switch.

## The pass-2 open list, item by item

From [`DECISIONS.md` → Open for design pass 2](../../../DECISIONS.md#design-pass-2).

| Open item | Does v2 draw it? |
|---|---|
| Where resources live | **No.** No resources anywhere; Jump to finds streams, projects, workers and tasks only |
| The light variant | **Yes.** Day (`:root`): beige paper, black ink, the yellow highlighter. Night is the dark one |
| TEAMS with workers below each team | **No, not as asked.** Each team row shows one status square per member and opens Roster filtered to that team, which lists the workers. It answers the correction with a screen, not a list under the team |
| Tabs not drawn (workstream Board/Brief/Results; project Stream/Workstreams/Brief; task Diff/Checks/Brief) | **No.** v2 removes tabs instead: a workstream has Stream and a Board link to its project's board; the task screen has none (brief and diffs sit inside the session); the project board has none |
| Empty, loading and failed states | **Empty only, and only some:** Inbox with nothing waiting, Jump to with no match, Chief of Staff with nothing needing you, a worker with nothing assigned, a queued task not started. No loading state, no failed state, no Retry |
| The right panel at a project | **Yes:** none. The board keeps the full width, with a team strip across the top |
| Narrow screens | **Partly.** The right panel drops below 1180px wide; the app holds a 900px minimum. Nothing collapses below that |
| Tasks grouped by Worker or Stream | **Yes.** Worker groups show the worker's status and slots |
| Finished tasks in Tasks | **Yes:** they stay out. Tasks is in-flight only; done tasks are on the board's DONE column and the workstream panel's DONE group |
| Inbox with nothing waiting; Tasks with nothing running | **Inbox yes** ("Nothing needs you. N sessions are still running and M workers are on call."). **Tasks no** |

## The two rules

v2 keeps both. The yellow highlighter (`--hl`) is used only where a person must act: the Inbox
count, NEEDS YOU tags, needs-you dots and the waiting ask. Nothing has a rounded corner.

## Where v2's structure differs from v1

[ER-10](../../../BUSINESS-RULES.md#how-the-set-is-run) makes moving a level, a sidebar section,
a tab or the right panel's content an epic amendment, not a child's call. v2 does all four:

- two new destinations, **Chief of Staff** (the default screen) and **Roster**;
- **TEAMS** as status squares opening Roster, not workers listed below each team;
- **tabs removed** at the workstream (Brief, Results), the task (Diff, Checks, Brief) and the
  project (Stream, Workstreams, Brief);
- the task header's **Open PR** gives way to **Open `#stream`**, and the workstream loses
  **Pause stream**; the project loses **+ Team** and **+ Workstream**.

The [v2 amendment](../../../EVOLUTION.md#amendment--2026-10-01--design-v2s-structure) adopts the
first two. The removed tabs and dropped actions do not join, so those keep v1's structure.
