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
| [`pilot/figures/`](./pilot/figures) | The three figures, in the site's drawing classes |
| [`pages/`](./pages) | Pages written through the brief's writing loop, in the order of its queue, with their figures in `pages/figures/`. First: [`blocks.md`](./pages/blocks.md) |
| `pages/*.facts.md` | A page's fact sheet: every fact the page states, with file and line, collected before drafting (step 1 of the loop). The page states nothing that is not on it. Never published |
| [`scripts/check-docs-page.mjs`](../../../scripts/check-docs-page.mjs) | Word budget, banned words, em-dashes, table length |

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

1. Change the image line to the site's `Figure`: import the SVG, pass the short caption as
   `caption` and the text after "Description for the site's `Figure`:" as `description`.
2. Delete the `<style>` block from the SVG. The site's drawing styles replace it.
3. Fix the links for the page's real location.
