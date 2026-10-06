# POC · esm-reload

Throwaway evidence for [FIX-1770](../../SPEC.md). Not production code, not discovered by any
test runner.

**Question:** can `--dev` reload a Lab inside the running process, or must it restart the process?

**Run:** `node specs/issues/FIX-1770/poc/esm-reload/probe.mjs` (Node 22, no dependencies).

**Result (Node 22.22.0, 2026-10-04):**

```
{"probe":"re-import reloads an imported flow","first":1,"second":1,"verdict":"no"}
{"probe":"node --watch restarts on imported module only","afterUnrelated":1,"afterImported":2,"verdict":"yes"}
```

A cache-busted re-import of the config (what `loadFsdevConfig` does) returns the old flow
module, so an in-process reload would serve stale flows. `node --watch` restarts on an imported
module's change and ignores an unrelated file. The restart is a process restart
([DECISIONS → Decided, not asked](../../DECISIONS.md#decided-not-asked)).

**Control:** probe 1 fails (exit 1) if Node ever reloads the imported module; probe 2 fails if
the unrelated file triggers a restart or the imported one doesn't.
