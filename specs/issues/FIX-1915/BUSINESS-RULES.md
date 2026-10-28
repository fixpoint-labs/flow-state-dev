# FIX-1915 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The cases, written as rules. *Proved by* names the kind of check; the plan maps each to one.
"CI" means a check with a scripted Claude Code, through the block's own test seam. "Goal" means
the goal check, on real Claude Code in a real browser.

## Starting and continuing a conversation

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | The first turn of a new session runs | Claude Code starts a conversation, and its id is recorded the moment Claude Code names it, before the turn ends | CI · goal **c** |
| BR-2 | A later turn runs | It asks to continue the recorded conversation, and Claude Code confirms the same id | CI · goal **c** |
| BR-3 | The harness reports it doesn't know the recorded conversation: the run fails with the harness package's unknown-conversation classification (PLAN S13) | The session says Claude Code did not continue conversation *X*, with the run's error. The recorded id stays, and the next turn asks for *X* again ([D2](DECISIONS.md#d2)). Any other failure before an id is confirmed *in that turn* is an error, not a refusal: the turn shows its error, the recorded id stays, and the next turn tries again. A turn that confirmed *X* and then failed shows its error too. The shared flow reads only the classification, never a harness's message | CI, all three paths |
| BR-4 | Claude Code confirms a different id than the turn asked for | The recorded id moves to the new one, and the session says Claude Code started a new conversation | CI |
| BR-5 | A turn is sent while another is running | It waits, then continues the same conversation | CI |
| BR-6 | The page is reloaded, or the server restarts on a durable store | The same session holds the same id, and the next turn continues it | Goal **r** |
| BR-7 | Anything the caller sends, the prompt included | Never chooses the conversation, the repository or the worktree. All come from the server | CI |

## While it works

| # | When | Then | Proved by |
|---|---|---|---|
| BR-8 | A run is in progress | Its steps show before the turn completes, every one written by Claude Code's emitter. Kitchen Sink writes no item of its own | CI · goal **l** |
| BR-9 | The person stops a turn | The run is cancelled, the turn shows as stopped, never as refused, even when it stopped before Claude Code confirmed an id. The recorded id stays, and the next turn continues the conversation | CI, stopped before and after the confirmation · goal **s** |
| BR-10 | A host's sign-in lapses after the mode opened | That turn fails with Claude Code's own error, shown as that turn's error. The recorded id stays | CI, with a scripted error |

## Where it works

