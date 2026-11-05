# Root census

Throwaway evidence for this spec's counted facts, retained with the spec. Not production code.

| Command (repo root) | What it answers | Output at `d6a38c09` |
|---|---|---|
| `node specs/issues/FIX-2449/poc/root-census/census.mjs` | Engine root size; collisions across the six foundation roots; markers | [`out-roots.txt`](out-roots.txt): 383 names, 7 collisions |
| `… census.mjs --public` | The same over every public entry, `/internal` and repo-test entries excluded | [`out-public.txt`](out-public.txt): 10 collisions |
| `… census.mjs --plant` | Negative control: one planted name on react's and client's roots | [`out-plant.txt`](out-plant.txt): 8, one more than roots |
| `node specs/issues/FIX-2449/poc/root-census/consumers.mjs` | Who imports each engine root name, by kind of consumer | [`out-consumers.txt`](out-consumers.txt): 160 imported, 223 by nobody |

Both scripts read source through `scripts/mechanism-exports.mjs` → `packageExports`, one entry at
a time, so the export check can reuse the same overlay. `census.mjs` exits 1 while a collision exists.
