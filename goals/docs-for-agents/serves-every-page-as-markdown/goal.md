# docs-for-agents › it serves every page as Markdown

**Issue:** FIX-2700
**Outcome:** A coding agent pointed at the docs reads them as text. Every docs page is served as clean Markdown at its URL plus `.md`, and `/llms.txt` lists every page with a link to that Markdown, from the next deploy on.
**Input:** today's docs and guides, built by the production site build, plus one held-out page the run adds before building (`fixtures/held-out.mdx`: a `Figure`, a table, an admonition and a code tab under `<Tabs>`). The check never names a page: swapping the corpus for any other set of pages must still pass a correct build.
**Signal:** for every built HTML page that holds a docs article (`theme-doc-markdown`), at the URL its canonical link gives:
- **markdown-exists:** the build has that URL plus `.md` (a URL ending in `/` takes `index.md`). 100% of pages.
- **no-jsx:** outside code, the Markdown has no component tag, import, export or `{…}` expression. 100%.
- **prose-matches:** the Markdown's words match the HTML article's text to within 2% (a drawing counts as its description; a link's target, a fence's language and list numbers are syntax). 100%.
- **listed:** `llms.txt` links that Markdown URL. 100%.
- **held-out-passes:** the held-out page is among the pages graded and passes all four.
**Anti-game:** a hollow pass would read the plugin's config, its list of routes, or the Markdown it meant to write. The check reads only the build output: it walks every HTML file and looks for each one's twin, so a page the step forgot is a miss, not an omission. The page set is floored (`tell.over`): a build with no docs pages is CAN'T TELL. The prose check compares against the rendered HTML, not the MDX source, so a twin that is the source with components still in it fails `no-jsx`, and one that drops text fails `prose-matches`. Generated-index category pages and the landing page have no docs article and no Markdown source, so they are not graded; there are none of the first today.
**Model:** n/a
**Run:** `pnpm tsx goals/docs-for-agents/serves-every-page-as-markdown/run.mts` (commit first: the scratch tree is HEAD)
**Controls:**
- `GOAL_CONTROL=main` runs the same check on `origin/main` (`GOAL_BASE` names another ref), which serves no Markdown. It must FAIL `markdown-exists` on 100% of pages (and so `held-out-passes`).
- `GOAL_CONTROL=tampered` builds the commit under test, then spoils three pages' output: a component appended to one page's Markdown, half the text cut from another's, a third's entry dropped from `llms.txt`. It must FAIL `no-jsx`, `prose-matches` and `listed`, each on exactly its one page.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-13 | f994c2b4 | n/a | PASS | 193 docs pages of 213 built HTML files (the held-out page included): each has its `.md` twin, no JSX outside code, worst prose drift 0.67% (limit 2%), all listed in `llms.txt`. A separate `FSD_API_REFERENCE=1` build also served and listed all 90 generated API pages, the trailing-slash root pages as `index.md` (not graded by this run). |
| 2026-11-13 | origin/main 0e6c4f38 (`GOAL_CONTROL=main`) | n/a | FAIL (expected) | `markdown-exists` 193 of 193 pages (100%), so `held-out-passes` too. The site built. |
| 2026-11-13 | 306646c5, the same change before its rebase onto main (`GOAL_CONTROL=tampered`) | n/a | FAIL (expected) | `no-jsx`, `prose-matches` (43.6%) and `listed` each fail on exactly the one page spoiled for it; nothing else fails. |
