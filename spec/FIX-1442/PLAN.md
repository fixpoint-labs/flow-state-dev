# FIX-1442 · Plan

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan**

## Surfaces

| ID | Owning seam and direction | Grounding at researched main |
|---|---|---|
| S1 | Core/engine identity: required canonical org, exported default; retire the whole opt-in declaration/bubbling subsystem, including composition/rescue aggregation, flow mirrors and host requirement gates | `packages/core/src/types/auth.ts`, `types/scope.ts`, `types/block.ts`, `types/flow.ts`; org declarations inventory below |
| S2 | Host principal normalization and admission: one validated identity before effects; every direct/context/continuation path uses the same invariant | `packages/engine/src/transports/host/createInboundTransportHost.ts:894`, `execution/types.ts:69`, `context/createExecutionContext.ts:654` |
| S3 | Session/request/schedule producers: bind org before acceptance/indexing, carry it through race adoption, durable dispatch and recovery; shared org initialization preserves the winner; separate legacy decode from admission | Engine session/request seams; `packages/scheduled/src/{defineScheduleCollection,createResourceCollectionScheduleResolver,routes}.ts` |
| S4 | Management, lists, streams and resource reads: require exact org alongside current ownership; preserve globally keyed user scope | `packages/engine/src/routes/route-auth.ts:250`, `stores/scope-keys.ts:137`, `recovery-routes.ts` active lists and `checkInterruptedRequests`, `detectInterruptedRequests`, startup/periodic sweepers, resource reads |
| S5 | Client/React/Workforce/CLI/testing: remove client selectors, return required org, stamp defaults in trusted helpers | `packages/client/src/session-client/sessions.ts:84`, `client/src/types/index.ts`, `react/src/hooks/useFlow.ts`, `workforce/src/channel/channel-binder.ts:533`, `cli/src/commands/run.ts:287`, testing fixtures |
| S6 | Legacy detection, executable upgrade recipe and docs: quarantine unassigned records/schedules, preflight reserved-ID collisions and provide offline attribution/rename, update optional-org teaching | D1/D3 and Upgrade contract below |

Base: `4da75ad76`. [Inventory](evidence/org-inventory.json) derives 153 org-bearing tracked files; it includes tests and consumers, so it is not a claim of 153 runtime sites.

## Sequence and PR plan

```mermaid
flowchart TD
  S1["S1 · canonical identity"] --> S2["S2 · principal and admission"]
  S2 --> S3["S3 · creation and recovery"]
  S3 --> S4["S4 · reads and resources"]
  S2 --> S5["S5 · consumers"]
  S3 --> S6["S6 · upgrade and docs"]
  S4 --> G["Real-path goal"]
  S5 --> G
  S6 --> G
```

Identity leads; producers and guards ship together.

| PR id | Deliverables | depends_on |
|---|---|---|
| org-cutover | S1–S6 including offline recipe, C1–C6, docs, release notes | none |

Large: six coupled surfaces, six checks, cross-package docs. One atomic PR keeps producers compatible with their guard.

## Checks

| ID | Observable check | Rules |
|---|---|---|
| C1 | Auth resolver matrix: verified org wins over spoofed body; missing/empty/reserved rejected; default constant and warnings; per-flow precedence | BR-1–3 |
| C2 | Model-free engine integration across mint/direct paths; session race winner; interleaved first-org creation preserves prior writes; same-user org mismatch; no pre-refusal writes. Dynamic schedule create/update/index/dispatch uses its bound target org under a different gateway org; spoofed/mutated binding refuses | BR-4–6, 11, 16, 19–20 |
| C3 | Extend existing kitchen-sink/Workforce characterization: create channel with real SessionClient, wake seat, read actual org-scoped docs, capture result; default and authenticated variants | BR-3, 5, 7, 12 |
| C4 | Real router two-org matrix: CRUD, state/resources/debug, list/active requests, SSE including active-entry fallback, retry/continue/abort/interruption sweeps; user-stream auth before its existing 501; identical user under both orgs; mixed host | BR-1, 8–10, 12–13 |
| C5 | In memory/filesystem/SQLite/Postgres, prove legacy session/request/schedule refusal without writes or schedule dispatch. Prove recipe preview/apply/verify and restart, including schedule index rebuild; conflicting maps refuse. Seed a reserved-ID collision and verify stopped cutover, complete rename and retained resources/versions/markers. Drain BullMQ; stale orgless jobs refuse | BR-11, 14–16, 19, 21 |
| C6 | Type tests for required canonical org and removed client selectors; config old-key rejection; package builds/typecheck/lint; docs lexical audit | BR-17–18 |

**Goal:** C3 exercises the production router, stores, dispatcher and org resource read, without an org wrapper. Use the existing kitchen-sink/Workforce path, not a new demo. Capture assertions on stored identity, child identity and returned document value; use a deterministic read action for the invariant. If the existing demonstration requires a model to perform the wake/read, run that real model too and capture its output. Verify flow changes with `fsdev run`, then tests. Negative controls must remove the org check or seed a cross-org session and make the goal fail. C1/C4 prove the security property independently of model behavior.

