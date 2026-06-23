---
"@flow-state-dev/engine": major
---

Rename `@flow-state-dev/server` to `@flow-state-dev/engine`. The package is the execution runtime (stores, SSE streaming, HTTP routes); the real HTTP hosts are `@flow-state-dev/node`, `@flow-state-dev/next`, and `@flow-state-dev/vercel`, so the name now reads true.

**Migration:** replace `@flow-state-dev/server` with `@flow-state-dev/engine` in your imports and `package.json` dependencies (the `/testing` subpath moves with it: `@flow-state-dev/server/testing` → `@flow-state-dev/engine/testing`). No runtime behavior changes. The `serverPackageMarker` export is renamed to `enginePackageMarker`.
