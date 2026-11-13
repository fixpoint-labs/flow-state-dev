# docs-pages › it fails what the standard forbids

**Issue:** FIX-2697
**Outcome:** A docs page that skips a pass, runs over its budget, or breaks the figure rules cannot merge, and CI says which rule it broke. A clean page with a full record passes.
**Input:** the fixtures under `fixtures/`, each a set of files put into the revamp's pages folder of a scratch tree: five bad pages, each with a full record unless the record is what it breaks (a concept page over its 1500 words, a recipe over its 800, `type: guide`, an untitled TypeScript example indented under a list item, a record with no pass 9); four bad figures, each the figure lint's own clean figure with one edit (a hex colour, a colour name, a `<style>` block, no key); an empty pages folder; and a clean page with its record, fact sheet and a figure it puts on through `<Figure>`. Held-out: the second over-budget page and the colour-name figure are variants of the first page and the hex figure, and the check names no rule's internals, so any page or figure that breaks the same rule must fail the same way.
**Signal:**
- **ci:checker**, **ci:figure-lint:** the tree's `ci.yml` runs `node scripts/check-docs-page.mjs` over every page and the docs package's `lint:brand`, which is `node scripts/lint-brand.mjs`.
- **over-budget**, **over-budget (a recipe)**, **unknown-type**, **indented-fence**, **record-missing-pass**, each `:ci` (CI's run over every page) and, but the last, `:named` (pass 4's run on the page): exit 1, the fixture's page reported FAIL with exactly one problem, its rule's (`N words, budget 1500`, `budget 800`, ``unknown `type` "guide"``, `1 ts code block(s) with no title="path"`, `record: no pass 9`), and no page the fixture did not add failing.
- **no-path-given:** with no page under the pages folder, CI's run exits 1 and says it found no page.
- **hex-colour**, **colour-name**, **style-block**, **no-key:** the figure lint exits 1 with a finding on the fixture's file naming its rule (`colour` with the hex, `colour` with `red`, `svg` with `<style>`, `key` with `0 key elements`).
- **clean:checker**, **clean:figure-lint:** CI's run exits 0 and reports the clean page ok; the figure lint exits 0 with the page and its figure in the tree.
- 5 of 5 bad pages, 4 of 4 bad figures, the empty run and the clean page.

**Anti-game:** a hollow pass would grade the checker's functions or its rule table, or run the checker with no page and read its silence as a pass. The check imports neither script: it runs the commands CI runs, in a tree with the fixture in place, and reads their exit code and output. A page leg fails on a second problem as well as a missing one, so a fixture cannot pass on a neighbouring rule; the figure legs need the rule's own name on the fixture's own file. The `ci` legs read `ci.yml`, so a check CI stopped running fails here even though the script still works. The fixture lists are floored with `tell.over`.
**Model:** n/a
**Run:** `pnpm tsx goals/docs-pages/fail-what-the-standard-forbids/run.mts` (this checkout's files, uncommitted changes included)
**Controls:**
- `GOAL_COMMIT=958162196` (`main` before the checker and the figure lint were extended) must FAIL `indented-fence:named` and `indented-fence:ci`, `no-path-given`, `hex-colour`, `colour-name`, `style-block`, `no-key` and `record-missing-pass:ci`. Its CI ran no page checker, so `ci:checker`, every other `:ci` leg and `clean:checker` fail there too. `over-budget:named`, `over-budget (a recipe):named`, `unknown-type:named`, `ci:figure-lint` and `clean:figure-lint` stay green: that checker caught a budget and an unknown type when given the page, and its lint never read a revamp figure.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-13 | `7cbf7591` | n/a | PASS | 5 page fixtures and 4 figure fixtures read. Each bad page failed CI's run and pass 4's with only its rule; the empty run exited 1 with `no page found`; each bad figure failed the lint on its rule; the clean page and figure passed both. |
| 2026-11-13 | `958162196` (`GOAL_COMMIT`) | n/a | FAIL (expected) | 13 failures: `ci:checker`; every `:ci` page leg exited 0 (the checker given no page read nothing); `indented-fence:named` exited 0, reporting the page ok; `no-path-given` exited 0; the four figure legs exited 0 (`18 files, 0 findings`: the lint never read a revamp figure); `clean:checker` reported no page. Green, as expected: `over-budget:named`, `over-budget (a recipe):named`, `unknown-type:named`, `ci:figure-lint`, `clean:figure-lint`. |
