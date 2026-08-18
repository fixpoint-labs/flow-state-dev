# POC — what shape does the Next.js template actually have to be?

Throwaway. Lives on the spec branch, never merges, CI ignores `spec-poc/`.

FIX-548's template has to satisfy two consumers of the same config file at once: the **Next.js
bundler** (the mounted route imports it) and the **`fsdev` CLI** (a native `import()` loads it).
FIX-1159 decision 4 settles the CLI half by using `.mts`. Nobody had checked the bundler half,
and the whole product — a streamed response rendered in a browser — runs through it.

Run it: `bash probe.sh` (needs network; ~2 minutes). It scaffolds a real `create-next-app@16`
project, drops each candidate config shape in, and runs `next build`, `next dev`, and a native
`import()` against each.

**The exit status is the evidence** — `0` the served-route and `AGENTS.md` claims held, `1` one
of them failed, `2` it could not be checked. The variant table below is printed output you read;
the final section is an assertion the script fails on. It uses a fresh marker per run on a port
it proves free first, because an earlier version of this probe reported green by reaching a stale
dev server left over from a previous run — a result from a neighbour of the claim, which is the
whole failure it exists to catch.

## What it settled

| Variant | `next build` | native `import()` | verdict |
|---|---|---|---|
| `fsdev.config.mts`, imported as `../fsdev.config.mts` | Turbopack compiles; **TypeScript fails** — `TS5097: An import path can only end with a '.mts' extension when 'allowImportingTsExtensions' is enabled` | clean | needs a `tsconfig.json` edit |
| `fsdev.config.mts`, imported as `../fsdev.config` | **module not found** — Turbopack does not resolve extensionless to `.mts` | clean | dead |
| `fsdev.config.mts` + `allowImportingTsExtensions: true` | passes | clean | works, costs two edits to files `create-next-app` wrote |
| **`fsdev.config.ts` + `"type": "module"` in the manifest** | **passes** | **clean, no warning** | **chosen (§6 decision 4)** |
| `fsdev.config.ts`, no `type` field | passes | loads, but emits `MODULE_TYPELESS_PACKAGE_JSON` on every CLI command | rejected |

The chosen variant was also run end to end: `next dev` served `GET /api/flows`, and the route
returned the marker proving the config module was the one that loaded.

## Four things it found that nothing in the epic or the sibling specs knew

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
