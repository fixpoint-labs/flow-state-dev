---
"@flow-state-dev/workforce": patch
"@flow-state-dev/fsdev": patch
---

Custom flow kinds and blocks register from the file tree. `fsdev gen` walks `workforce/flows/workers/`, `workforce/flows/channels/` and `workforce/blocks/` and writes a module exporting `kinds`, `channelKinds` and `blocks` — the maps `hireWorkforce`, `channelInstances` and a task board already take — so no per-kind or per-block startup line is needed. `--check` fails when the committed module and the tree disagree. The walk ships from the new `@flow-state-dev/workforce/codegen` subpath as `discoverWorkforceCode` and `renderWorkforceCode`, and `validateSegment` is now published from `./loader`. Discovery is a build step: nothing scans the tree while an app runs, and a hand-passed `kinds` map keeps working unchanged (FIX-1357).