| # | When | Then | Proved by |
|---|---|---|---|
| BR-11 | Any turn of a session runs | It works in that session's own git worktree of the repository, on branch `kitchen-sink/<flow kind>/<session>`, the same one every turn and after a restart. The first turn cuts it from the checkout's `HEAD`; nothing is fetched. Two sessions never share one ([D1](DECISIONS.md#d1)) | CI · goal **w** |
| BR-12 | A session or tenant id holds characters a path or a branch name can't | It still maps to one worktree and one branch inside the root, distinct from every other id | CI |
| BR-13 | The run tries to write outside its worktree: the main checkout, another session's worktree, or the repository's `.git` | The sandbox refuses it. So the run can edit files but not commit; its work waits, uncommitted, in the worktree for the person | The Claude Code package's own tests · goal **w** |
| BR-13a | A session goes idle, is deleted, or the server restarts | Its worktree and branch stay, untouched, until the host clears them. Nothing is merged, pushed or deleted for the person | CI |
| BR-13b | Any harness mode runs a turn: Claude Code, Codex or Cursor | One fence for every mode, owned here. The run's writes are confined to the session's worktree, never the repository's `.git`, and the run's commands start with only an allowlisted environment, never the server's whole environment. That is environment filtering, not a security boundary: a command runs as the server's operating-system user, and on Linux it can still read the server's environment through `/proc`. A separate user or container is what contains that, and is a follow-up issue. A mode that can't hold either half on this host is unavailable with the reason, through FIX-1914's mode check (epic ER-1), and opens no session. Each harness proves its own half | Here BR-13 and V6, a planted server variable absent from the run's environment · FIX-1916 BR-10, BR-12 · FIX-1917's fence rule |

## The plan panel

| # | When | Then | Proved by |
|---|---|---|---|
| BR-14 | Claude Code records plan rows during a turn | The panel shows each row's wording and status while the run works, equal to the record | CI · goal **p** |
| BR-15 | The session's latest turn recorded no plan | The panel says "no plan recorded for this turn", even when an earlier turn recorded one. Until FIX-1185 lands, that is every Claude Code turn | CI · goal **p** |
| BR-16 | The harness declares no plan record at all | The panel says "<Mode label> reports no plan", the label read as data from FIX-1914's mode list, never from a branch on harness kind | CI |
| BR-17 | Several turns ran | The panel shows the latest turn's plan, labelled with its turn. An earlier turn's rows are never shown as the current plan | CI |
| BR-18 | The person uses the panel | Nothing in it starts, edits or hands off work (epic ER-10) | CI · review |

## The plan record in core

| # | When | Then | Proved by |
|---|---|---|---|
| BR-19 | A plan row was written before the move | It reads under the same key, with the same fields | CI, an old row as a fixture |
| BR-20 | Code imports the plan names from the Claude Code package | It gets the same objects core exports | CI |
| BR-21 | A plan row changes during a run | An open page sees the change without a refresh | CI |
| BR-22 | A harness writes a field the shape lacks, or a status it has never seen | The status records as itself. A new field is an epic-level change (epic ER-15), not a local one | Review |
| BR-22a | A harness hands `replacePlanList` the whole list, again, during one run | Row *n* holds the list's *n*th item, with its last outcome *applied*. Where the wording at a place is unchanged and the status changed, the row's earlier status becomes its previous status; a repeated status leaves the previous status as it was, as Claude Code's recorder does. Where the wording changed, the previous status is empty. Rows past the new end are deleted | CI |
| BR-22b | A second invocation writes to the same run namespace | Not supported: one writer per run namespace, per invocation. The helper remembers how many rows it wrote and never lists the prefix. A row past the end that a lost count leaves behind doesn't show, since a reader shows only places below the marker's count | Review · CI |
| BR-22c | A harness reports an empty list | The turn's marker says *complete* with no places, and the panel says "this turn's plan is empty", not "no plan recorded for this turn" | CI |
| BR-22d | A plan write fails partway, whether through the helper or a Claude Code plan row | The turn's marker says *incomplete*, with the error. The panel shows the rows it has as possibly incomplete, never as the plan. A marker still *writing* after the turn ended reads the same | CI, a collection that fails on its second write |

## Can this host run it

| # | When | Then | Proved by |
|---|---|---|---|
| BR-23 | Harness modes are on for this host (FIX-1914), but it lacks the Claude Code SDK, runs as root, has no sandbox, or is not signed in to Claude Code, or the repository's worktree root can't be created | The mode reports itself unavailable with that reason through FIX-1914's mode check, and opens no session (epic ER-1) | CI |
| BR-23a | `KITCHEN_SINK_HARNESS_WORKSPACE` is unset and the server runs in local development from inside a git checkout | The repository is that checkout's top level, and the worktrees live outside it, under the derived root in [PLAN → Pinned names](PLAN.md#pinned-names) | CI · goal **w** |
| BR-24 | Harness modes are off for this host: on Vercel; `KITCHEN_SINK_HARNESS_WORKSPACE` names something that isn't the top level of a git checkout; or it is unset and the server runs in production or outside a checkout (FIX-1914 BR-6, BR-7, as amended in its round 2) | No Claude Code flow is registered. Opening `/claude-code` creates no session, and its flow's API is not found (FIX-1914 BR-14, BR-15) | FIX-1914's goal check, extended here |

## Failure taxonomy

Nothing in this mode is fatal to the app. A run that fails, is stopped or is refused ends its
turn with the harness's own error and leaves the recorded id in place, so the next turn retries
it. A plan the recorder could not write is Claude Code's gap record, not a Kitchen Sink error.
A list `replacePlanList` cannot store in full marks the turn's list *incomplete* and returns;
the run carries on (BR-22d).
Nothing retries on its own: a retry is the person's next turn.

## Acceptance criteria this issue owns

[The goal](SPEC.md#the-goal-and-how-well-know-its-met), on real Claude Code in a browser, with
both controls failing as named. Plus, from the epic: ER-2, ER-3, ER-4 and ER-6 hold for Claude
Code, and ER-5's shape is in core. The plan runs the goal check last.
