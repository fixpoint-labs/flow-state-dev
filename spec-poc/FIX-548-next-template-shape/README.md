# POC — what shape does the Next.js template actually have to be?

Throwaway. Lives on the spec branch, never merges, CI ignores `spec-poc/`.

FIX-548's template has to satisfy two consumers of the same config file at once: the **Next.js
bundler** (the mounted route imports it) and the **`fsdev` CLI** (a native `import()` loads it).
FIX-1159 decision 4 settles the CLI half by using `.mts`. Nobody had checked the bundler half,
and the whole product — a streamed response rendered in a browser — runs through it.

Run it: `bash probe.sh` (needs network; ~2 minutes). It scaffolds a real `create-next-app@16`
project, drops each candidate config shape in, and runs `next build`, `next dev`, and a native
`import()` against each.

**The exit status is the evidence, and every claim below feeds it** — `0` every row of the table
behaved as documented *and* the scaffold-discovery and served-route assertions held, `1`
something disagreed with what this file claims, `2` the run could not be completed.

Each variant declares both the outcome **and the diagnostic** this README claims for it, so
**"the build failed" is not automatically a probe failure** — two variants are supposed to fail —
and equally, a failure for the *wrong reason* is not a pass. A shared route-file typo, a
dependency problem, or a future Next regression would otherwise reduce to `fail` and be read as
"matched the documented result", letting the probe go green without ever reproducing `TS5097` or
the module-resolution behaviour that is the whole justification for the chosen shape. Pass rows
assert the route compiled (`/api/flows` in the build output), not merely that the process
exited 0.

Two earlier versions of this probe could report green for claims they had not proved, which is
why the status is wired this way:

- it reached a **stale dev server** left over from a previous run, so it now uses a fresh marker
  per run on a port it proves free first;
- it **discarded `next build`'s status** through a pipeline and let a rejected `import()` resolve,
  so those two — the exact claims the spec cites this POC for — sat outside the exit code.

Wiring those in immediately earned its keep: the first run of the accumulating version exited `1`
on the `.ts, no type field` row, and the cause was the probe, not the finding. Its `import()` check
called `process.exit(0)` in the `.then()`, which cut off `MODULE_TYPELESS_PACKAGE_JSON` before Node
flushed it — the warning is emitted asynchronously. The check now sets `process.exitCode` and lets
the process drain. A probe that could not fail would have recorded "clean" for the one variant
whose entire purpose is to warn.

It also serves **both route files with the canonical route exports** (`runtime = "nodejs"`,
`dynamic = "force-dynamic"`) rather than a hand-made bare route, because an earlier version
exercised a shape the spec does not specify.

**What this does not prove:** that `force-dynamic` prevents response buffering. That is Next's
documented behaviour and it needs a real streamed model response to observe — §10's goal check
owns it, by requiring the response to render *incrementally*. This probe establishes only that
the specified route shape builds and serves the config module.

## What it settled

| Variant | `next build` | native `import()` | verdict |
|---|---|---|---|
| `fsdev.config.mts`, imported as `../fsdev.config.mts` | Turbopack compiles; **TypeScript fails** — `TS5097: An import path can only end with a '.mts' extension when 'allowImportingTsExtensions' is enabled` | clean | needs a `tsconfig.json` edit |
| `fsdev.config.mts`, imported as `../fsdev.config` | **module not found** — Turbopack does not resolve extensionless to `.mts` | clean | dead |
| `fsdev.config.mts` + `allowImportingTsExtensions: true` | passes | clean | works, costs two edits to files `create-next-app` wrote |
| **`fsdev.config.ts` + `"type": "module"` in the manifest** | **passes** | **clean, no warning** | **chosen (§6 decision 4)** |
| `fsdev.config.ts`, no `type` field | passes | loads, but emits `MODULE_TYPELESS_PACKAGE_JSON` on every CLI command | rejected |

The chosen variant is also run end to end against the shape the spec specifies: `next dev` serves
both `GET /api/flows` (the bare route) and `GET /api/flows/sessions/abc` (the catch-all), and each
returns this run's unique marker, proving the config module that loaded is the one this run wrote.

## Four things it found that nothing in the epic or the sibling specs knew

All four are **asserted, and asserted before this script writes anything** — not printed for a
reader to eyeball. Ordering is the whole point: the probe later appends its own FSD section to
`AGENTS.md`, and `next dev` restores Next's block, so a check placed at the end would report
green exactly when the pinned scaffolder had stopped writing these files. Finding 1 especially,
because the spec's append-not-create design rests on it.

1. **`create-next-app@16` writes `AGENTS.md` itself**, with its own delimited block
   (`<!-- BEGIN:nextjs-agent-rules -->`), and **`next dev` re-adds that block on every run**. So
   the greenfield Next path is an *append* to an existing `AGENTS.md`, never a create — the case
   everyone assumed was brownfield-only. An appended FSD section survived a `next dev` run intact.
2. **`create-next-app@16` also writes `CLAUDE.md`.**
3. **Its `.gitignore` already contains `.env*`**, so the credential-ignore entry the template
   depends on is supplied by the host scaffold — a fact to *assert*, not to assume, because it is
   someone else's file.
4. **`--agents-md` defaults on and the tool says so** (`Using defaults for unprovided options`).
   `create-next-app` persists saved preferences between runs, so any flag we leave off can resolve
   differently on a machine that has run it before. Every flag has to be passed explicitly;
   `--yes` is not a substitute.

## Not settled here

Whether a provider SDK that `@flow-state-dev/core` imports **dynamically by package name**
resolves inside the Next.js server bundle. `createModelResolver` carries a `directLoadFailed`
fallback for exactly this case, so it is a known hazard. Only a real run with a real key reaches
it — §10's goal check does, through the mounted route rather than through `fsdev run`.
