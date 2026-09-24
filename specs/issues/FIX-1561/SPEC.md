# FIX-1561 · Rail navigator: flatten row actions onto one line and fix tree indentation

**Spec** · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

Improvement · `react` + `devtool` + kitchen-sink · small · 1 PR · epic [FIX-1455](https://linear.app/fixpoint-labs/issue/FIX-1455)

## Seven people, before and after

| Someone who… | Today | After |
|---|---|---|
| **opens instances in the developer tool's rail** | Each open instance, and the `digest` channel kind, gets an extra line holding only refresh and new session: 12 of the tree's 17 icons | Points at an instance and its copy, refresh and new session appear on its own row, right-aligned; other rows stay quiet. The photographed tree takes 16 lines, not 22 |
| **scans the tree to see what belongs to what** | A session starts 4px *left* of its instance. `support.noticeboard` starts 16px left of the instances at its level. Nothing but indent shows nesting | One column per level, each one 16px step right of its parent, and a dashed line down from each open parent past its children. The channel lines up with the instances. Notes sit on their level's column |
| **compares a row's icons** | Copy is drawn at 13.3px, refresh at 12, plus at 9.3, in the same 16px boxes | All three drawn at one size, with one stroke, in one hit area |
| **looks for a session with no title** | Reads a 32-character engine id, clipped by the rail | Reads `sess_…3df102`, with the full id on hover. Titles and channel names show whole |
| **starts a conversation in kitchen-sink** | Opens the Assistant row and clicks a full-width "New session" line under it | Points at or tabs to the Assistant row, then clicks its +. Same action, still named "New session". Until then it is hidden: the cost the owner accepted |
| **uses the rail from the keyboard** | Tabs through the row, its actions, then a separate action line | The same controls in the same order, on one line; tabbing into a row shows its actions. Opening a row keeps focus on it |
| **builds an app on `FlowNavigator`** | Their `leafToolbar` draws as a strip above the open leaf's sessions | It draws on the leaf's own row, so it has to fit one: a few icon buttons. Content that needs more room goes in a new `leafDetail` slot, on its own line under the open row ([exception](DECISIONS.md#d1-leafdetail)). The release note says so |

Found from a screenshot. Two checks already guard the rail's indentation and both pass on it:
they compare padding values, not where the text lands.

## What changes

![Wireframe of today's rail: refresh and new-session icons on a line of their own under each open instance and under digest; session labels start left of their instance; support.noticeboard starts left of the instances; raw session ids](figures/today.svg)

Today, the photographed rail at twice its horizontal size. The red dashed columns show where
the labels actually start: 36, 32 and 20 pixels. The icons are drawn at their real relative sizes.

![Wireframe of the chosen rail: the row under the pointer shows its actions at one drawn size on its own row, every other row keeps them hidden; dashed tree lines down from each open parent; labels in three columns at 24, 40 and 56 pixels; short session ids](figures/after.svg)

After, same tree and scale, one row pointed at: three label columns, tree lines, one icon size,
actions on their own row and only there, three fewer lines. The reveal, the tree lines and the
icon size are all the owner's ([R1](DECISIONS.md#r1), [O1, O2](DECISIONS.md#owner-decisions)).

![One row in four states: at rest, pointed at, focused from the keyboard, and on a touch screen](figures/reveal-states.svg)

The reveal, one row at a time. Hidden actions keep their space and stay reachable by Tab; a
screen with no hover pointer always shows them.

![One instance row zoomed: the button carries the indent, twisty and label; the trailing area beside it holds the copy icon and, while the leaf is open, refresh and new session; tab order button, copy, refresh, new; three session labels](figures/row-anatomy.svg)

The row, zoomed. The button and the actions stay siblings, the rule the component already
enforces. The one move is where an open leaf's actions draw: into the row's trailing area.

**What a host writes.** The slot's name and arguments don't change. Kitchen-sink's "New
session" becomes an icon that fits on a row:

```diff
  <Button
    variant="ghost"
-   size="sm"
-   className="h-7 w-full justify-start gap-2 text-xs"
+   size="icon-sm"
+   aria-label="New session"
+   title="New session"
    onClick={() => void onNewSession(leaf)}
  >
    <Plus className="h-3.5 w-3.5" />
-   New session
  </Button>
```

The developer tool drops the right-aligned wrapper around its two icons, since the row now does
the aligning, and sizes its three icons so their drawings match. Each host may colour the tree
lines with one new property, `--fsd-nav-guide`.

## How an action reaches the row

```mermaid
flowchart LR
  H["host · rowTrailing"] --> T["row · trailing area"]
  O["leaf opens"] -->|"one session read"| L["open leaf"]
  L -->|"sessions · refresh"| A["host · leafToolbar"]
  A --> T
  L --> S["session rows · one column deeper"]
```

The leaf is still read once, when it opens. Its toolbar now lands on the row that opened it.

## What stays as it is

- Which actions exist, what they do, and which host supplies them.
- When sessions are read: once per leaf you open, never for a closed one.
- How deep the tree goes, read from each flow's cardinality ([FIX-1455 D8](../../epics/FIX-1455/DECISIONS.md#d8)).
- The missing leaf open and close event. That is [FIX-1494](https://linear.app/fixpoint-labs/issue/FIX-1494), and the developer tool keeps its workaround.
- Theming through `--fsd-nav-*` custom properties, and no class names published. The one
  addition is `--fsd-nav-guide`, the tree lines' colour.

## Sign off

1. **[D1](DECISIONS.md#d1) · `leafToolbar` keeps its name and arguments and draws on the open
   leaf's own row, released as a `minor`.** If wrong: an app outside this repo with a wide
   toolbar finds its row labels squeezed after upgrading, told only by the release note.
2. **[D2](DECISIONS.md#d2) · The rail's layout is checked on the rendered page, in CI, for
   both rails.** If wrong: a slow or flaky check nobody trusts, or without it, the next layout
   slip found by eye again.

Decided by the owner, and built in: actions shown on hover or focus ([R1](DECISIONS.md#r1),
in session, 2026-09-24), one drawn icon size ([O1](DECISIONS.md#o1)) and dashed tree lines
([O2](DECISIONS.md#o2)).

**Open: none.** Approve by merging. The reasoning and what lost: [DECISIONS.md](DECISIONS.md).
The cases: [BUSINESS-RULES.md](BUSINESS-RULES.md).
