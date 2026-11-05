---
"@flow-state-dev/fsdev": minor
---

The CLI now loads a TypeScript `fsdev.config.ts` / `fsdev.config.mts` itself, so the config and the files it imports can use extensionless relative imports (`./src/flows/chat/flow`) and your `tsconfig` path aliases (`@/...`), the same way the rest of a Next.js app writes them. A `.ts` config loads on any Node 22, with no tsx, no `allowImportingTsExtensions`, and no Node 22.18 type-stripping requirement. The CLI tries Node's own import first and falls back to [jiti](https://github.com/unjs/jiti), now a runtime dependency of `@flow-state-dev/fsdev`, when Node can't load the file. `fsdev.config.js` / `fsdev.config.mjs` still load with a plain Node import.