**Spec evidence:** run `node spec/FIX-1442/evidence/check-org-inventory.mjs`. Its tracked-file snapshot detects new, removed or changed org-bearing lines; context/history/generated graph and nontext exclusions are explicit in the script. A planted `org-inventory-negative.ts` passed via `--extra` was rejected; removed afterward. This is lexical coverage, not a behavioral POC. No behavioral POC needed: existing principal/admission seams suffice. Explain inventory drift before updating its baseline.

## Pinned names and guardrails

- `DEFAULT_ORG_ID = "__fsd_default_org__"`; principal/session org is immutable. Tenant and user keys do not change.
- **Convergence:** validate once at principal normalization and enforce admission before effects at host/direct execution; every producer in S3 plus CLI seeds/testing passes through canonical identity validation. Guard stored reads through management/resource admission too, because an execution-only guard cannot protect GETs.
- Historical decode is permissive; admission is strict. Missing ownership cannot authorize a caller. The upgrade contract below owns offline migration.
- Preserve existing binding, flow-instance, tenant and incarnation checks; org strengthens them rather than replacing them.
- Browser body org remains ignored by authenticated servers for old wire clients; remove typed selectors now. Default-mode legacy selectors are ignored with a warning. No second organization-selection seam.

## Upgrade contract

Ship a downloadable one-shot recipe beside the persistence guide, tested on every shipped adapter. Stop writers/schedulers and drain external queues; back up; inventory unassigned records, dynamic schedules and reserved-ID collisions; preview an explicit operator map; apply resumably; verify the complete set before restarting. Rebuild schedule indexes only from attributed rows. Unmappable data stays quarantined; unmappable queued jobs stay stopped or are explicitly retired. No online callback, new public API or general migration framework.

Use public store adapters where they preserve the complete data. An organization rename also moves raw state/content, flow-isolated addresses and deletion markers; use the persistence guide's adapter-specific export/restore where ordinary enumeration hides these. Never use a generic read/write loop that loses tombstones or versions. Destination collisions stop the recipe; verify auth mapping, indexed columns and record blobs agree. Backups remain offline for rollback. These checks are part of C5, not an optional follow-up.

## Docs

Required; existing pages, no new sidebar entry. Route user-facing prose through docs-writer then docs-editor.

| Surface | Content |
|---|---|
| `docs/architecture/authentication.md`, `state-and-scopes.md`, `inbound-transports.md`, `dispatched-work.md`, `resources-and-client-data.md`, `webhook-transport.md`, `scheduled-actions.md`; contributing `architecture-reference.md` | Required canonical identity, authority, admission and inherited org; remove optional-org/no-registry teaching |
| `apps/docs/docs/server/authentication.md` (Core → Engine), `fundamentals/state-and-scopes.md` (Core → Fundamentals) | Authenticated and development recipes, machine users, user/org/tenant distinctions; link migration section |
| `apps/docs/docs/persistence/overview.md` | Extend existing offline attribution pattern with the Upgrade contract: include schedule rows/indexes and reserved-ID collision rename |
| `apps/docs/docs/server/scheduled.md`, scheduled package README | Stored target-org binding, gateway/target separation, schedule mutation admission and legacy quarantine |
| `configuration/{blocks,flow,client}.md`, `fundamentals/state-operations.md`, `resources/external-collections.md`, `advanced/error-capture.md`, `workforce/{built-in-worker,channels,documents-on-disk}.md`, guides `projects-on-org-scope.md` | Server-owned org and removal examples; system resolver migration; error diagnostics may lack org only when resolution failed or legacy data was refused |
| Core/engine/client/React/workforce/testing/CLI/node READMEs where affected | Public contract, default, migration and setup examples; check root onboarding snippets |

No auth product or skills-scope redesign. No new public migration API or CLI verb. Quarantined rows do not prevent startup. Runtime columns may remain nullable during the legacy detection window; do not add NOT NULL before attribution. Implementation changesets use pre-1.0 minor for affected breaking published packages and name FIX-1442; this spec PR needs no changeset.

## At implement time

Refresh main and re-check overlaps. #1889/FIX-1412 is merged: its optional binder parameter was expressly interim and this cutover supersedes it. FIX-906/1224 contracts and Door A scope remain constraints. FIX-1374, FIX-1403 and FIX-1443 (pentest lab org-wrapper removal) are related, not blockers; do not merge their scopes or close them implicitly. No currently identified blocking issue or open overlapping implementation PR.

## Notes from review

Initial technical/scope/docs validation folded queue migration, autonomous scans, machine-principal fallback, active-entry SSE admission and precise docs coverage. Binder org comparison stays server-owned; user-stream remains 501.

[Inventory representation feedback](https://github.com/fixpoint-labs/flow-state-dev/pull/1899#discussion_r4049236352), preserved for the implementer if reusing the spec-only evidence; its representation is not a shipping contract:

> **Spec evidence weight:** ~3.4k lines of committed snapshot (full trimmed line text per hit) will create noisy spec/impl PR diffs whenever docs or tests mention `orgId` or “optional org.” Consider baseline **path + line numbers/counts only**, a **path allowlist + grep-for-new-files**, or running the full compare on the **implementation PR** while keeping the script header-only on the spec branch. The script’s disclaimer that 153 files ≠ runtime sites is good — the artifact should match that lighter intent.

## Follow-ups

After merge, report the changed invariant to FIX-1374/1403 owners for their own scope/status decisions; do not close them implicitly. FIX-1443 retains the separate pentest-wrapper cleanup. User-scope re-keying remains a separate product decision.
