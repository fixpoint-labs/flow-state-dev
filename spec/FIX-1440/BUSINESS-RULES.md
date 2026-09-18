# FIX-1440 · Business rules

## The removal is total on the read surface

| When | Then | Proved by |
|---|---|---|
| A client calls `GET /api/flows/sessions/:id/children` after this lands | The router does not recognise the path; the request 404s as an unknown route, not as an empty list | Route-table test asserting `list_session_children` is absent from `parseFlowRoute` |
| A consumer imports `ChildSessionSummary` or `ChildSessionStatus` from `@flow-state-dev/engine` or `@flow-state-dev/client` | The build fails — the type is gone, not deprecated | `pnpm typecheck` across the workspace; the corpus checker reports 0 in the removal scope |
| A host passes `maxChildSessionListLimit` to `createFlowApiRouter` | TypeScript rejects the unknown option | Typecheck; the option is deleted from `CreateFlowApiRouterOptions` and `RuntimeConfig` |
| A `useSession()` caller reads `.childSessions` or `.childSessionsStale` | The property does not exist on `UseSessionResult` | Typecheck + the React hook's own suite, with the child-sessions spec file deleted |
| Someone greps the published docs for the children endpoint | No published page documents it; no sidebar entry is orphaned and no in-page anchor dangles | Docusaurus build with `onBrokenLinks: throw`, plus a link audit over the anchors named in PLAN.md |

## The dispatch path is untouched

| When | Then | Proved by |
|---|---|---|
| A board seat with `dispatcher({ type: "task" })` drains two rows | Each row runs in its own derived session, distinct from the drain's, settles `completed`, and carries the held-out salt | `goals/task-board/hands-a-row-to-a-worker-in-its-own-session` — the **same** check, unedited, still green |
| A `{ key }` dispatch is retried after the first attempt created the session | The second dispatch adopts the existing record rather than minting a second | `packages/engine/test/context/detached-child.test.ts` (renamed with the module), adoption cases unchanged |
| Two sessions of one principal dispatch the same key | They derive different session ids; neither can adopt the other's | Same suite — the per-parent-session separation case |
| A store lists sessions with no `parentage` option | It narrows to top-level, so a dispatched run does not appear in a flat session listing | `session-parentage-listing.test.ts` and both adapter suites, unchanged |
| `livenessOf` is asked about a request outside the caller's descendant chain | It answers not-live | `packages/engine/test/context/liveness-read.test.ts`, unchanged |

## The rename changes names, not bytes

| When | Then | Proved by |
|---|---|---|
| The derived-session module is renamed | Every derived session id is byte-identical to the one the old code produced | The determinism cases in the renamed suite, which pin the id for fixed inputs |
| A run is in flight across the upgrade and retries | It re-enters the session it started, not a second one beside it | Same — the `dsx_` prefix and hash material are unchanged (D2) |
| A reader greps the repo for `child session` or `childSession` after this lands | Matches appear only in changelogs and internal records, never in live code or published docs. `parentSessionId` is **not** covered by this rule — it keeps its name (D2) | `spec/FIX-1440/evidence/classify-substrate.mjs`, re-run at implement time |

## Failure taxonomy

| Failure | Shape | Handling |
|---|---|---|
| A consumer outside this repo calls the deleted endpoint | 404 from the router | Documented in the changeset as a breaking removal; pre-1.0, no shim |
| A published doc links to a removed anchor | Docusaurus build failure | Caught in CI, not at runtime; the anchors at risk are enumerated in PLAN.md |
| The rename misses a call site | Typecheck failure | Not a runtime risk; the corpus checker's totality assertion catches a missed *file* |
| A derived id changes | An in-flight run mints a second session, and its board row waits out a lease | Prevented by D2's constraint that the prefix and hash material do not move; pinned by the determinism cases |

## Acceptance criteria

1. `GET /sessions/:id/children` and every symbol listed in `SPEC.md` are gone from the published packages.
2. No published page or package README teaches enumerating a session's children; the Docusaurus build passes with broken links throwing.
3. `goals/task-board/hands-a-row-to-a-worker-in-its-own-session` passes **unedited**.
4. `pnpm typecheck` and `pnpm test` pass across the workspace.
5. `node spec/FIX-1440/evidence/classify-substrate.mjs` reports 0 files in the removal scope.
6. `FIX-1045` and `FIX-1097` cancelled; `FIX-1086`, `FIX-1171` and `FIX-1121` re-scoped per D3.
