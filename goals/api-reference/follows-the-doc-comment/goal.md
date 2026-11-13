# api-reference › it follows the doc comment

**Issue:** FIX-2698
**Outcome:** A sentence added to the doc comment of a published export shows up on that package's page of the API reference the next time the site builds. Nobody edits a reference page by hand, and there are 27 package sections for it to show up in.
**Input:** `fixtures/markers.json`: one root export per section (27, `contracts` reading under `core`), two of them types (`core · ActionMcpConfig`, `voice-openai · OpenAIVoiceProviderOptions`), and the package whose entry declaration leg b deletes. The marker is a fresh sentence per run, added in a scratch `git worktree` of the commit under test. It is held-out: any documented root export of a section must pass in its place.
**Signal:**
- **a · carries-the-edited-sentence:** each section's built root page (`docs/reference/api/<slug>/index.html`) carries the sentence added to its export's comment. 27 of 27.
- **a · site-builds:** `FSD_API_REFERENCE=1 docusaurus build` exits 0. It builds the packages' types itself.
- **b · fails-naming-the-package:** with `packages/mcp/dist/index.d.ts` deleted, the same build (types not rebuilt) exits non-zero and its output says `cannot read @flow-state-dev/mcp`.
**Anti-game:** a hollow pass reads the generator's Markdown, TypeDoc's JSON, or the site config, all of which can hold the sentence while no page shows it. The check reads only the built HTML's text (tags, scripts and styles removed), and only each section's root page, so a marker that lands on some other page doesn't count. The marker carries the run's stamp, so a page left over from an earlier build can't carry it. Each read is floored: an empty built site is CAN'T TELL, not PASS.
**Model:** n/a
**Run:** `pnpm tsx goals/api-reference/follows-the-doc-comment/run.mts` (commit first: the scratch tree is HEAD)
**Controls:** `GOAL_CONTROL=main` runs the same check on `origin/main` (`GOAL_BASE` names another ref), which has no generator. It must FAIL `a · carries-the-edited-sentence` on 27 of 27 and `b · fails-naming-the-package`.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-12 | 00be18b2 | n/a | PASS | 27 of 27 built root pages carry their marker (two of them types); with `packages/mcp/dist/index.d.ts` deleted the build exits 1 naming `@flow-state-dev/mcp`. Read 302 built HTML pages. |
| 2026-11-12 | origin/main 23ef519e (`GOAL_CONTROL=main`) | n/a | FAIL (expected) | `a · carries-the-edited-sentence` 0 of 27 (no built page for any section); `b · fails-naming-the-package`: the build passed with the declaration deleted. The site itself built. |
| 2026-11-13 | 38bd45b6 | n/a | PASS | Generation moved into a docs plugin. 27 of 27 again; leg b exits 1 naming `@flow-state-dev/mcp`. Read 302 built HTML pages. Control on origin/main 23ef519e re-run: FAIL on 27 of 27 and on leg b, as expected. |
