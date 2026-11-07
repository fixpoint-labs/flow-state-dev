# first-hour › it runs-without-store-ceremony

**Issue:** FIX-2452
**Outcome:** An adopter's first runtime file names no store until they want data kept, their first flow declares no empty `session`, every store slot they can name does something or has its store on the way, a chat action that would render empty says so when the flow is built, and a store package's root offers one factory.
**Input:** packed tarballs of core, engine, cli and the two store packages (with their workspace closure) installed into an empty project, and a flow whose handler adds its input to a session total. Held-out: a different flow kind, action name or value must pass too; the warning names whatever it is on.
**Signal:** `check.mjs` prints PASS or FAIL per signal, and exits 0 only when all six pass:
- **(a)** no `stores` and no `session` block: `fsdev run` answers, and stderr says the app runs in memory; with `stores` set, stderr says nothing about memory.
- **(b)** `stores: sqliteStores({ filename })`: a second `fsdev run --session` reads the first run's total, the session row is in `filename`, and a fresh `filename` does not see it.
- **(c)** a typed profile naming `queue` or `scheduler` fails to typecheck naming the slot, 2 of 2; a profile with `primary`, `bus` and `blobs` constructs.
- **(d)** a caller action on a generator with no `itemVisibility` gives exactly one warning naming the flow, the action and both fixes; `itemVisibility` set, an internal, task, webhook or schedule entry, or `NODE_ENV=production`: none.
- **(e)** the installed store roots export only `sqliteStores` and `createSQLiteScheduleIndex`, or `postgresStores` and `createPostgresScheduleIndex`, as runtime values; every runtime name removed from a root is on its `./host`; importing store-postgres needs no database.
- **(f)** the tree's teaching files (docs, package READMEs, examples): 0 store lines, 0 empty `session` blocks on getting-started pages, 0 docs pages naming `queue` or `scheduler` as a slot.
**Anti-game:** nothing asserts on the normalising helper, `meta.profileKeys` or workspace `src`. (b) runs with the app's config, so it can't pass through the CLI's own no-config SQLite store, and the row is read from `filename`. Every assertion reads the answer, the stored row, stderr text, the compiler's error or the installed module's keys.
**Model:** n/a. No model call: (d) builds the flow, it never runs the generator.
**Run:** `node goals/first-hour/runs-without-store-ceremony/check.mjs`
**Controls:** `node goals/first-hour/runs-without-store-ceremony/check.mjs --control d6a38c09` packs that commit and must FAIL every signal: (a) throws at construction, (b) throws, (c) constructs, (d) warns nothing, (e) lists 20 and 22 names, (f) counts the store lines.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
