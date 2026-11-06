# POC · the tracker-id rule

Throwaway design evidence for [the spec](../../SPEC.md). Not production code and not an API
promise; the implementer writes the real rule against the code. Run from the repo root after
`pnpm install`.

| Command | Question it answers |
|---|---|
| `node specs/issues/FIX-2453/poc/rule/run.mjs --control` | Does the rule report JSDoc, string and template ids, keep `//` pointers in shipped source, and report every comment in a copied file? Prints `PASS` |
| `node specs/issues/FIX-2453/poc/rule/run.mjs` | How big is the sweep, by package and by kind? Fails if any tracked in-scope file went unlinted |
| `bash specs/issues/FIX-2453/poc/rule/ratchet.sh` | Can the rule land before the sweep, held by ESLint's bulk suppressions, and still fail a new id? Restores the one file it edits |
| `node specs/issues/FIX-2453/poc/rule/tarball-scan.mjs <unpacked>/package…` | What does an installed tarball show: ids in hovers, in runtime text, in `//` comments? |

Results at `d6a38c09`: 2,192 sites (2,128 JSDoc, 56 literals, 8 copied comments) in 1,562
files. Core 0.4.0's hovers: 307 ids with `BP-`/`BR-`, 272 without.
