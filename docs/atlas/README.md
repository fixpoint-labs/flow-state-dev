# docs/atlas

Design documents meant to be read as rendered pages rather than as markdown. An
atlas is one self-contained HTML file — inline CSS, no build step — that opens
from a checkout or from GitHub's raw view. Reach for it when the argument needs
layout: diagrams, comparisons, a navigation rail.

This directory is also published to GitHub Pages by
`.github/workflows/pages.yml`, which uploads `docs/atlas` as the site root.
Each atlas serves at `/<name>.html`; `index.html` is a listing of what is here.

These merge. That is what separates them from specs, which are point-in-time and
stay on a never-merged spec PR (BP-037). An atlas describes a shape we mean to
keep, so it lives on `main` and is updated in place. Being internal, it may cite
issue identifiers; anything under `apps/docs/` is published and may not.

## Contents

- `conductor.html` — the Conductor meta-harness encyclopedia: what it is, how
  a run works, and the threads still open. Conductor is one Workforce team
  config (coding-harness seats), not a sibling product. Product lock lives on
  the Workforce atlas.
- `framework.html` — the framework architecture atlas: every package and
  system in `@flow-state-dev`, how they compose, and the open refactor
  questions. Its counts are measured against a commit rather than maintained,
  so read them as of the branch that last touched it.
- `workforce.html` — the Layer 2 product: roster / teams + seats + rooms +
  thin helpers. Seats are flow instances from `WORKER.md`; workers are
  generators/flows with instructions + model + tools; hire needs a kinds
  map; skills and boards share one name → `BlockDefinition` list.
  W3 grows the file-convention surface (kinds + blocks scan as the code
  door). `defineAgent` / `materializeAgent` are invent-kill / placeholder —
  do not teach them as the path. Conductor is a team config on this surface.
  The page teaches the lock and the honesty tags.
- `roadmap.html` — the public product horizon. Still written in the older
  three-jobs / sibling framing; Strategy owns that rewrite. Do not read it
  as outranking the Workforce lock.
