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
  and the threads still open. Open this before working on the lab or
  `fsdev conductor`. The operator door is LAB-151; a first run needs
  `CONDUCTOR_REPO` pointed at another checkout (or `.` while standing in that
  checkout, with `--config` aimed at the lab).
- `framework.html` — the framework architecture atlas: every package and
  system in `@flow-state-dev`, how they compose, and the open refactor
  questions. Its counts are measured against a commit rather than maintained,
  so read them as of the branch that last touched it.
- `workforce.html` — the other intended harness: Layer 2 conventions on the
  same substrate, persistent agents, not this cycle. Triangulates so Conductor
  does not harden a coding-only Layer 1.
- `roadmap.html` — the public product horizon: three jobs (framework,
  Workforce as a component, Conductor as the user product), the clocks, and
  collaboration as wait on the existing Relay door. Sibling to Conductor and
  Workforce; owned conceptually by FSD Strategy.
