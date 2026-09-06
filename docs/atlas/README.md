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

- `conductor.html` — the Conductor meta-harness: what it is, how a run works,
  and the threads still open.
- `framework.html` — the framework architecture atlas: every package and
  system in `@flow-state-dev`, how they compose, and the open refactor
  questions. Its counts are measured against a commit rather than maintained,
  so read them as of the branch that last touched it.
- `workforce.html` — Layer 2 convention: one worker contract, one flow per
  worker, DMs as static sessions, groups as a board plus one session
  per subscriber, projects as dynamic sessions, talk on the dispatch spine.
  This cycle ships the page, not a Workforce runtime. Conductor does not wait.
- `roadmap.html` — the public product horizon: three jobs (framework,
  Workforce as a component, Conductor as the user product), the clocks, and
  collaboration as wait on the existing Relay door. Sibling to Conductor and
  Workforce; owned conceptually by FSD Strategy.
