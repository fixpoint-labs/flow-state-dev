# poc/entry-points — does the plan name every browser check that opens the shell at `/`?

Throwaway and retained as evidence. Nothing under `specs/` is built, tested or walked by
`fsdev gen`, and `knip` ignores `specs/issues/*/poc/**`. One plain Node script, no dependencies,
reading the repository as it stands.

**The question.** D1 turns `/` into the picker. Every browser check that opens `/` expecting the
assistant and the support desk then lands on the picker and fails, or gets "fixed" by deletion.
The spec claims the cost is an address change in a known set of files. A list written by hand
misses the one nobody remembered, so [PLAN.md → Entry points](../../PLAN.md#entry-points) is
checked against the tree.

**What it scans.** Every `apps/kitchen-sink/e2e/*.ts`, and every `.mts` under `goals/` that serves
Kitchen Sink (`goals/lib/kitchen-sink.mts` and its importers). Each `.goto(` is classified as a
**root** open (`/`, `/?…`, `${origin}/`, `${origin}/${query}`), an **other** path (`/devtool`),
or **unclassified**, which fails the run: the totality assertion.

## Run it

From the repository root:

```bash
node specs/issues/FIX-1914/poc/entry-points/check.mjs                  # the table is total: PASS
node specs/issues/FIX-1914/poc/entry-points/check.mjs --plant          # control: an unlisted root open, must FAIL
node specs/issues/FIX-1914/poc/entry-points/check.mjs --plant-unknown  # control: an unclassifiable open, must FAIL
node specs/issues/FIX-1914/poc/entry-points/check.mjs --after          # after implementation: no root open left, PASS
```

## What it showed (2026-10-12, on `main` at f5cba3d50)

- 17 files scanned, 12 `.goto(` calls, every one classified.
- 6 files open `/`: 3 under `e2e/`, `goals/lib/kitchen-sink.mts`, and 2 goals with their own
  open. Through `openKitchenSink` and `openShell` they reach 8 of the 9 e2e specs and all 6
  `kitchen-sink-talk` goals.
- `--plant` and `--plant-unknown` each exit 1 naming the planted line. `--after` exits 1 today,
  listing all 6 files: the red state V4 must turn green.

The premise held: re-pointing the support desk's checks is an address change in 6 files.
