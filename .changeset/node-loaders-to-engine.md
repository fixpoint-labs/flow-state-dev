---
"@flow-state-dev/core": major
"@flow-state-dev/engine": minor
---

Move the node-only filesystem loaders out of `@flow-state-dev/core` into `@flow-state-dev/engine`, so `core` carries only isomorphic code and the `fs`-backed loaders live with the node execution runtime.

- `@flow-state-dev/core/prompt-file/node` → `@flow-state-dev/engine/prompt-file` (`loadPromptFile`, `createPromptLoader`, `moduleDir`, `resolveBaseDir`, and their option/loader types).
- `@flow-state-dev/core/resource-template/node` → `@flow-state-dev/engine/resource-template` (`loadResourceTemplate`, `createResourceTemplateLoader`, `ResourceTemplateLoadError`).

The isomorphic parsing surfaces are unchanged and stay in core: `@flow-state-dev/core/prompt-file` (`parsePromptFile`, `definePromptFile`) and `@flow-state-dev/core/resource-template` (`parseResourceTemplate`, `renderResourceTemplate`). **Migration:** update imports of the two `…/node` subpaths to the `@flow-state-dev/engine` paths above. No behavior change.
