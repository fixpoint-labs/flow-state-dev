---
"@flow-state-dev/core": minor
"@flow-state-dev/testing": minor
---

Three ergonomics additions that remove app-side boilerplate:

- `@flow-state-dev/core` now exports `mapLimit(values, maxConcurrency, mapper)` — bounded-concurrency async fan-out (preserving input order) for use inside a handler, where `.parallel` (which fans out blocks) doesn't fit.
- `.md` prompt templates get four auto-registered filters — `fsd_keyValues`, `fsd_list`, `fsd_table`, `fsd_json` — so a typed object, array, or table renders inside the template without pre-flattening it in TypeScript. The `prompt` composers gain a `table()` formatter and a `section({ title, level })` form for nested headings.
- `@flow-state-dev/testing` adds `unmockedGeneratorPolicy: "default"` plus an `unmockedDefault` fallback script to `testFlow` / `createMockModelResolver`, so an unmocked generator yields a caller-supplied default instead of throwing or emitting empty output.
