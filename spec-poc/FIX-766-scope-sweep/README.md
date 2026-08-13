# FIX-766 — scope sweep (throwaway)

Every scope number in `spec/FIX-766.md` §7 came from these scripts. They exist so a
reviewer can re-derive the numbers instead of trusting them. **Throwaway** — this branch
is never merged. Step 1 of §8 turns the useful half into a real CI guard.

Why they exist: this issue's scope has been under-enumerated three times, each time by
someone reading and listing rather than parsing. A text search for `work` is useless here
(`framework`, `network`, `workstream` all match) and a search for `\.work\(` conflates call
sites with the ~146 mentions inside comments.

## Run them

```bash
# 1. Prove the sweep can return both answers before trusting any count.
node spec-poc/FIX-766-scope-sweep/sweep.mjs --files spec-poc/FIX-766-scope-sweep/control-violation.ts  # every rule must FIRE
node spec-poc/FIX-766-scope-sweep/sweep.mjs --files spec-poc/FIX-766-scope-sweep/control-clean.ts      # every rule must be 0

# 2. The repo counts (AST over tracked .ts/.tsx).
node spec-poc/FIX-766-scope-sweep/sweep.mjs

# 3. Split textual hits into code / comment / string — the "half of this is prose" number.
node spec-poc/FIX-766-scope-sweep/classify.mjs

# 4. Published export surface, per package. --selftest first: it proves the
#    token rule flags WorkTrace/workResults but NOT Workstream/framework/network.
node spec-poc/FIX-766-scope-sweep/surface.mjs --selftest
node spec-poc/FIX-766-scope-sweep/surface.mjs packages/core packages/contracts packages/engine packages/testing
node spec-poc/FIX-766-scope-sweep/surface.mjs --token=background packages/core packages/engine
```

`control-clean.ts` carries the near-miss decoys deliberately: the two *other* `phase`
fields in this repo (`"added"|"input"|"output"|"generator"` and `"stream"|"final"`), plus
`framework` / `network` / `teamwork` / `doWork`. A rule that fires on those over-counts.
