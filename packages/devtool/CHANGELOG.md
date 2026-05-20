# @flow-state-dev/devtool

## Pre-1.0 history

Captured from the project's pre-Changesets development log (root `changelog.md`,
deleted on FIX-653). Entries are listed newest-first.

### 2026-04-11 — DevTool: `fsdev dev` + `@flow-state-dev/devtool` (FIX-261)

New package. Ships pre-built DevTool static assets and exports `getAssetPath()` so the CLI's `fsdev dev` command can serve them from a single port. The build pipeline builds the DevTool Vite app (`apps/devtool`) and copies the output into this package. The CLI lists `@flow-state-dev/devtool` as an optional peer dependency.
