# FIX-1770 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The cases, as rules. *Proved by* is the check the plan runs. A rule marked *(fsdev)* holds for
`fsdev dev --app` too, since `shift-manager` wraps it.

## Starting it

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | Someone runs `shift-manager --config <path>` where the package is installed | One port serves the pages and `/api/flows`; the DevTool gets its own port. Both addresses and the config path print. Nothing is built | Goal check a · packed-install CI |
| BR-2 | No `--config` is given | Found in the current directory as `fsdev dev` finds it; none there is refused, naming `--config` | CI |
| BR-3 | The config doesn't load, or its default export is not a `FlowState` | Stops with the loader's own message, exit code 3 | CI |
| BR-4 | A relative path is given, or the Lab uses one | Resolved from the directory the command ran in, and the process runs there *(fsdev)* | CI |
| BR-5 | `--port 0`, or a port that isn't a whole number up to 65535 | `0` picks a free port and prints it; anything else is refused, exit code 3 *(fsdev)* | CI |
| BR-6 | `--assets <dir>` is given | That build is served as it is. No `index.html` there: refused *(fsdev, as `--app <dir>`)* | CI |
| BR-7 | `fsdev dev` runs with no `--app` | Exactly as today: the DevTool at the root of port 4200, loopback, browser opened | Existing suite |

## What the page is handed

| # | When | Then | Proved by |
|---|---|---|---|
| BR-8 | The Lab declares a `devtool` block | Every HTML page served carries the user and bearer, on a loopback host only *(fsdev)* | CI · goal check a |
| BR-9 | The DevTool is served beside the app | Every HTML page carries its address as the `fsdev-devtool-url` meta, and *Open trace* opens it *(fsdev)* | CI · goal check a |
| BR-10 | The DevTool's pages are not installed or not built | The app starts, says so, carries no address meta; *Open trace* is off and says why *(fsdev)* | CI |
| BR-11 | `--shift <name>`, or `SHIFT_MANAGER_SHIFT`, names a profile | The page boots on that profile's scheme. An unknown name is refused, listing the known ones | CI |

## Binding a network address

| # | When | Then | Proved by |
|---|---|---|---|
| BR-12 | `--host` is not a loopback address and the Lab would run as the framework's unauthenticated default principal | Refused, with the guard's message; `--allow-unauthenticated` overrides it for a Lab authenticated at host level, as on `fsdev serve` *(fsdev)* | CI |
| BR-13 | `--host` is not loopback and the Lab declares a bearer for its page | Refused: the token only ever goes to a loopback page *(fsdev)* | CI |
| BR-14 | `--host` is not loopback and the bind is allowed | The anonymous debug surface `fsdev dev` opens on loopback stays closed *(fsdev)* | CI |
| BR-15 | `--dev` with a non-loopback `--host` | Refused *(fsdev, as `--watch`)* | CI |

## `--dev`

| # | When | Then | Proved by |
|---|---|---|---|
| BR-16 | A module the Lab imported is saved | The Lab restarts within seconds on the same port, the command keeps running, and an open page reloads itself, built pages included *(fsdev)* | Goal check b · CI |
| BR-17 | A file under the config's directory is saved, such as a `WORKER.md` | Same as BR-16 *(fsdev)* | CI |
| BR-18 | The app's page source, the Lab's data file, or anything in `node_modules` is saved | The Lab does not restart *(fsdev)* | CI |
| BR-19 | A restart fails, for example on a syntax error | The error prints, the command keeps watching, and the next save tries again *(fsdev)* | CI |
| BR-20 | `--dev` in an install, where the package has no source | The built pages are served; BR-16 to BR-19 still hold | Goal check b |
| BR-21 | `--dev` in a checkout | Pages come from source through Vite in the same process, with BR-8, BR-9 and BR-11's config; no proxy | CI |
| BR-22 | The app has source, but Vite doesn't resolve from it | Says so and serves the built pages *(fsdev)* | CI |

## The layer line and the package

| # | When | Then | Proved by |
|---|---|---|---|
| BR-23 | fsdev and `node` source is read | Neither imports Workforce or Shift Manager for this hook, and neither names a team, worker or shift | CI source check |
| BR-24 | The package is packed for release | It holds the built pages, the shift profiles and the command. No source, team profiles or tests | Packed-install CI |
| BR-25 | A publish runs without the built pages | It fails before packing | CI |
| BR-26 | The command gets SIGINT or SIGTERM | Both servers close and the Lab is disposed. Nothing is left in a temp directory | CI |

## Failure taxonomy

Bad input is fatal at start, exit code 3, before anything listens; so is a refused network
bind. A missing DevTool degrades. Under `--dev` a broken Lab is never fatal: it waits for a save.

## Acceptance criteria this issue owns

[The goal](SPEC.md#the-goal-and-how-well-know-its-met), from packed tarballs in an empty
project, each leg failing under its control. The plan runs it last.
