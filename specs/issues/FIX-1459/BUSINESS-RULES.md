# FIX-1459 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The cases, written as rules. Where a rule says what a worker can call or read, it is the built-in `agent` kind's rule (BR-32). Each says what an author or the system does and what happens. The
*proved by* column is the check the plan runs. "Refused" always means refused at start, before any
worker runs, with the worker and the file named, and every refusal in one run reported together.

## What a worker can call

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | A worker holds a package and has no `tools:` line | It can call every block in the package, and nothing else it didn't choose | CI · goal check |
| BR-2 | A worker holds a package and writes `tools: []` | It calls nothing: not the package's blocks, not a preset's tools. It still gets the package's instructions | CI |
| BR-3 | A worker holds a package and lists other tools in `tools:` | It can call the listed tools **and** the package's blocks | CI |
| BR-4 | A worker picks a capability preset that carries tools, and has no `tools:` line | It can call the preset's tools (D1). Control tools behave as today | CI |
| BR-5 | A worker picks a preset that carries tools and writes `tools: []` | It calls nothing, as today | Existing grant-gate suites, unmodified |
| BR-6 | A worker picks a preset whose tools are a function, not a list | Those tools reach it through the preset as they would with no `tools:` line; nothing is refused | CI |
| BR-7 | A worker holds no package and picks no preset | Exactly today's behaviour, byte for byte | Existing grant-gate suites, unmodified |
| BR-29 | A capability the **kind** installs has presets on by default, and a worker picks nothing from it (memory's `recall` and `connect`, for example) | Those tools still do not reach the worker. Only what a worker's own file chose grants | CI · the existing memory case, unmodified |
| BR-31 | A worker picks a preset the kind already switches on by default (memory's `recall`) | It gains that preset's tools. Picking it is the choice; the kind's default is not | CI |
| BR-30 | A worker delegates work through a skill | The delegate is fenced to the names the worker **listed**. Chosen tools and package blocks do not travel, the same as a worker's own `blocks/` today | CI |
| BR-8 | A worker row stored before this change is reloaded | It is read the same way a file is: an omitted `tools:` stays omitted and the row gains what it chose. A stored `tools: []` still withholds | CI · a stored row fixture |

## Holding and taking a package

| # | When | Then | Proved by |
|---|---|---|---|
| BR-9 | A package sits in a worker's own `packages/` folder | That worker holds it; no line in `WORKER.md` is needed | CI |
| BR-10 | A package sits in a team's or the org's `packages/` folder | No worker holds it until one names it in `packages:` | CI · a sibling that names nothing gets neither text nor tools |
| BR-11 | A worker names a package in `packages:` | The nearest library that offers that name wins: its team's, then the org's | CI |
| BR-12 | A worker names a package no library in its reach offers | Refused, naming the worker, the package, and the folders looked in | CI · red first |
| BR-13 | A worker's own folder and a library offer the same package name, and the worker names it | Refused: one name, one package. Rename one | CI |
| BR-14 | Two workers of one kind hold different packages | Each gets only its own package's text and tools | CI · goal check's sibling leg |
| BR-15 | A worker holds a package | The package's text reaches it on every turn, after its team's and its own instructions | CI |
| BR-32 | A worker running on a kind the app wrote holds a package | The hire hands that kind the package's text and blocks on a documented key. What the kind does with them is the kind's; the rules on this page are the built-in kind's | CI · a custom kind receives the key |

## What a package may contain

| # | When | Then | Proved by |
|---|---|---|---|
| BR-16 | `PACKAGE.md` has no frontmatter, or no `description` | Refused | CI · red first |
| BR-17 | `PACKAGE.md` has any frontmatter key besides `description` | Refused, naming the key | CI · red first |
| BR-18 | A package folder has no `PACKAGE.md` | Refused. A folder in `packages/` is a package or a mistake | CI |
| BR-19 | A package has no `blocks/` folder | Valid: an instructions-only package | CI |
| BR-20 | A package folder holds `resources/`, `references/`, `skills/` or `packages/` | Refused by name. Documents are org-wide, not a package's | CI |
| BR-21 | A package's block has the same name as another tool the worker can call | Refused, naming both sources. Nothing is shadowed. Checked at start for every name known then; a collision with a preset tool built per turn is refused on that turn by the framework's duplicate-name check | CI · red first |
| BR-22 | A package's block key, file name and the block's own `name` disagree | Refused, as for a worker's own `blocks/` today | CI |
| BR-23 | A package's block declares a store | Refused, as for a worker's own `blocks/` today | CI |
| BR-24 | Any folder or file in a package is a symlink | Refused, never followed | CI · the symlink matrix gains the package rows |
| BR-25 | A package name breaks the tree's segment rules | Refused | CI |

## What a package never does

| # | When | Then | Proved by |
|---|---|---|---|
| BR-26 | Any package is on disk | Its blocks never appear in the app's tool catalog, and no worker that doesn't hold it can name them | CI |
| BR-27 | `fsdev gen` runs | It finds package blocks without opening them, and `fsdev gen --check` fails when a package block is added and not regenerated | CI |
| BR-28 | The package's text is read | The reader takes the file's text, not a path. Nothing about finding it on disk is inside it | CI · called with a string |

## Failure taxonomy

Every problem with a package or a grant is a start-time refusal: the app does not start, and the
message names every bad worker and file at once. Nothing degrades silently, nothing is skipped, and
nothing retries. The one change in reach that is not a refusal is BR-4 and BR-8: a worker that
chose a tool-bearing preset gains its tools on upgrade. That is the decision, and it is called out
in the changelog and the docs' migration note.

## Acceptance criteria this issue owns

On a real model, a worker holding a package follows the package's instructions and calls the
package's tool to finish a task, while a sibling of the same kind that holds nothing sees neither.
Then the same worker with `tools: []` gets the instructions and cannot call the tool.
