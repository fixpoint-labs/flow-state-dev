---
---

FIX-2461: every example in `examples/` runs when copied out of the repository. `examples/README.md` lists all seven, each with its docs page, and holds the one copy-out recipe: copy the folder, rewrite `workspace:*` to `latest` in its `package.json`, `npm install`. Then the example's own `npm run typecheck`, `npm test` and `npx fsdev run …` work from the copy; each example depends on `@flow-state-dev/fsdev` for its `fsdev`. The examples are private and the CLI's published `bin` is unchanged, so this fragment releases nothing and carries the docs intent only.

Docs: apps/docs/docs/resources/searching.md, apps/docs/guides/building-a-research-team.md, apps/docs/guides/routing-with-evaluators.md, apps/docs/guides/board-lifecycle.md, apps/docs/guides/create-your-own-pattern.md (one line each where the page links its `examples/guides/` folder: to run it outside the repository, follow the copy-out recipe in `examples/README.md`)
