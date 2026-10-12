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
| BR-3 | Claude Code refuses the conversation, or the turn fails before Claude Code confirms an id *in that turn* | The session says Claude Code did not continue conversation *X*, with the run's error. The recorded id stays, and the next turn asks for *X* again ([D2](DECISIONS.md#d2)). A turn that confirmed *X* and then failed shows its error, not a refusal | CI, both paths |
| BR-4 | Claude Code confirms a different id than the turn asked for | The recorded id moves to the new one, and the session says Claude Code started a new conversation | CI |
| BR-5 | A turn is sent while another is running | It waits, then continues the same conversation | CI |
| BR-6 | The page is reloaded, or the server restarts on a durable store | The same session holds the same id, and the next turn continues it | Goal **r** |
| BR-7 | Anything the caller sends, the prompt included | Never chooses the conversation or the directory. Both come from the server | CI |

## While it works

| # | When | Then | Proved by |
|---|---|---|---|
| BR-8 | A run is in progress | Its steps show before the turn completes, every one written by Claude Code's emitter. Kitchen Sink writes no item of its own | CI · goal **l** |
| BR-9 | The person stops a turn | The run is cancelled, the turn shows as stopped, never as refused, even when it stopped before Claude Code confirmed an id. The recorded id stays, and the next turn continues the conversation | CI, stopped before and after the confirmation · goal **s** |
| BR-10 | A host's sign-in lapses after the mode opened | That turn fails with Claude Code's own error, shown as that turn's error. The recorded id stays | CI, with a scripted error |

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
| BR-15 | The session's latest turn recorded no plan | The panel says "no plan recorded for this turn", even when an earlier turn recorded one. Until FIX-1185 lands, that is every Claude Code turn | CI · goal **p** |
| BR-16 | The harness declares no plan record at all | The panel says "this harness reports no plan" | CI |
| BR-17 | Several turns ran | The panel shows the latest turn's plan, labelled with its turn. An earlier turn's rows are never shown as the current plan | CI |
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
| BR-23 | Harness modes are on for this host (FIX-1914), but it lacks the Claude Code SDK, runs as root, has no sandbox, or is not signed in to Claude Code | The mode reports itself unavailable with that reason through FIX-1914's mode check, and opens no session (epic ER-1) | CI |
| BR-24 | Harness modes are off for this host: deployed, or no `KITCHEN_SINK_HARNESS_WORKSPACE` (FIX-1914 BR-6, BR-7) | No Claude Code flow is registered. Opening `/claude-code` creates no session, and its flow's API is not found (FIX-1914 BR-14, BR-15) | FIX-1914's goal check, extended here |

## Failure taxonomy

Nothing in this mode is fatal to the app. A run that fails, is stopped or is refused ends its
turn with the harness's own error and leaves the recorded id in place, so the next turn retries
it. A plan the recorder could not write is Claude Code's gap record, not a Kitchen Sink error.
Nothing retries on its own: a retry is the person's next turn.

## Acceptance criteria this issue owns

[The goal](SPEC.md#the-goal-and-how-well-know-its-met), on real Claude Code in a browser, with
both controls failing as named. Plus, from the epic: ER-2, ER-3, ER-4 and ER-6 hold for Claude
Code, and ER-5's shape is in core. The plan runs the goal check last.
