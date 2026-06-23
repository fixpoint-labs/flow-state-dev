---
"@flow-state-dev/core": minor
---

Prompt-file base directories can now be resolved independently of the process working directory. The `/prompt-file/node` subpath exports two composable helpers: `moduleDir(importerUrl, relative?)` returns the calling module's directory (or `undefined` when a bundler has rewritten `import.meta.url` to a virtual URL), and `resolveBaseDir(candidates, { expect? })` returns the first candidate directory that exists and contains the `expect` probe path, throwing a diagnostic that lists every candidate when none qualifies. Together they replace the fragile "anchor at `process.cwd()`" idiom for flows that must import correctly from any entry point — `fsdev run` at the repo root, test runners, and bundled Next.js runtimes alike. `loadPromptFile` and `createPromptLoader` are unchanged; their docs now state the resolution rule.
