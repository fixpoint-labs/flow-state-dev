# @flow-state-dev/testing

## Pre-1.0 history

Captured from the project's pre-Changesets development log (root `changelog.md`,
deleted on FIX-653). Entries are listed newest-first.

### 2026-05-01 — Tier 1 flow integration test suite (FIX-487)

`mockGenerator` accepts `{ when, then }` predicate entries alongside plain steps. Predicates match by input and stay matchable on every call. `mockGenerator` now simulates the AI SDK's internal multi-step tool loop. `testFlow` accepts an optional `stores: StoreRegistry`; multiple runs sharing the same registry preserve session, journal, and resource state across calls.

### 2026-05-01 — `fsdev run` as primary CLI dev loop (FIX-490)

`@flow-state-dev/testing` no longer re-exports `createInboundTransportConformanceTests` and `createMockTransportHost` from its index — they imported `vitest` at module top level, breaking non-test consumers. Available via the new `@flow-state-dev/testing/conformance` subpath export.

### 2026-04-29 — Inbound transport adapter contract (FIX-438)

Conformance suite for `InboundTransportAdapter` implementations ships in `@flow-state-dev/testing` so future MCP / webhook / scheduled adapters plug into the same harness.

### 2026-04-26 — Org scope rename (FIX-428) [BREAKING]

Test harness seeding renamed `project` → `org`.

### 2026-02-15 — Initial scaffolding

Initial scaffolding: `testBlock`, `testSequencer`, `testRouter`, `testFlow`, `testItems`, `snapshotTrace`, `mockGenerator`. `createMockModelResolver` migrated mocks to the model boundary.
