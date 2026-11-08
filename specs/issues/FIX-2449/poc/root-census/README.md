# Root census

Throwaway evidence for this spec's counted facts, retained with the spec. Not production code.

| Command (repo root) | What it answers | Output at `d6a38c09` |
|---|---|---|
| `node specs/issues/FIX-2449/poc/root-census/census.mjs` | Engine root size; collisions across the six foundation roots; markers | [`out-roots.txt`](out-roots.txt): 383 names, 7 collisions |
| `… census.mjs --public` | The same over every public entry, `/internal` and repo-test entries excluded | [`out-public.txt`](out-public.txt): 10 collisions |
| `… census.mjs --plant` | Negative control: one planted name on react's and client's roots | [`out-plant.txt`](out-plant.txt): 8, one more than roots |
| `… census.mjs --all` | Collisions across every published root | [`out-all-roots.txt`](out-all-roots.txt): 18 |
| `… census.mjs --all --public` | The assertion's scope: every published root plus the six's public entries (`--plant` with it: 23) | [`out-all-scope.txt`](out-all-scope.txt): 22 |
| `… census.mjs --all --every` | Every public entry of every published package, for the record | [`out-all-every.txt`](out-all-every.txt): 27 |
| `node specs/issues/FIX-2449/poc/root-census/consumers.mjs` | Who imports each engine root name, by kind of consumer, docs pages included; adopter code per ER-1 (labs count, `apps/devtool` doesn't) | [`out-consumers.txt`](out-consumers.txt): 168 imported (37 app or docs, 124 host or store, 7 library-only), 215 by nobody |

Both scripts read source through `scripts/mechanism-exports.mjs` → `packageExports`, one entry at
a time. The shipped checks don't reuse this overlay: they read FIX-2448's census module and its
per-entry index of `packageExports`. `census.mjs` exits 1 while a collision exists.
