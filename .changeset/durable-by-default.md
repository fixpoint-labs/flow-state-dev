---
"@flow-state-dev/engine": minor
"@flow-state-dev/fsdev": minor
"@flow-state-dev/core": minor
"@flow-state-dev/devtool": patch
"@flow-state-dev/orchestration": patch
"@flow-state-dev/workforce": patch
---

Durable execution is on by default wherever stores persist (FIX-2063). `createFlowState` over filesystem, SQLite or Postgres stores now installs the checkpoint durability provider without `durable: true`; over in-memory stores it still installs none unless `durable: true` is set. `resolveDurabilityProvider({ stores, durable })` exports the rule for hosts that build `createFlowApiRouter` or call `runAction` themselves, and the in-memory checkpoint and suspension stores declare `persists: false`.

`ctx.suspend()` on a host without durable execution now throws an error that names the rule and the setting to change, instead of "requires a DurabilityProvider". The durability sweeper arms for a pending stop's deadline as it does for a wait's, and reads the store's deadlines once at start.

A no-config `fsdev run` now writes to `.fsdev/data/fsdev.db` (the SQLite file `fsdev dev` reads) instead of JSON files under `.fsdev/data`, and runs as `devuser`, the DevTool's default user (exported as `DEFAULT_LOCAL_USER_ID` from `@flow-state-dev/core`), instead of `cli-user`. `fsdev run` and `fsdev chat` use `devuser` as the default user with a config too. A run that stops for a person exits 0 with a `suspended` NDJSON event, `result.suspended` in `--capture`, and a waiting report on stderr. The no-config `fsdev dev` router is durable and sweeps. `--store filesystem` on `fsdev run` and `fsdev dev` keeps the JSON-file store, single-process.

**Migration.** An app on persisting stores that never set `durable` now:

- writes a checkpoint at every step of every sequencer (sequencers already default to `durable: true`),
- resumes a request that crashed instead of rerunning it,
- holds a raw `ctx.suspend()` until it is answered, where it used to fail the request,
- runs the durability sweeper wherever it serves a router: a lease and a scan of pending stops on each tick, even when nothing waits.

Set `durable: false` on `createFlowState` to keep the old behavior. Sessions a no-config `fsdev run` wrote as JSON files are not read by the SQLite default; pass `--store filesystem` to read them. Scripts that look up CLI sessions by `cli-user` should use `devuser`, or pass `--user cli-user`.
