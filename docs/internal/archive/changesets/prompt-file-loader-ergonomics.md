---
"@flow-state-dev/core": minor
---

Reduce prompt-file boilerplate two ways. A generator's `prompt` slot now accepts a whole `PromptFile` directly (`prompt: loadPromptFile(...)`), expanding its `user` / `caching` / `maxTokens` / `temperature` / `name` / `description` into the config with the same override precedence as `...definePromptFile(pf)` — so the spread is optional. And `createPromptLoader(baseDir, options?)` (on the `/node` subpath) captures an absolute base directory plus shared `partialsDir` / `filters` once and returns a `load(relPath)` function, dropping the repeated `import.meta.url` argument at each call site. Also exports an `isPromptFile` type guard.
