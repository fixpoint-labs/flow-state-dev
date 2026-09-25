# FIX-1589 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The cases, written as rules. Each says what a person or the system does and what happens. The
*proved by* column is the check the plan runs. A human reviews this page; the plan turns it
into work.

## Asking the clerk

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | A person sends a note to `support.ada` | `answer` runs with `{ note }`. The note shows as their turn; the reply under it is `[front desk]` followed by what the model wrote | Goal check · V2 |
| BR-2 | The page is reloaded after BR-1 | The note and the reply are both still there | Goal check |
| BR-3 | The same note goes to `support.grace` | The reply reads `[back desk] …`: same kind, the seat's own desk | V2 · the files-alone goal |
| BR-4 | The model returns no text (the test resolver's no-op model, say) | The run completes and the reply is the desk tag alone. Never the note | V2 |
| BR-5 | No model is configured and no key is set | The seat's action fails and the panel shows the error, as it does for any seat (FIX-1585 BR-17). Nothing falls back to the echo | V2 |
| BR-6 | The note is sent from the CLI or over HTTP | Same action, same reply. The README says the call now needs the app's model key | V2 |

## Filing

| # | When | Then | Proved by |
|---|---|---|---|
| BR-7 | The model decides the note needs a person | One `fileTask` on `support.desk` with `board: escalations`, the model's goal text, and `author` the seat's id. The reply says it was filed there | Goal check · V3 |
| BR-8 | The model decides the note is work a seat can run later | One `fileTask` with `board: followups`, filed for the `followup-runner` worker, so `support.wren`'s drain can run it when called | V3 |
| BR-9 | The model names any other board, or none | The tool refuses it before dispatch; nothing is filed. The board list is the tool's input schema | V3 |
| BR-10 | The model tries to set the author, the assignee or the channel | It can't: the tool's input is the board and the goal. The kind sets the rest | V3 |
| BR-11 | A row is filed | It shows in that board's column in the team panel on the next read, and survives a reload | Goal check |
| BR-12 | A clerk seat that is not a member of `support.desk` files (one hired later) | The channel refuses it by name (`author-not-a-member`) and nothing is written. The reply may already say "filed" (D1) | V3 |
| BR-13 | `fileTask` is refused for any other reason (no organization, board not declared) | A failed request on `support.desk`, no row. The clerk's own run is not rolled back | V3 |
| BR-14 | Filing and answering happen in one turn | One reply, after the tool call. Each tool call files one row; nothing dedupes a model that calls it twice | V3 |

## What does not change

| # | When | Then | Proved by |
|---|---|---|---|
| BR-15 | The app boots | The boot still warns that `escalations` is unattended. The clerk kind declares no board | V4 |
| BR-16 | A person posts to `support.desk` | The clerk gets the notify stub's name-only line and does not run | Existing tests |
| BR-17 | `support.otto` calls its `desk-note` tool | Same as today | Existing tests |
| BR-18 | FIX-1585's shell names the clerk's answering action | Still `answer { note }`; the drift test passes unchanged | FIX-1585's V2 |
| BR-19 | The files-alone and durable-hire goals run | Green, on the scripted model, graded on the same desk values | V5 |

## Failure taxonomy

Nothing here is fatal to the page. A model failure surfaces in the seat's panel, with the
composer usable again. A refused filing is a failed request on the channel, and never takes the
clerk's reply back. Filing is best-effort after the model decides; nothing retries on its own.

## Acceptance criteria this issue owns

- In a browser on a production build, keyless, a note to `support.ada` gets a reply a model
  call made, not the note, and both survive a reload.
- In the same run, a note the script files shows as a row on `escalations` in the team panel.
- Both legs fail under `GOAL_CONTROL=echo`.
- The boot warning for `escalations` is unchanged, and the existing checks stay green (epic ER-18).
