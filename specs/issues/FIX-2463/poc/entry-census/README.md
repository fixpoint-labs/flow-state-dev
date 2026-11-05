# entry-census

Retained evidence for FIX-2463, not production code. It re-derives the spec's counted facts:
which `*_ENTRY` constants and entry factories each published package root exports, and which
files outside the declaring package read each one.

```bash
node specs/issues/FIX-2463/poc/entry-census/census.mjs                # today: 7 root constants, PASS on totality
node specs/issues/FIX-2463/poc/entry-census/census.mjs --plant        # negative control: a planted root constant, must FAIL
node specs/issues/FIX-2463/poc/entry-census/census.mjs --expect-none  # the after state: FAILS today, passes when the change lands
```

It reads exports through `scripts/mechanism-exports.mjs`'s `packageExports`, with every subpath
hidden so only the `.` entry counts. The consumer census is a word match over `packages/` and
`apps/`, split into source and test files.
