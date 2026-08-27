# docs/atlas

Design documents meant to be read as rendered pages rather than as markdown. An
atlas is one self-contained HTML file — inline CSS, no build step — that opens
from a checkout or from GitHub's raw view. Reach for it when the argument needs
layout: diagrams, comparisons, a navigation rail.

This directory is also published to GitHub Pages by
`.github/workflows/pages.yml`, which uploads `docs/atlas` as the site root.
`conductor.html` is the entry point; `index.html` redirects the bare URL
there.

These merge. That is what separates them from specs, which are point-in-time and
stay on a never-merged spec PR (BP-037). An atlas describes a shape we mean to
keep, so it lives on `main` and is updated in place. Being internal, it may cite
issue identifiers; anything under `apps/docs/` is published and may not.

## Contents

- `conductor.html` — the Conductor meta-harness: what it is, how a run works,
  and the threads still open. GitHub Pages entry (`index.html` redirects here).
- `workforce.html` — the other intended harness: Layer 2 conventions on the
  same substrate, persistent agents, not this cycle. Triangulates so Conductor
  does not harden a coding-only Layer 1.

Note, not a task: the framework architecture atlas
(`docs/internal/framework-atlas.html`, on its own branch) is the same kind of
artifact and would belong here.
