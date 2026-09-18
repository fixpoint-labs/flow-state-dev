# FIX-1442 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md)

| Boundary | Required fact |
|---|---|
| Before any new identity-bearing effect | A nonempty organization has been resolved from a trusted source |
| Before reading or changing an existing session/request | Its bound organization matches the authorized principal; existing user, tenant and flow checks also pass |
| Before using historical data | Organization attribution is known; missing attribution is never a wildcard |

## Principal and creation

| ID | When | Then | Proved by |
|---|---|---|---|
| BR-1 | A configured host/flow resolver returns a verified org | Use exactly that org; body/query/header/metadata org fields cannot override it | C1, C4 |
| BR-2 | That resolver returns null, empty/whitespace org, missing org or the reserved default | Refuse before session/request/resource/queue effects; never fall back to development identity | C1 |
| BR-3 | The framework default resolver handles a new request/session | Supply `DEFAULT_ORG_ID`; ignore legacy body org fields and warn once per host that the obsolete field was present, without logging its value. Emit one development-default warning per host initialization | C1, C3 |
| BR-4 | Trusted direct execution or a pre-resolved adapter submits an identity | Require a valid org; missing values cannot bypass validation by avoiding the resolver | C2 |
| BR-5 | Explicit creation, action auto-creation, webhook derivation or child dispatch mints a session | Persist the org before acceptance; every new session, request, active entry and durable job carries it | C2, C3 |
| BR-6 | Two creators race for one session ID | Only the winner is adopted, only under the same user/org/tenant/flow binding; no loser rebinding | C2 |
| BR-7 | A browser or Workforce client opens a channel | It provides no authoritative org. The server's principal/default creates the session; reopening requires a complete returned identity; the server checks org authorization, while the binder retains user/flow/state checks | C3 |

## Reads, dispatch and recovery

| ID | When | Then | Proved by |
|---|---|---|---|
| BR-8 | The same user requests a session or request belonging to another org | Deny read, update, delete, abort, resume, retry and stream access before emitting content or mutating state | C4 |
| BR-9 | A list, implemented stream or bulk action spans records | Filter by authorized user and org, retaining tenant and owning-flow filters. Never allow an org query to widen the principal's scope | C4 |
| BR-10 | A no-auth route reads an existing record | Its org must equal the framework default. Mixed-flow visibility rules still withhold authenticated flows; adding a default org never makes auth data public | C4 |
| BR-11 | A child, schedule, webhook, continuation or external worker executes | Carry the accepted trusted org unchanged. Revalidate stored binding before effects; never borrow org from a different session to repair an incomplete envelope | C2, C5 |
| BR-12 | An org resource is resolved, enumerated, projected or streamed | Use the session-bound org; an absent org registry is no longer a valid runtime result | C3, C4 |
| BR-13 | A user belongs to multiple orgs | User scope keeps its existing global user identity semantics. Org scope and session/request access still follow BR-8/9 | C4 |

## Upgrade and failure behavior

| ID | When | Then | Proved by |
|---|---|---|---|
| BR-14 | A persisted session/request/job or dynamic schedule has missing org | Decode for diagnosis, exclude from ordinary lists/streams and scheduler dispatch/index scans, and refuse addressed execution or access with migration guidance; do not expose content or rewrite it, including autonomous startup/recovery scans | C5 |
| BR-15 | An operator migrates legacy data | Follow the [upgrade contract](PLAN.md#upgrade-contract), including authoritative schedule attribution and index rebuild. Reject inconsistencies; unattributed data stays unavailable | C5 |
| BR-16 | An existing bound org differs from supplied trusted identity | Preserve immutable-binding refusal; no mutable session-org endpoint or first-access repair | C2, C5 |
| BR-17 | An adopter supplies an old org requirement config flag | Fail at definition/config validation with guidance that org is unconditional; remove redundant computed flags and aggregations | C6 |
| BR-18 | A typed consumer reads a successful session or execution identity | Org is required. Nullable legacy storage shapes never masquerade as admitted canonical records | C6 |

## Cutover cases

| ID | When | Then | Proved by |
|---|---|---|---|
| BR-19 | A resource-backed dynamic schedule is created, changed or fired | Persist the creating execution's verified org with its target user before accepting/indexing the schedule. Caller state cannot choose or rewrite that binding; mutation requires the bound user/org before effects. Dispatch validates and uses the stored target org, never the gateway org or the user's current org. User storage stays globally keyed; legacy rows follow BR-14/15 | C2, C5 |
| BR-20 | Two first sessions initialize the same shared org record | Create once or adopt and reload the winner; a delayed initializer cannot replace committed state or resources. Applies to the default and authenticated organizations | C2 |
| BR-21 | Upgrade preflight finds a historical organization using the new reserved default ID | Stop cutover before default-mode reads/writes. Explicitly rename the complete organization offline to an unused nonreserved ID, updating auth mapping, sessions/requests/children/schedules, org records and resource addresses while preserving versions and deletion markers; verify before reopening. Never merge it into development data | C5 |

| Failure class | Public behavior | Effects |
|---|---|---|
| Missing/invalid configured identity | 401 principal-resolution refusal, including reserved default from custom auth | No accepted request or new record |
| Existing record belongs to another org | 403 on management routes; existing binding-mismatch class on trusted execution | No content disclosure or mutation |
| Legacy attribution required | 409 migration-required for addressed public access; named failure in direct/worker paths; unauthenticated callers still fail auth first | Data preserved; lists omit affected rows; startup and periodic scans skip them |
| Invalid trusted direct input | Named validation error; HTTP 400 only if an adapter exposes that trusted-input failure | No work accepted |
| Obsolete org configuration | Construction-time migration error | Host/flow cannot start with ignored intent |

Configured machine resolvers may return `{ orgId }` and use existing `defaultUserId`; `null` cannot be repaired by that user-only fallback. The unimplemented user-stream endpoint remains 501 after normal admission; this issue does not build it. SSE must authorize both persisted records and active-entry fallback before opening.

Error wording is the implementer's; these categories and effect ordering are the contract. Organization IDs are opaque nonempty strings: reject whitespace-only values, do not trim or rewrite a valid ID.

## Acceptance

The [checks](PLAN.md#checks) prove every row: a real channel wakes a seat and reads Door A docs; authenticated requests defeat spoofing and cross-org access; preserved pre-upgrade records recover after explicit attribution.
