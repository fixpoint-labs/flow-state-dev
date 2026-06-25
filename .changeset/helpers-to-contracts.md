---
"@flow-state-dev/contracts": minor
"@flow-state-dev/core": patch
---

Move the pure, dependency-free helpers `deepEqual` / `looseDeepEqual`, `mapLimit`, and the string-case utilities (`camelToKebab`, `normalizeTagName`) out of `@flow-state-dev/core` into `@flow-state-dev/contracts`, alongside the item taxonomy.

`@flow-state-dev/core/helpers` re-exports them from the same paths, so this is **non-breaking** for existing consumers. Browser packages can now value-import these shared utilities from the zero-dependency layer (`@flow-state-dev/contracts/helpers`) without pulling core's heavy runtime, and there is one canonical copy instead of per-package duplicates.
