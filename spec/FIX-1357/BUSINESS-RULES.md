# FIX-1357 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md)

The cases, written as rules. A human reviews this page for a case that is missing; the plan turns
it into work. Three moments catch a mistake, and which one is [D3](DECISIONS.md#d3): the **walk**
sees paths, the **app's build** sees types, **run time** sees values.

## What the walk finds

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | A file sits directly under `workforce/flows/workers/` or `workforce/flows/channels/` and default-exports a flow factory | Registered under the file's basename — on `kinds` for a worker, `channelKinds` for a channel ([D4](DECISIONS.md#d4)) | CI · goal check |
| BR-2 | A file sits directly under `workforce/blocks/` and default-exports a `BlockDefinition` | Registered on `blocks` under the file's basename | CI |
| BR-3 | None of the three folders exists | All maps generate empty. Not an error — an app with no custom code is an ordinary app | CI |
| BR-4 | A folder exists and holds nothing the walk recognises | Empty maps, and the command names the folders it looked in | CI |
| BR-5 | A file that is not TypeScript sits in a locked folder (a README, a fixture) | Skipped silently. The folders hold code, and a note beside it is not a declaration | CI |
| BR-6 | A **directory** sits inside a locked folder | Refused by name, not skipped — a folder an author created and the tool ignored is the silence class this convention exists to avoid | CI |
| BR-7 | Any path on the way in is a symlink | Not followed, and reported in the same wording the shipped readers use | CI |

## What the walk refuses

Fatal when `fsdev gen` runs, never at boot, and **collected** so one run names all of them.

| # | When | Then | Proved by |
|---|---|---|---|
| BR-8 | A basename is not a legal segment (uppercase, dots, underscores, over-long) | Refused, naming the file and the rule. The basename becomes a kind name and a flow instance id, so it obeys the rule every other segment in this tree obeys | CI |
| BR-19 | A basename is one Windows reserves for a device (`con`, `prn`, `aux`, `nul`, `com1`-`com9`, `lpt1`-`lpt9`) | Refused, naming the file and the reason. These satisfy BR-8's grammar, and Windows refuses them **with any extension**, so a tree holding one generates cleanly on POSIX and then cannot be checked out on Windows at all. Enforced in `validateSegment` for **every** label, not only `Kind`/`Block` — `Team`, `Worker`, `Channel` and `Document` had the same hole, and two authorities for one rule is worse than the gap. `com0` and `lpt0` are **not** reserved and stay legal; the over-refusal is pinned by its own case | CI |
| BR-11 | `flows/workers/x.ts` and `flows/channels/x.ts` both exist | Refused. The two maps are separate (D4), so nothing downstream collides — it is refused because one basename meaning two kinds is the ambiguity this convention removes | CI |
| BR-12 | A locked folder is present but unreadable | Refused, naming the path. Never folded into "absent": absent means no custom code, unreadable means code we failed to see | CI |

## What the app's build refuses

The generated maps are typed, so the app's own `tsc` — already running, already resolving the
app's aliases — reads every discovered file for free. Still before the app runs.

| # | When | Then | Proved by |
|---|---|---|---|
| BR-10 | A file has no default export, or exports something that is not a flow factory / `BlockDefinition` | The generated module fails to typecheck, naming the file and the assignment. `fsdev gen` says nothing: it never opened the file (D3) | CI · a fixture app that fails `tsc` |

## What run time refuses, exactly as it does today

Nothing here is new. These are refusals the framework already throws; the convention inherits
them rather than restating them earlier.

| # | When | Then | Proved by |
|---|---|---|---|
| BR-9 | A flow file's default export declares a `kind` that is not its basename | `hireWorkforce` refuses the seat, naming the key and the kind actually filed under it | The existing hire suite, unchanged |
| BR-18 | A worker kind omits `cardinality` or declares `singleton`; a channel kind declares `collection` | The registry refuses at admission — `singleton-id-mismatch` for the worker, since a seat mints with its own id and a singleton's id must equal its kind. **The default is `singleton`**, so a worker kind declaring nothing is wrong by omission: docs say so, a test pins it | CI · the registry's existing suite |
| BR-13 | An author adds a file and does not re-run `fsdev gen` | `fsdev gen --check` exits non-zero naming what changed, as its **own CI step** — not inside a build script, which would regenerate and pass. Every deploy script runs it too. At startup, unchanged | CI · `--check` against a stale fixture |
| BR-20 | An author adds a file while `next dev` is running | Nothing regenerates. `fsdev gen` is a command, not a watcher. The docs say so in those words rather than implying the tree maintains itself | Docs · reviewed, not tested |

## Staying in step

| # | When | Then | Proved by |
|---|---|---|---|
| BR-14 | `fsdev gen` runs twice with nothing changed | Byte-identical output, and `--check` passes. Ordering is by path, so a directory listing's order never moves a line | CI |
| BR-15 | An app passes its maps by hand and never runs `fsdev gen` | Byte for byte as today, forever. A second door, not a replacement (BP-030) | Existing hire suite, unchanged |
| BR-16 | An app passes a hand-written map **and** imports the generated one | Whatever the app composes is what hires. The framework is not told which came from where, and there is no precedence rule to learn | CI |
| BR-17 | The app is built for Vercel or Next | Identical maps. The generated module is static imports, so the bundler resolves it like any other app module | Goal check, against the built app |

![Three columns, left to right. Generate time holds four refusals the walk can see from paths alone. The app's build holds one, the export shape, checked by the app's own typecheck. Run time holds three, each labelled as a refusal that already ships today.](figures/refusals.svg)

Read it left to right and read what run time gained: nothing. Its three entries ship today, doing
the job they already do — which is what makes BR-15 and BR-17 true rather than hopeful.
[D3](DECISIONS.md#d3) changed which column catches a mistake, not whether one does. Nothing
degrades and nothing retries.

## Acceptance criteria this issue owns

An app whose only statement of a custom kind is a file in the tree hires a seat on that kind and
runs it, with no kinds map written anywhere in its source. Proved by the goal check the plan runs
last, which reads the seat's own settings bag to confirm *which* flow answered — so "a seat came
back" cannot pass it.
