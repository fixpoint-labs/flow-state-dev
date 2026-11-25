---
"@flow-state-dev/workforce": patch
---

`fsdev gen` now registers `.mts` and `.cts` code files in a workforce folder: worker flows, blocks and resource modules, wherever it registers `.ts` and `.tsx` (FIX-2914). The kit already accepted them, so such a file started the app but was left out of `workforce.gen.ts`, and nothing said so. The generated file imports them as `.mjs` and `.cjs`, the specifiers TypeScript and bundlers resolve back to the source file.

Docs: apps/docs/docs/reference/workforce-folder.md ("`fsdev gen` registers only `.ts` and `.tsx`, so a `.mts` or `.cts` code file … no worker can name it" becomes: `fsdev gen` registers `.mts` and `.cts` too) and apps/docs/docs/catalog/workforce/the-workforce-folder.md ("`fsdev gen` registers every `.ts` and `.tsx` file …" names all four extensions).
