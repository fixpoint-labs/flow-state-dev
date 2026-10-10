---
"@flow-state-dev/fsdev": minor
"@flow-state-dev/workforce": minor
---

`fsdev gen` no longer depends on `@flow-state-dev/workforce`. It runs the generator a dependency of the app exports on a `./fsdev-gen` subpath (typed as `FsdevGenerator`), and `@flow-state-dev/workforce` now exports its generator there, so a Workforce app runs `fsdev gen` as before. `GenResult` reports `generator`, `entries`, `paths` and `summary` in place of the Workforce discovery lists, and `--root` defaults to the generator's own folder (FIX-1771).
