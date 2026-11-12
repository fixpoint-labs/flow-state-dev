# Docs revamp

Working files for the rewrite of the user docs. Nothing here is published: the pages live in this
folder until the release that carries kits, and move under `apps/docs/` through the release-docs
process.

| File | What it is |
| --- | --- |
| [`WRITING-BRIEF.md`](./WRITING-BRIEF.md) | How to write a page: page types, the outline, the moves, figures, the checks |
| [`pilot/what-flow-state-is.md`](./pilot/what-flow-state-is.md) | Pilot: the first page of Start |
| [`pilot/tasks-and-boards.md`](./pilot/tasks-and-boards.md) | Pilot: a concept page |
| [`pilot/workers.md`](./pilot/workers.md) | Pilot: a concept page |
| [`pilot/figures/`](./pilot/figures) | The three figures, redrawn to the figure rules: the exemplars |
| [`figures/FIGURES.md`](./figures/FIGURES.md) | The figure rules: what each mark means, the key, canvas sizes, light and dark, the lint rules |
| [`figures/render.sh`](./figures/render.sh) | Renders a figure as the site draws it, light and dark, into [`figures/rendered/`](./figures/rendered) |
| [`specs/epics/FIX-2696/SITEMAP/`](../../../specs/epics/FIX-2696/SITEMAP/README.md) | The page plan: every page of the new site, with its contents, questions, figures, examples and sources |
| [`pages/`](./pages) | Pages written through the brief's writing loop, in the order of its queue, with their figures in `pages/figures/`. First: [`blocks.md`](./pages/blocks.md) |
| `pages/*.facts.md` | A page's fact sheet: every fact the page states, with file and line, collected before drafting (step 1 of the loop). The page states nothing that is not on it. Never published |
| [`readmes/`](./readmes) | Each published package's cut README: an install line, one example, a link to its API reference section. They replace `packages/*/README.md` at cutover; until then an edit to a long README lands in its cut copy too (`scripts/check-cut-readmes.mjs`) |
| [`scripts/check-docs-page.mjs`](../../../scripts/check-docs-page.mjs) | Word budget, banned words, em-dashes, table length, code titles |

## The pages are written for the release that carries kits

They describe Workforce, the harnesses and Claude Code as kits an app installs:

```ts
kits: [workforce({ directory: "./workforce" }), harnesses({ workspace }), claudeCode()]
```

Those kit factories are specified and not built. Before a page moves under `apps/docs/`, reconcile
these against what shipped:

- The `kits: [...]` snippets in `what-flow-state-is.md` and `workers.md`, and each kit's config keys.
  The specs disagree on whether `workforce(...)` needs a model (`model` in `docs/architecture/kits.md`,
  `agent: { model }` in the FIX-2627 spec); the pages show `directory` alone.
- `harnesses({ workspace: { root, sourceRepo, baseRef } })` from `@flow-state-dev/harness-manager/kit`:
  the page shows today's `WorkspaceConfig` shape; the kit specs give `{ root, repositories, setup }`,
  `{ root, source, setup }` or a workspace host. Reconcile the keys.
- `tools: [search, fetch]` in the researcher file in `what-flow-state-is.md` works only where the app's
  tool catalog has both names.
- "A file the kit can't use stops the app from starting and names the file" in `workers.md`.
- The kit names in `pilot/figures/layers.svg`.
- Every link. The pages link to the planned site structure, and most targets do not exist yet.

## Moving a page to the site

1. Fix the links for the page's real location.
2. Nothing to do for figures drawn to [`figures/FIGURES.md`](./figures/FIGURES.md): the page
   already uses the site's `Figure`, and the SVG carries no styles. `pages/blocks.md` and its
   figure predate that; FIX-2701 brings them over.
