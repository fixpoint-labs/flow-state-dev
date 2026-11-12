You are writing one page for the new Flow State user docs. This directory is a read-only copy of the repository (no git history, no node_modules), except that you write your page under `out/c/`.

Your brief has three parts, below: the page brief (the page types, the outline, the rules and the word budget), the planned surface for the release these pages ship with, and the agreed model of the topic, a plain-language explanation the team settled on. Write the page from the agreed model, checked against the public surface in `packages/` (exported signatures, JSDoc, tests, `goals/`) and the planned surface. Where the model and the code disagree, the code wins, and say so in your report.

Do not read anything under `specs/`, `docs/internal/` or `out/`, and do not look for any other draft of this page. Existing pages under `apps/docs/` are fine to read for facts, voice and links.

Fit the page to its type's outline and stay under its word budget. Run `node scripts/check-docs-page.mjs <your page>` and fix every failure. If the page needs a figure, draw it as the page brief says, put it in `out/c/figures/`, and render it to look at it. Do not touch `apps/docs/`.

Report back as your agent file says, plus the page's word count from the checker.
