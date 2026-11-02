---
"@flow-state-dev/devtool": patch
"@flow-state-dev/shift-manager": patch
---

Pages served by `fsdev dev --app` can now run under a sub-route behind a proxy. `@flow-state-dev/devtool/react` exports `readBasePath()`, the prefix a page is served under, read from its `<base href>` (`""` at the root of its origin). Shift Manager's pages build with relative asset URLs and keep their links, history entries and API calls under that prefix, so the same build serves at `/` and at a proxy's `/shift-manager/` (FIX-2485).
