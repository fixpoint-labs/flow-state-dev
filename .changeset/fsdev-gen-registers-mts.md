---
"@flow-state-dev/workforce": patch
---

`fsdev gen` now registers `.mts` code files in a workforce folder (worker flows, blocks and resource modules, wherever it registers `.ts` and `.tsx`), and a `.cts` code file stops the app starting, named (FIX-2914). Both used to start the app while being left out of `workforce.gen.ts`, with nothing said. The generated file imports a `.mts` module as `.mjs`, the specifier TypeScript and bundlers resolve back to the source. A `.cts` module is refused rather than registered because the generated file default-imports every module, and a CommonJS `export default` arrives there wrapped as `{ default }`. Rename it to `.ts` or `.mts`.

Docs: apps/docs/docs/reference/workforce-folder.md ("The kit accepts `.mts` and `.cts` in the same places. `fsdev gen` registers only `.ts` and `.tsx` …" becomes: `.mts` is registered like `.ts`; a `.cts` code file is refused at start-up) and apps/docs/docs/catalog/workforce/the-workforce-folder.md ("`fsdev gen` registers every `.ts` and `.tsx` file …" adds `.mts`).
