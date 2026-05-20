# @flow-state-dev/integration-tests

## Pre-1.0 history

Captured from the project's pre-Changesets development log (root `changelog.md`,
deleted on FIX-653). Entries are listed newest-first.

### 2026-05-01 — Tier 1 flow integration test suite (FIX-487)

New private workspace package. Seven scenarios drive whole flows through `runAction` against in-memory stores with mocked generators: hello-chat smoke, ask-mode happy path, tool-loop convergence, build-mode artifact, plan-and-execute, session resume, and the supervisor + task-board regression. Suite finishes in a few seconds; loop guards plus a 30s vitest `testTimeout` catch infinite-loop regressions deterministically.
