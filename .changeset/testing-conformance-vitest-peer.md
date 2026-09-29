---
"@flow-state-dev/testing": patch
---

`@flow-state-dev/testing` now declares `vitest` as an optional peer dependency. The `@flow-state-dev/testing/conformance` entry point imports `vitest` when it loads, so install `vitest` alongside it to use that subpath; the package root does not need it (FIX-1431).
