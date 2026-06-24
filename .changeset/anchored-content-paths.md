---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
---

Resource `contentFile` and file-path `contentTemplate` values can now carry the declaring module's anchor: pass `{ path: "./report.prompt.md", importerUrl: import.meta.url }` and the server resolves the path relative to that module first, falling back to the working directory when the anchor is unusable (bundler-rewritten) or the file isn't there — so resources load the same files whether the process starts in the app directory, the repo root, or a test runner. Bare-string paths keep their working-directory resolution unchanged. When an anchored path matches no candidate, the error names every path tried.
