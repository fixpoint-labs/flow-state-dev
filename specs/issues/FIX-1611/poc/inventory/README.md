# poc/inventory — does the plan name every check that reads the old roster?

Throwaway and retained as evidence. Nothing under `specs/` is built, tested or walked by
`fsdev gen`, and `knip` ignores `specs/issues/*/poc/**`. Two plain Node scripts, no dependencies,
reading the repository as it stands.

**The question.** [ER-27](../../../../epics/FIX-1592/BUSINESS-RULES.md) says no goal check or e2e
test that reads kitchen-sink is deleted: each is re-pointed. That is only as good as the list.
A list written from memory misses the check nobody remembered, and the miss is silent: the check
keeps passing against nothing, or is deleted with the code it read. So the list in
[PLAN.md → Inventory](../../PLAN.md#inventory) is checked against the tree.

**What counts as a hit.**

- A goal folder (a `goal.md` two levels under `goals/`) any of whose files names a piece D7 or
  D8 cuts (`support.ada` to `support.wren`, `support.mara`, `support.desk`, `ada-wren`,
  `noticeboard`, `desk-clerk`, `followup-runner`, `desk-note`, `followups`, `hireSeat`,
  "Hire another"), or reads the roster's wiring as source (`channel-notify`, `SEAT_ASKS`,
  `workforce-shell`, `apps/kitchen-sink/workforce`).
- Each test in `apps/kitchen-sink/e2e/*.spec.ts` whose own text names a cut piece, or that uses a
  top-level helper or constant that does. A layout test in the same file that shares nothing
  with the roster is not a hit.

A hit that only carries a seat id as its own fixture data is still listed, as **unchanged**, so
the reader sees it was looked at.

**What would have abandoned the direction:** a check the plan did not list, or a checker that
passes whatever the table says.

## Run it

From the repository root:

```bash
node specs/issues/FIX-1611/poc/inventory/check.mjs
node specs/issues/FIX-1611/poc/inventory/check.mjs --drop 8      # control: must fail
node specs/issues/FIX-1611/poc/inventory/check.mjs --plant goals/kitchen-sink-talk/a-check-added-later   # control: must fail
```

It exits 1 on a hit with no row, a row naming nothing on disk (unless marked **on arrival**), or
a row without a disposition from the closed set or a control.

## What it showed

[evidence.txt](evidence.txt): 14 goal folders and 10 e2e tests are hits, and every one has a row.
Dropping the durable-hire row fails naming it; dropping an e2e row fails naming that test;
planting a check added later fails naming it. The premise held: the list is total today.

Nine goal folders read kitchen-sink's roster as their subject. Five name the old ids only as
data in their own fixtures. FIX-1609's check does not exist yet and is listed **on arrival**.

**What it does not prove:** that a re-point is right. That is each check's own PASS with its
control seen to fail, at implementation (PLAN V5). The implementer re-runs this on the tree the
build starts from, so a check added in the meantime becomes a row. It matches the old test
titles, so it is never run on the finished tree.

## citations.mjs, for BR-27

A retained spec cites a check by a relative link or, mostly, a backticked `goals/…` path.
`citations.mjs` lists every citation under `specs/` that doesn't resolve: a missing file, a
missing path, or an anchor no heading has. Some never resolved (a check a spec plans but hasn't
built), so PLAN V8 compares against a list saved before the build:

```bash
node specs/issues/FIX-1611/poc/inventory/citations.mjs --write /tmp/citations-before.txt   # starting tree
node specs/issues/FIX-1611/poc/inventory/citations.mjs --against /tmp/citations-before.txt # finished tree
node specs/issues/FIX-1611/poc/inventory/citations.mjs --against /tmp/citations-before.txt \
  --hide goals/kitchen-sink-talk/answers-a-clerk-note-or-files-it   # control: must fail
```

On the tree this spec was written on, 69 citations were already unresolved: nearly all are
`DOCS.md` drafts' site links or checks a spec plans but hasn't built. Against that baseline the
tree passes, and hiding one goal folder fails, naming the six citations of it
([evidence.txt](evidence.txt), sections 5 and 6).
