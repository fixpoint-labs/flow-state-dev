---
---

Internal (docs): the Conductor Atlas lands as a rendered page at `docs/atlas/conductor.html` (LAB-68). No package surface changes.

Conductor's design was spread across epic notes and journal entries, none of which could show the thing whole — a dozen sections, the phase model, and the still-open threads all argue better with layout than in prose. The atlas is one self-contained HTML file with inline CSS and no build step, so it opens from a checkout or from GitHub's raw view.

It merges, which is what makes it a new directory rather than another spec. `docs/atlas/` is for design documents that describe a shape we mean to keep, updated in place on `main` — as opposed to a spec, which is point-in-time and stays on its never-merged spec PR (BP-037). `docs/atlas/README.md` states the distinction and lists what is in the directory.
