# FIX-1770 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

Proposed reader-facing prose. Implementation reconciles it against what ships, then publishes
it. Voice rules most at risk here: no em-dash as a connector, no "seamless", "worker" for
what runs a row, and say what `fsdev dev` is the first time a page names it.

## UPDATE · `apps/docs/docs/shift-manager/overview.md` · intro, third paragraph

Replace "It lives in this repository under `labs/shift-manager` and isn't published to npm, so
you run it from a checkout." with:

> It is published to npm as `@flow-state-dev/shift-manager`. The pages ship built, so there is
> nothing to compile.

## UPDATE · `apps/docs/docs/shift-manager/overview.md` · replace "Run it" up to "The `devteam` profile"

> ## Run it
>
> Install it in the project that holds your Lab's config, then point it at that config:
>
> ```bash
> npm install @flow-state-dev/shift-manager
> npx shift-manager --config ./fsdev.config.mts
> ```
>
> Without `--config`, it looks for `fsdev.config.ts` (or `.mts`, `.js`, `.mjs`) in the current
> directory, the way `fsdev dev` does. It prints its address, `http://127.0.0.1:4300` by
> default, and opens it. One process serves the Lab's API under `/api/flows`, Shift Manager's
> pages, and the [DevTool](../devtool/overview.md) over the same Lab on a port of its own.
>
> | Option | Default | What it does |
> |--------|---------|--------------|
> | `--config <path>` | `fsdev.config.*` in the current directory | The Lab's config. A relative path resolves from where you ran the command. |
> | `--port <n>` | `4300` | `0` picks a free port. |
> | `--host <host>` | `127.0.0.1` | A non-loopback host is refused unless the Lab authenticates requests, and always refused for a Lab that hands its page a bearer token. |
> | `--shift <day\|night>` | `SHIFT_MANAGER_SHIFT`, else unset | Start on the light (`day`) or dark (`night`) look. Unset, the page follows your OS. |
> | `--dev` | off | Restart the Lab when you save one of its files. See below. Loopback only. |
> | `--assets <dir>` | the built pages in the package | Serve a different build of the pages, as it is. |
> | `--no-open` | opens | Don't open the browser. |
>
> The process runs from the directory you started it in, so a Lab's relative paths, such as a
> SQLite file, land where they would under `fsdev dev`. A config that doesn't load, or doesn't
> default-export a `FlowState`, stops the command with the loader's message.
>
> If the DevTool's pages aren't installed, Shift Manager still starts, says so, and turns
> *Open trace* off. Install `@flow-state-dev/devtool` to get them.
>
> ### While you edit your Lab
>
> Add `--dev` and leave it running. When you save a file your Lab loaded, a flow module or a
> file under the config's folder such as a `WORKER.md`, the Lab restarts by itself and the page
> reloads. Saving something the Lab didn't load, or its data file, does nothing.
>
> If the Lab fails to start after a save, the error prints and Shift Manager waits for the
> next save. A restart is a new process: a Lab with in-memory stores starts empty each time,
> so use SQLite if you want your data to survive edits.
>
> ### Working on Shift Manager itself
>
> In this repository, `pnpm --filter @flow-state-dev/shift-manager dev` runs the `devteam`
> profile with `--dev`. From a checkout, `--dev` also serves Shift Manager's pages from source,
> so a change to a screen shows as you save it. `start` runs the same profile on the built
> pages, and builds them first when they're older than their source.
>
> To open another Lab from a checkout, pass its config:
> `pnpm --filter @flow-state-dev/shift-manager dev --config ../my-lab/fsdev.config.mts`.

## UPDATE · `apps/docs/docs/shift-manager/overview.md` · "The `devteam` profile", first sentence

> `devteam` is the team profile in this repository, at `teams/devteam/fsdev.config.mts`. It
> isn't in the published package, because it builds on the repository's own test Labs.

Change the data path in that section from `labs/shift-manager/.fsdev/devteam.sqlite` to
`packages/shift-manager/.fsdev/devteam.sqlite`.

## UPDATE · `apps/docs/docs/api/cli.md` · `fsdev dev` options table, three rows

> | `--app <package\|dir>` | Serve an app's pages at the root instead of the DevTool. See [Serving an app beside your flows](#serving-an-app-beside-your-flows). |
> | `--host <host>` | Host to bind (default `127.0.0.1`). A non-loopback host runs the same check as `fsdev serve` and refuses a config that hands its page a bearer token. |
> | `--watch` | Restart when a file your config loaded changes. Loopback only. |

## UPDATE · `apps/docs/docs/api/cli.md` · new subsection after the `fsdev dev` paragraph

> #### Serving an app beside your flows
>
> `fsdev dev` normally puts the DevTool at the root of its port. With `--app`, your own app's
> pages go there instead and the DevTool moves to a port of its own:
>
> ```bash
> fsdev dev --config ./fsdev.config.mts --app @acme/ops-console
> ```
>
> `--app` takes a directory with an `index.html`, or a package that exports `getAssetPath()`,
> a function returning that directory. The API stays at `/api/flows` on the same origin, so
> your pages call it with relative URLs and need no proxy.
>
> Every HTML page fsdev serves carries two things your app can read on boot. The connection
> config from your config's `devtool` block is `window.__FSD_DEVTOOL_CONFIG__`, as the DevTool
> gets it, on a loopback host only. The DevTool's address is
> `<meta name="fsdev-devtool-url" content="…">`, absent when the DevTool isn't installed.
>
> With `--watch`, a package that also exports `getSourceRoot()` is served from that folder
> through Vite, loaded from the app's own install, so its pages reload as you edit them. When
> `getSourceRoot()` returns nothing, or Vite isn't installed there, the built pages are served.
>
> This is for development. To host an app's pages in production, pass its directory as
> `staticDir` to [`serve()`](/docs/server/host-adapters).

## UPDATE · `packages/cli/README.md` · `fsdev dev` section

Add the three flags as in the CLI reference, and one example:

> ```bash
> # Your own app's pages beside your flows, restarting on a change
> fsdev dev --app @acme/ops-console --watch
> ```

## UPDATE · `packages/node/README.md` · `ServeOptions` table, two rows

> | page meta option | — | A `Record<string, string>` of `<meta name content>` tags written into every HTML page served from `staticDir`, on any host. Not for secrets. |
> | page handler option | — | A Connect-style `(req, res, next)` handler tried before `staticDir` for non-API GET requests, for a dev server's middleware. |

The implementer fills in the two option names.

## UPDATE · `packages/shift-manager/README.md` · "Run it"

Replace with the site page's "Run it" section above, verbatim, and remove the paragraphs on
`--team`, `--devtool` and `--devtool-assets`.

## Publication ownership

PR-A publishes the CLI reference's `--app` and `--host` rows, the subsection without its
`--watch` paragraph, and the `node` README rows. PR-B adds `--watch`. PR-C publishes the
Shift Manager page and README. No new page and no sidebar change.
