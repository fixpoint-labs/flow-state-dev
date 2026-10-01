# FIX-1655 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The cases, written as rules. The *proved by* column is the check the plan runs. Epic rules this
issue owns are cited, not restated: [ER-2, ER-3](../../epics/FIX-1649/BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt)
and [ER-6](../../epics/FIX-1649/BUSINESS-RULES.md#what-no-child-may-do).

## What a registry component may paint

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | Any registry component file sets a colour | Only through a named token: the existing ones, or `success`, `warning`, `info`, `attention`. No fixed palette class, no hex, no `rgb()`. A fully transparent value (`#0000`) is not a colour and is allowed | CI · a census over **every** registry file, asserting the count walked |
| BR-2 | A state means a person must act: a tool call awaiting approval, a task parked for review | It uses `attention` | CI · per-state assertion on the tool card and the task plan · goal check c:attention |
| BR-3 | A state means something is off but nobody is being asked: a blocked task, a stuck request, an audit warning, a denied tool call | It uses `warning`, never `attention` | CI · same · goal check c:attention |
| BR-4 | A state means done or approved / running or informational / failed, an error, or a reject action in an approval card and its receipt | `success` / `info` / `destructive`. A denied tool call is BR-3's, not this rule's | CI |
| BR-5 | A colour isn't a status: a folder icon, a focus outline | An existing neutral token (`muted-foreground`, `ring`), not a status token | CI · census |
| BR-6 | A filled button sits on a status colour | Its text uses that token's `-foreground`, not `white` | CI · census |

## What an app gets with no theme

| # | When | Then | Proved by |
|---|---|---|---|
| BR-7 | An app installs a component that uses a status token | The `tokens` item comes with it, and the app's stylesheet gains every token with its light and dark default | CI · reachability: every file reading a status token ships in an item whose dependency closure includes `tokens` · goal check host installs this way |
| BR-8 | An app loads no theme | Each status keeps today's hue: green, amber, blue, red, yellow. One shade per meaning; exact shades may shift | Goal check a:neutral · before/after screenshots in the implementation PR |
| BR-9 | An app copied components before this change and re-adds one | It also adds `tokens`; an app that doesn't gets unstyled status colours, and the `ui` docs say so | Docs · [DOCS.md](DOCS.md) |
| BR-10 | Kitchen-sink after the change | Byte-identical copies of the new sources, the new tokens in its stylesheet, and no shift-manager value | CI · the drift check · the static check |

## What the shift-manager theme does

| # | When | Then | Proved by |
|---|---|---|---|
| BR-11 | An app loads the package's stylesheet | Every token, including the four new ones, fonts and corner radii takes shift-manager's light value | Goal check b:themed |
| BR-12 | The `.dark` class is on an ancestor | The same tokens take shift-manager's dark value; the registry's own `dark:` variants read the same class | Goal check b:themed, dark pass |
| BR-13 | The package is loaded | `--fsd-nav-*` and `--fsd-panel-*` read the same tokens, so the navigator and panels match the cards | Goal check b:themed on the chrome |
| BR-14 | shift-manager's theme sets `attention` | It is the only token carrying the highlighter; `warning` gets a different value | CI · a test over the package's values · goal check c:attention |
| BR-15 | The package is built | It imports nothing from `@flow-state-dev/workforce` and names no Workforce word; labels like *NEEDS YOU* are the app's | CI · import check |

## Keeping FSD neutral, and copies honest

| # | When | Then | Proved by |
|---|---|---|---|
| BR-16 | A value the shift-manager theme declares (a colour, a font family) appears anywhere under `packages/` | The static check fails, naming file and value | CI · values read from the package · planted-value control |
| BR-17 | Kitchen-sink's registry copy differs from its source | The drift check fails, naming the file | CI · planted-drift control |
| BR-18 | Another consumer installs registry copies (shift-manager, FIX-1662) | It runs the same comparison over its own folder, by calling the function this issue extracts; FIX-1663's QA plan confirms shift-manager does | CI · closure |

The fence in [what changes](SPEC.md#what-changes) is BR-16: only token names cross it, never a
value.

## Failure taxonomy

Nothing here runs at request time, so nothing retries. A missing token definition degrades to no
colour on that part, never an error; BR-7 and BR-9 exist to prevent it. Every check failure is
fatal to CI and names the file.

## Acceptance criteria this issue owns

[The goal](SPEC.md#the-goal-and-how-well-know-its-met): the goal check passes all three signals
on a real browser after failing **b:themed** under `GOAL_CONTROL=hardcoded-accent`. The epic's
ER-2, ER-3 and ER-6 hold, and the closure's leg c (FIX-1663) has a static check and a drift
check to call. Final theme values wait for the final hand-back (PR 2).
