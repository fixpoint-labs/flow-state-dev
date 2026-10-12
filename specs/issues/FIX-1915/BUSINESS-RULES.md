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
| BR-3 | Claude Code refuses the conversation, or the turn ends before it confirms one | The session says Claude Code did not continue conversation *X*, with the run's error. The recorded id stays, and the next turn asks for *X* again ([D2](DECISIONS.md#d2)) | CI |
| BR-4 | Claude Code confirms a different id than the turn asked for | The recorded id moves to the new one, and the session says Claude Code started a new conversation | CI |
| BR-5 | A turn is sent while another is running | It waits, then continues the same conversation | CI |
| BR-6 | The page is reloaded, or the server restarts on a durable store | The same session holds the same id, and the next turn continues it | Goal **r** |
| BR-7 | Anything the caller sends, the prompt included | Never chooses the conversation or the directory. Both come from the server | CI |

## While it works

| # | When | Then | Proved by |
|---|---|---|---|
| BR-8 | A run is in progress | Its steps show before the turn completes, every one written by Claude Code's emitter. Kitchen Sink writes no item of its own | CI · goal **l** |
| BR-9 | The person stops a turn | The run is cancelled, the turn shows as stopped, the recorded id stays, and the next turn continues the conversation | CI · goal **s** |
| BR-10 | A host is not signed in to Claude Code | The first turn fails with Claude Code's own error, shown as that turn's error | CI, with a scripted error |

## Where it works

| # | When | Then | Proved by |
|---|---|---|---|
| BR-11 | Any turn of a session runs | It works in that session's own directory under the host's root, the same one every turn. Two sessions never share one ([D1](DECISIONS.md#d1)) | CI |
| BR-12 | A session or tenant id holds characters a path can't | It still maps to one directory inside the root, distinct from every other id | CI |
| BR-13 | The run tries to write outside its directory | The sandbox refuses it. Nothing Kitchen Sink adds | The Claude Code package's own tests |

## The plan panel

| # | When | Then | Proved by |
|---|---|---|---|
| BR-14 | Claude Code records plan rows during a turn | The panel shows each row's wording and status while the run works, equal to the record | CI · goal **p** |
| BR-15 | A turn recorded no plan | The panel says "no plan recorded for this turn". Until FIX-1185 lands, that is every Claude Code turn | CI · goal **p** |
| BR-16 | The harness declares no plan record at all | The panel says "this harness reports no plan" | CI |
| BR-17 | Several turns recorded plans | The panel shows the latest of them, labelled with its turn | CI |
| BR-18 | The person uses the panel | Nothing in it starts, edits or hands off work (epic ER-10) | CI · review |

## The plan record in core

| # | When | Then | Proved by |
|---|---|---|---|
| BR-19 | A plan row was written before the move | It reads under the same key, with the same fields | CI, an old row as a fixture |
| BR-20 | Code imports the plan names from the Claude Code package | It gets the same objects core exports | CI |
| BR-21 | A plan row changes during a run | An open page sees the change without a refresh | CI |
| BR-22 | A harness writes a field the shape lacks, or a status it has never seen | The status records as itself. A new field is an epic-level change (epic ER-15), not a local one | Review |

## Can this host run it

| # | When | Then | Proved by |
|---|---|---|---|
| BR-23 | The host is deployed, lacks the Claude Code SDK, runs as root, or has no sandbox | The mode reports itself unavailable with that reason, and opens no session. The picker (FIX-1914) shows it | CI |

## Failure taxonomy

Nothing in this mode is fatal to the app. A run that fails, is stopped or is refused ends its
turn with the harness's own error and leaves the recorded id in place, so the next turn retries
it. A plan the recorder could not write is Claude Code's gap record, not a Kitchen Sink error.
Nothing retries on its own: a retry is the person's next turn.

## Acceptance criteria this issue owns

[The goal](SPEC.md#the-goal-and-how-well-know-its-met), on real Claude Code in a browser, with
both controls failing as named. Plus, from the epic: ER-2, ER-3, ER-4 and ER-6 hold for Claude
Code, and ER-5's shape is in core. The plan runs the goal check last.
