# @flow-state-dev/tools

## Pre-1.0 history

Captured from the project's pre-Changesets development log (root `changelog.md`,
deleted on FIX-653). Entries are listed newest-first.

### 2026-05-17 — Bash tool: working bash on Vercel without operator setup (FIX-587)

The kitchen-sink `selectBashProvider()` auto-detect on Vercel now requires the `VERCEL_TOKEN` + `VERCEL_TEAM_ID` + `VERCEL_PROJECT_ID` triple before picking the Vercel provider; without it, falls back to `just-bash`. New `BASH_PROVIDER` env var for explicit opt-in. The Vercel adapter's `enrichVercelError` now recognizes `VercelOidcContextError` / `LocalOidcContextError` and wraps every adapter method, not just `Sandbox.create()` / `get()`. Default `destination` for the Vercel provider is now `/vercel/sandbox/workspace`.

### 2026-05-15 — Bash tool fixes (consolidated)

A series of bash-tool fixes shipped together. `routeWrittenFile` strips a leading `./` before matching mount prefixes, so paths the model supplies with `./artifacts/foo.md` route correctly into collections. New `purgeOldRuns` helper and `bash-purge-stale-containers` block bound the `fsdev-*` MOAT container pool when `persist: true`. MOAT containers persist across requests within a session by default (`provider.persist: true`). `stripMountsTargeting` now strips *and* injects the `/workspace` mount declaration. Artifact content now persists on first write via `getOrCreate` + `patchState` + `writeContent`. `bashCommand` runs with PWD = workspace root so the agent never has to know about `/workspace`. New `frameworkManaged` flag on `resolveMoatSandbox`. `flush()` warns on zero-file walks. Default MOAT workspace path aligned with `local` (`.fsdev/workspaces/session/<sessionId>`). Default `runName` is now session-stable (`fsdev-${sessionId}`). `moat run` early-exit detected within the readiness poll with captured stderr tail.

### 2026-05-15 — Bash tool: host-fs sync for bind-mount providers + cold-boot status sequencer

`createMoatAdapter`'s `readFile` and `writeFile` resolve container-side paths against the bind-mount source and operate on the host filesystem directly when the path is under `mountTarget`. New `resolveMountSource` helper reads the workspace yaml's `mounts:`. `flush()` walks via host fs when `sandbox.hostMountSource` is set. `bashCommand` and `bashReadFile` under setup-needing providers are now sequencer-wrapped, with the boot/connect step gated by a runtime "registry is empty" predicate. New exports: `resolveMountSource`, `probeMoatRun`. New optional `Sandbox.hostMountSource` property.

### 2026-05-14 — Bash tool: MOAT 0.5.x compat

`moat version` text-output fallback. `moat run` no longer uses the removed `-d` detach flag — the framework spawns detached on the host and appends `-- sleep infinity`. Every MOAT subprocess now runs with `cwd: workspace`. Default readiness timeout bumped from 10s → 180s. `moat list --json` parser now reads both PascalCase and lowercase keys. `MOAT_RUNTIME` env var is derived from the workspace `moat.yaml`'s `runtime:` field and injected into every MOAT subprocess. `startDetached` pipes `moat run` stdout/stderr through the parent process with a `[moat:<runName>]` prefix.

### 2026-05-14 — Bash tool: scope `flush()` walk

`flush()` no longer runs `find . -type f` from the destination root, which under bind-mount providers traversed the entire user repo. The walk is now scoped to each mount's prefix (`./artifacts`, `./skills`, `./tmp`) plus the scratch directory. Hydrate seeds an empty `.keep` marker into each mount-prefix directory so `find` doesn't error on collections that start with zero refs; the flush deletion pass skips this marker.

### 2026-05-12 — Bash tool: MOAT sandbox adapter (FIX-584)

New `moat` provider for the bash tool, alongside `local`, `just-bash`, `vercel`, and `upstash`. Runs commands inside a MOAT-managed container on the same host. `createBashCapability` now returns a `cleanupBlock` to wire into `request.onFinished`. Provider-aware system-prompt context guidance. `provider.persist: true` opts into reusing one MOAT container across requests; generated `moat.yaml` files carry an `# fsdev-managed` marker so a stale file from a prior persistent session is recognized as reusable. Closes a pre-existing concurrency race in the module-level sandbox registry by sharing in-flight sandbox creation across concurrent same-scope requests.

### 2026-04-26 — Org scope rename (FIX-428) [BREAKING]

Tool-side resource scopes renamed `project` → `org`.
