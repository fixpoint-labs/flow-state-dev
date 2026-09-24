# FIX-1561 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The cases, written as rules. Each says what a person or the system does and what happens. The
*proved by* column is the check the plan runs. "VG" is the goal check on the rendered page;
"CI" is the component's unit suite.

## Where a row's actions sit

The row these rules describe is drawn in [the row, zoomed](figures/row-anatomy.svg).

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | A leaf is open: an instance of a collection kind, or a singleton kind's own row | The host's leaf actions draw in that row's trailing area, after the row's own trailing content, right-aligned | CI · VG |
| BR-2 | Anything in the rail is drawn, open or not | No line holds only host actions. Every action shares a line with the row it acts on | VG · G1 |
| BR-3 | A leaf is closed | Its leaf actions are not drawn. Its row's own trailing content, such as copy, still is | CI |
| BR-4 | A label is longer than the rail allows | The label truncates with an ellipsis. Actions keep their size and stay on the row | VG, at the developer tool's width and at 256px |
| BR-5 | Someone clicks an action | The action runs. The row does not open, close or become selected | CI (existing) |
| BR-6 | The rail renders any combination of slots | No button or link sits inside another | CI (existing, now covering the moved toolbar) |

## From the keyboard

| # | When | Then | Proved by |
|---|---|---|---|
| BR-7 | Someone tabs along a row | Focus goes to the row, then its own trailing controls, then the open leaf's actions, then the next row | CI |
| BR-8 | Someone opens or closes a leaf with Enter | Focus stays on the same row. The row's button is not replaced | CI |
| BR-9 | An action is an icon | It has an accessible name and a tooltip saying what it does. Kitchen-sink's + is "New session" | CI · VG by role and name |
| BR-10 | *Only if the owner picks hover reveal.* A row's actions are hidden | They stay in the tab order, and focusing any of them shows them. A row that is selected, or on a screen with no hover, always shows them | CI |

## Indentation

| # | When | Then | Proved by |
|---|---|---|---|
| BR-11 | Rows at one level are drawn | Their labels start at one x, whether or not the row has a twisty | VG · G2 |
| BR-12 | A row sits under another | Its label starts one step right of its parent's, and every step is the same size | VG · G3 |
| BR-13 | A singleton kind is open | Its sessions sit at the level a collection's instances would, on the same column | VG · G2 |
| BR-14 | A dispatch run is listed under the session that started it | It sits one more step in, as today, and still only one | CI (existing) |
| BR-15 | A leaf is loading, empty, or failed to load | The note or retry line starts on the label column of the rows it stands in for. A section-level note starts on the kind column | VG · G4 |

## Session labels

| # | When | Then | Proved by |
|---|---|---|---|
| BR-16 | A session has a non-empty title | The row shows the title | CI |
| BR-17 | It has no title and an engine-shaped id, `<prefix>_<13 digits>_<hex>` | The row shows `<prefix>_…` and the last six characters | CI |
| BR-18 | It has no title and any other id | The row shows the id whole, truncated by width like any label | CI |
| BR-19 | Any session row | The full id is the row's tooltip. What the row reports when picked is unchanged | CI |

## What must not move

| # | When | Then | Proved by |
|---|---|---|---|
| BR-20 | A leaf opens, then closes | The host's leaf toolbar mounts when it opens and unmounts when it closes. The developer tool's open-and-refresh signals ride on this until [FIX-1494](https://linear.app/fixpoint-labs/issue/FIX-1494) | CI · the developer tool's existing rail suite |
| BR-21 | A leaf opens | Exactly one session read, for that leaf. Expanding a kind reads nothing | CI (existing) · kitchen-sink e2e (existing) |
| BR-22 | Creating a session from the developer tool fails | The failure is visible on the row and announced, and it adds no line under the row | CI |
| BR-23 | Either rail is drawn | It is the shared component. Neither host adds layout CSS of its own to rows | Review · VG runs on both |

## Failure taxonomy

Nothing here is fatal. A leaf that fails to read shows its retry line, on the right column.
A host action that fails says so on its row. Nothing retries on its own.

## Acceptance criteria this issue owns

On a real browser, the developer tool's rail and kitchen-sink's rail, fully expanded over
seeded sessions that include an empty leaf and a singleton channel, pass G1 to G4, and the
implementation PR shows both screenshots. The same check fails on the code this replaces.
