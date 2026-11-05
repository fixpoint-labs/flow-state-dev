---
"@flow-state-dev/fsdev": minor
---

`fsdev` now loads `fsdev.config.ts` / `fsdev.config.mts` itself on any Node 22, so the config and the files it imports use extensionless relative imports (`./src/flows/chat/flow`) and your `tsconfig` path aliases (`@/...`) like the rest of the app, with no tsx, no `allowImportingTsExtensions` and no Node 22.18 requirement; `jiti` is now a runtime dependency, and `fsdev.config.js` / `.mjs` load with a plain Node import as before (FIX-2451). The app's runtime lives in one file: default-export `createFlowState(...)` from `fsdev.config.ts`, which both `fsdev` and the app's route import, and mount it in Next.js with one optional catch-all route, `src/app/api/flows/[[...path]]/route.ts` exporting `GET, POST, PATCH, DELETE` from `createNextHandler`, which also answers the bare `/api/flows`.

Docs: apps/docs/docs/getting-started/quick-start.md, apps/docs/docs/getting-started/your-first-flow.md, apps/docs/docs/getting-started/installation.md, apps/docs/docs/getting-started/project-structure.md, apps/docs/docs/getting-started/setting-up-models.md, apps/docs/docs/getting-started/existing-project.md, apps/docs/docs/cli/configuration.md, packages/cli/README.md, packages/next/README.md
