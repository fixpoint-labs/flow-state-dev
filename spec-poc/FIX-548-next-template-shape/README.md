# POC — what shape does the Next.js template actually have to be?

Throwaway. Lives on the spec branch, never merges, CI ignores `spec-poc/`.

FIX-548's template has to satisfy two consumers of the same config file at once: the **Next.js
bundler** (the mounted route imports it) and the **`fsdev` CLI** (a native `import()` loads it).
FIX-1159 decision 4 settles the CLI half by using `.mts`. Nobody had checked the bundler half,
and the whole product — a streamed response rendered in a browser — runs through it.

Run it: `bash probe.sh [workdir]` (needs network; ~3 minutes). It scaffolds a real
`create-next-app@16.3.1` project, drops each candidate config shape in, and runs `next build`,
`next dev`, and a native `import()` against each. It refuses to run if `<workdir>/probe` already
exists rather than deleting it.

## The contract between this file and the script

**Every claim below is backed by an assertion that fails the run if the claim becomes false.**
That is the point of the file, and it has been the source of every review finding against this
POC — four rounds of "this check cannot fail the thing it is cited for." So the rule now is:
a claim is either asserted, or it is not made here.

Exit status: `0` every claim below held · `1` one of them did not · `2` the run could not be
completed (scaffold or install failed, no free port, workdir occupied).

Each variant asserts both its **outcome** and its **diagnostic**, so "the build failed" is not
automatically a pass for a row documented as failing — a route-file typo, a dependency problem,
or a future Next regression would otherwise be read as "matched the documented result". Rows
documented as passing assert the route actually compiled (`/api/flows` in the build output),
not merely that the process exited 0.

**What this POC does not establish** — stated because the spec cites it and the boundary matters:

- **That `force-dynamic` prevents response buffering.** It needs a real streamed model response
  to observe. §10's goal check owns it, by requiring the response to render *incrementally*.
- **That `--agents-md` is on by default.** The invocation passes it explicitly, as the spec
  requires of every flag, so nothing here speaks to the default. What is asserted is that
  `create-next-app` still writes `AGENTS.md` **when asked** — which is what the design rests on.
- **That `next dev` re-creates a missing `AGENTS.md` block.** Next's block is present before the
  server starts, so the check proves it was left alone, not that it would be restored.
- **Whether a provider SDK that `@flow-state-dev/core` imports dynamically by package name
  resolves inside the Next.js server bundle.** `createModelResolver` carries a `directLoadFailed`
  fallback for exactly this case, so it is a known hazard. Only a real run with a real key
  reaches it — §10's goal check does, through the mounted route rather than through `fsdev run`.

## What it settled

| Variant | `next build` | native `import()` | verdict |
|---|---|---|---|
| `fsdev.config.mts`, imported as `../fsdev.config.mts` | fails — `TS5097: An import path can only end with a '.mts' extension when 'allowImportingTsExtensions' is enabled` | clean | needs a `tsconfig.json` edit |
| `fsdev.config.mts`, imported as `../fsdev.config` | fails — `Module not found`; Turbopack does not resolve extensionless to `.mts` | clean | dead |
| `fsdev.config.mts`, with `allowImportingTsExtensions: true` added to the tsconfig | passes | clean | works, at the cost of both edits this row names |
| **`fsdev.config.ts` + `"type": "module"` in the manifest** | **passes** | **clean, no warning** | **chosen (§6 decision 4)** |
| `fsdev.config.ts`, no `type` field | passes | loads, but emits `MODULE_TYPELESS_PACKAGE_JSON` | rejected |

The chosen variant is also run end to end against the shape the spec specifies — both route
files, with the canonical `runtime = "nodejs"` and `dynamic = "force-dynamic"` exports. `next dev`
serves `GET /api/flows` (the bare route) and `GET /api/flows/sessions/abc` (the catch-all), and
each returns this run's unique marker, proving the config module that answered is the one this
run wrote rather than a stale server.

## What it found that nothing in the epic or the sibling specs knew

Asserted **before the script writes anything**, because the checks are otherwise self-concealing:
the script later appends its own section to `AGENTS.md`, so a check at the end would go green
exactly when the pinned scaffolder had stopped producing these files.

1. **`create-next-app@16.3.1` writes `AGENTS.md`**, carrying its own delimited block
   (`<!-- BEGIN:nextjs-agent-rules -->`). So the greenfield Next path is an **append to an
   existing file, never a create** — the case everyone had filed as brownfield-only. Our appended
   FSD section is still intact after a `next dev` run, and so is Next's block.
2. **It also writes `CLAUDE.md`.**
3. **Git ignores `.env.local` in a fresh scaffold.** Asserted with `git check-ignore`, not by
   grepping `.gitignore` — a text match on `^\.env` also passes for a file that only lists
   `.env.example`, which would leave `.env.local` publishable. The credential stop (spec
   decision 7) rests on this, so it is checked the way the real command has to check it: ask git
   about the path, before the key is written.
4. **`create-next-app` fills unprovided options from saved preferences**, printing
   `Using defaults for unprovided options`. This is why the spec requires every flag to be passed
   explicitly and rules out `--yes`: an option we leave off can resolve differently on a machine
   that has run the tool before. *(Observed in the tool's output and documented in its `--help`;
   this script passes every flag, so it does not re-establish it.)*
