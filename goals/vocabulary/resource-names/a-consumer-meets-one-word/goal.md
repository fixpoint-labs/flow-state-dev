# vocabulary › resource names › a consumer meets one word

**Issue:** FIX-2479 (epic FIX-2600, ER-6). Its spec's goal: `specs/issues/FIX-2479/SPEC.md` → "The goal, and how we'll know it's met".

**Outcome:** someone building on the packages meets one word for a stored thing, *resource*, and *Status* for a lifecycle, and no name outside the store adapters and UI lists says otherwise. The glossary's resource entry holds that over the whole tree, so a new `FooRow` for a resource is refused wherever it is. A task an earlier version stored with a `"row"` hold still reads as the task's own and can still be answered.

**Input:** the repository's tracked tree at one commit; three names generated at run time (a `…Row` type in `harness-manager`, a `use…CollectionItem` export in `react`, a multi-line lifecycle `…State` in `workspace`), so no list can already know them; a task record rewritten to the old hold marker after it is filed, once on a question and once on a confirm.

**Signal:** each failure is tagged `<leg>:`.

- `open`: the guard (`scripts/check-retired-terms.mjs --list collection-row`), run in a fresh copy of the commit as CI runs it, reports OPEN 0 under the resource entry, over every tracked file.
- `reaches`: with the generated names committed to the copy's `main` (no diff holds them), the same run reports each one and fails.
- `control`: the guard's `--control` plants a `FooRow` type in more than one package and a `useFooCollectionItem` export, and refuses each.
- `exemptions`: the resource entry's exemptions are only the store-adapter and UI-list path rules, D2's stored field names and D4's released quotes, each in its own shape. Each path rule keeps only store-adapter or `components/`/`surfaces/` files of the tree; the quote rule reads only published pages (`apps/docs/{docs,guides}`, `packages/*/README.md`) and names exactly the three released messages; the matcher carries no narrowing context.
- `hold`: a real `createFlowState` host with one task board. A task filed on a question, its stored hold rewritten to `source.kind: "row"`, is listed by orchestration's Inbox read (`inboxItems` over the board's `listTasks`) with `"task"`, answered through orchestration's Inbox client (the board's `updateTask`), and `getTask` shows no open hold; the Inbox no longer lists it. The same for a confirm answered yes.

**Anti-game:** the rule legs assert on what the rule finds in the tree, never on a rename list. The copy has no diff against its own `main`, so a rule still reading added lines reports nothing in `reaches` and fails there. `open` floors on the tracked-file count, so a guard that read nothing is CAN'T TELL. The exemption leg checks the kept paths against what a store adapter and a UI list module are, from the spec, not from the glossary, so OPEN 0 can't be reached by widening one. The hold leg writes the store only to make the old-shape input; every read and the answer go through the board's actions and the Inbox client.

**Model:** n/a (model-free).

**Run:** `pnpm tsx goals/vocabulary/resource-names/a-consumer-meets-one-word/run.mts` (reads `HEAD`; `--at <ref>` reads another commit's tree with this checkout's rule laid over it, and skips the hold leg).

**Controls:**

- `--at <origin/main before FIX-2479>`: the tree before the renames. Must FAIL on `open`, listing the open names.
- `GOAL_CONTROL=no-row-read`: a scratch patch (`goals/lib/module-patch.mts`) stops the hold parse reading `"row"` forward. Must FAIL on `hold:`.

## Verdict log

| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
