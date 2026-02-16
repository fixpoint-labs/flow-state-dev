# Wave 1.f - Streaming Runtime (Canonical Wave F)

## 1. Objective

Implement canonical Phase 1 request-stream runtime primitives in `@flow-state-dev/server`: response emission with monotonic sequence numbers, SSE event framing/encoding, and resume/replay utilities for `Last-Event-ID` and `starting_after`.

## 2. Canonical Inputs

Primary authority for this wave:

1. `../preperation/planning/PHASE_1_BUILD_PLAYBOOK.md`
2. `../preperation/architecture/IMPLEMENTATION_PLAN.md` (Wave F: F0-F4)
3. `../preperation/architecture/STREAMING.md` (request stream lifecycle, event envelope, replay rules)
4. `../preperation/architecture/SERVER_AND_CLIENT.md` (resume semantics and endpoint contracts)
5. `../preperation/architecture/ARCHITECTURE_OVERVIEW.md` (request stream as Phase 1 correctness channel)
6. `docs/waves/wave-1/wave-1.e.md` (context/store handoff assumptions)

Conflict rule:

- if this wave plan conflicts with `../preperation/architecture/*`, architecture docs win.

## 3. Scope

### In scope

- response emitter runtime in `packages/server/src/streaming/response-emitter.ts`
- SSE framing helpers in `packages/server/src/streaming/sse.ts`
- stream event encoding in `packages/server/src/streaming/encode-event.ts`
- request stream resume parsing and replay helpers in `packages/server/src/streaming/resume.ts`
- streaming barrel exports in `packages/server/src/streaming/index.ts`
- server package root export wiring for streaming APIs
- wave docs/changelog updates and streaming-focused unit tests

### Out of scope

- route handlers or HTTP endpoint integration (Wave H)
- full action execution orchestration (Wave G)
- optional user stream runtime persistence/fanout (Phase 2+)

## 4. Dependencies

- Wave 1.e context/stores are available for request/session state persistence primitives.
- Core item/content/stream event contracts from Wave 1.b are stable.

## 5. Task Plan

### W1F-T0: Lock forward-only UI baseline decisions (F0)

Purpose:

- Confirm Wave F planning references the forward-only AI Elements/shadcn baseline and does not impose retroactive implementation on Waves A-E.

Files:

- `docs/waves/wave-1/wave-1.f.md` (execution note)

Acceptance criteria:

- wave plan acknowledges F0 as policy lock and keeps runtime implementation scope focused on streaming modules.

### W1F-T1: Implement response emitter (F1)

Purpose:

- Provide canonical request-stream event emission with monotonic `sequence_number`, deterministic request event ids, and item/resource lifecycle helpers.

Files:

- `packages/server/src/streaming/response-emitter.ts`

Acceptance criteria:

- request events emitted with strictly increasing `sequence_number`
- request stream event id format `${requestId}:${sequence_number}`
- helper APIs emit canonical request lifecycle and item/content lifecycle events
- request streams emit `fsd:resource_update` items for all scope mutations (`request|session|user|project`)

### W1F-T2: Implement SSE framing and event encoder (F2)

Purpose:

- Convert canonical stream events to named SSE frames with stable `id/event/data` formatting.

Files:

- `packages/server/src/streaming/sse.ts`
- `packages/server/src/streaming/encode-event.ts`

Acceptance criteria:

- named `event:` matches canonical event type
- `id:` generation follows request/user stream cursor format
- encoded frames include JSON `data:` payload with required event fields

### W1F-T3: Implement resumable replay helpers (F3)

Purpose:

- Parse resume cursors and replay request stream history consistently.

Files:

- `packages/server/src/streaming/resume.ts`

Acceptance criteria:

- parse `Last-Event-ID`
- parse `starting_after`
- enforce precedence: `starting_after` over `Last-Event-ID`
- replay request events by `sequence_number` and request identity

### W1F-T4: Wire streaming exports (F4)

Purpose:

- Expose streaming runtime APIs through server package boundaries.

Files:

- `packages/server/src/streaming/index.ts`
- `packages/server/src/index.ts`

Acceptance criteria:

- streaming modules exported via server package root
- no cross-package leakage into client/react boundaries

### W1F-T5: Add tests and wave artifacts

Purpose:

- Prove streaming correctness and keep Wave 1.f traceable.

Files:

- `packages/server/test/streaming*.test.ts`
- `docs/waves/wave-1/wave-1.f-journal.md`
- `docs/waves/wave-1/wave-1.f-changelog.md`
- `changelog.md`

Acceptance criteria:

- tests cover sequence monotonicity, SSE encoding shape, cursor parsing, and replay filtering
- wave artifacts capture command evidence and deliverable mapping

## 6. Deliverables And Verification

| Deliverable | Evidence path(s) | Verification command(s) | Pass criteria |
|---|---|---|---|
| Response emitter implemented | `packages/server/src/streaming/response-emitter.ts` | `pnpm --filter @flow-state-dev/server test` | sequence/order/id and resource update emission tests pass |
| SSE framing + encoder implemented | `packages/server/src/streaming/sse.ts`, `packages/server/src/streaming/encode-event.ts` | `pnpm --filter @flow-state-dev/server test` | encoded frames contain canonical id/event/data fields |
| Resume/replay helpers implemented | `packages/server/src/streaming/resume.ts` | `pnpm --filter @flow-state-dev/server test` | cursor parsing and replay selection tests pass |
| Streaming exports wired | `packages/server/src/streaming/index.ts`, `packages/server/src/index.ts` | `pnpm -r --if-present typecheck` | workspace typecheck passes with streaming exports |
| Wave artifacts updated | `docs/waves/wave-1/wave-1.f-*`, `changelog.md` | manual review | docs and changelog entries present |

## 7. Wave Gate Checklist

- [x] `pnpm --filter @flow-state-dev/server typecheck` passes
- [x] `pnpm --filter @flow-state-dev/server test` passes
- [x] `pnpm -r --if-present typecheck` passes
- [x] `pnpm -r --if-present test` passes
- [x] contract spot-check completed against:
  - `../preperation/architecture/IMPLEMENTATION_PLAN.md` Wave F
  - `../preperation/architecture/STREAMING.md`
  - `../preperation/architecture/SERVER_AND_CLIENT.md`
- [x] `docs/waves/wave-1/wave-1.f-changelog.md` updated
- [x] `docs/waves/wave-1/wave-1.f-journal.md` updated
- [x] `changelog.md` updated with Wave 1.f summary

## 8. Definition Of Done

Wave 1.f is done when:

- request-stream events can be emitted with canonical sequence/id rules
- SSE framing/encoding is deterministic and standards-compatible
- resume parsing and replay cursor logic supports both `Last-Event-ID` and `starting_after`
- streaming APIs are exported for downstream execution and route integration waves
- verification evidence is captured in tests and wave artifacts

## 9. Handoff To Wave 1.g

Wave 1.g may assume:

- response emitter and replay helpers are available for execution runtime integration
- request stream encoding/framing contracts are implemented and test-covered
- server package exports streaming primitives for execution and route layers
