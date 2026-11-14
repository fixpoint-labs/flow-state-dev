---
"@flow-state-dev/workforce": minor
"@flow-state-dev/harness-manager": minor
"@flow-state-dev/claude-code": minor
"@flow-state-dev/codex": minor
"@flow-state-dev/cursor": minor
---

Workforce and the coding harnesses install as kits (FIX-2627).

- **workforce:** `workforce` (`@flow-state-dev/workforce/kit`) installs workforce with one config object: `createFlowState({ kits: [workforce({ agent: { model } })] })`. It reads the app's `workforce/` folder, builds every worker, and serves one copy of each worker flow and the roster flow. Every file in the folder is used or refused: a file workforce doesn't read, or one a reader can't load, stops the app starting, named. Two slots take what other kits and the app add: `workerFlows` (worker flows, built on the installation by `workerFlow(…)`) and `uses` (capabilities for the agent and coordinator flows the kit builds). Config: `agent`, `coordinator`, `consult`, `routines`, `github`, `generated` (the app's `workforce.gen.ts`), `taskChainLimit`, `messages`, `projectCoordinator`.
- **workforce:** `readWorkforceFolder` (`./loader`) is the kit's folder reader.
- **harness-manager:** `harnesses` (`@flow-state-dev/harness-manager/kit`) requires workforce and declares a `harnesses` slot of harness values. It contributes `coder`, one coding worker flow every coding worker names in `flow:` and picks its harness for in `harness:`, and serves the `harnesses` flow's `readiness` view, one entry per harness filled. Its policy is config: `workspace`, `defaultHarness`, `review`, `pullRequests`, `judge`, `checks`, `project`, `runTimeoutMs`, `logReadiness`. `codingDrainBudgetMs` gives the shutdown wait for `dispatchDrainTimeoutMs`. An app with a coding flow of its own switches `coder` off with `harnesses(…).without(workforce.slots.workerFlows, "coder")`. The package root never imports workforce.
- **harness-manager:** `Harness`, one coding harness as a value: `{ id, label?, agent, readiness, pass, usage?, models? }`. `CODER_FLOW` is on `./browser`.
- **codex:** `codexHarness(options?)`. **cursor:** `cursorHarness(options?)`, Cursor's `"default"` model unless the options name one.
- **claude-code:** `claudeCode()`, a kit: it fills the harness slot with Claude Code (and, with `{ plan: true }`, `claude-code-plan`) and serves the collections a run records into.

Docs: apps/docs/docs/workforce/overview.md (the kit, its folder's claim, its two slots), every Workforce page that installs workforce, apps/docs/docs/orchestration/harness-manager.md (the harness kit, the harness value, the coding worker flow's config, readiness), apps/docs/docs/api reference entries for the kits, packages/workforce/README.md, packages/harness-manager/README.md, packages/claude-code/README.md, packages/codex/README.md, packages/cursor/README.md
