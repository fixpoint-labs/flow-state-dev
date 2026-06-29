# FIX-664: Storage Strategy Review — Implementation Spec

> **Linear issue:** [FIX-664](https://linear.app/fixpoint-labs/issue/FIX-664) — Storage strategy review: re-evaluate store backends given evolving access model (subscribe, graphs, RAG) and hosting dimensions
> **Type:** Design / strategy decision document (Design · Open Question · Feature)
> **Status:** Spec draft — necessity verdict *Build as scoped*
> **Deliverable:** This document. The issue asks for "a documented strategy," not a feature. The spec resolves the eleven open questions, sets the framework's storage posture, and spawns a small set of scoped follow-up issues. It builds no adapters itself.

---

## 1. TLDR

**One sentence:** The framework already has the right bones (a `StoreRegistry` of eleven separately-implemented stores, a `CapabilitySlot` composition seam, and a backend-swappable `subscribeToEvents` contract); the strategy is to *publish contracts and formalize that seam* — opinionating per-hosting-dimension defaults — rather than name one "recommended stack" or absorb streams/vectors/graphs into the records contract.

**Concrete deliverables (this spec):**

- **Decide the storage posture:** *contracts-first, composition-by-slot, opinionated defaults per hosting dimension.* (§3, §4.1)
- **Name the recognized store concerns** and which are framework-level contracts vs. capability-level vs. user-land. (§4.2)
- **Publish the backend support matrix** (records / streams / vectors / blobs / edges × Postgres / SQLite / Mongo / Valkey-Redis / NATS / SurrealDB / memory), with tier (first-class / community / niche) and the honest hosting-dimension gradients. (§4.3)
- **Publish the composition matrix** — recommended store composition per hosting dimension (local / single-host / cloud-distributed / serverless-edge). (§4.4)
- **Resolve the eleven open questions** from the issue with a position and rationale each. (§4.5)
- **Bless "app-owned relational tables alongside FSD stores"** as a documented pattern (the FIX-772/774 answer), not a framework abstraction. (§4.6)
- **Spawn scoped follow-ups:** vector-store capability shape (feeds FIX-142), events-as-a-slot (reconciles FIX-362 with FIX-569), Valkey/NATS stream adapters behind `subscribeToEvents` (when scale demands), and a persistence-overview docs page. (§5, §8)

**Size estimate:** **Large** (strategy + docs + follow-up issue creation). No code lands in this issue; the implementation cost is downstream in the spawned issues. The *document* is Medium; the decisions it commits the project to are Large in consequence.

---

## 2. Overview

The framework's storage story was historically framed as "Postgres is the production default; Mongo/Upstash/SurrealDB/SQLite are alternative single-engine adapters." Three forces broke that framing: the access model grew past records (subscribe, pub/sub, journals, vectors, future graph edges); Postgres is fine-but-stretched (JSONB rewrite pain, serverless cold-start, LISTEN/NOTIFY ceiling); and "one adapter implements every store" turned out to be a convenience, not a contract.

This spec re-establishes the storage posture from first principles, grounded in (a) what the codebase *already* implements, (b) what the related-issue landscape has *actually landed* vs. merely proposed, and (c) how every comparable durable-execution runtime in 2026 structures persistence. The conclusion is that the framework's existing shape is correct and under-exploited: it should lean into contracts + a composition seam, not converge on a single engine or grow the records contract to host every concern.

Link: [FIX-664](https://linear.app/fixpoint-labs/issue/FIX-664).

---

## 3. Background & Research

### 3.1 What the codebase already implements (ground truth)

The issue under-counts the current surface. As built today (`packages/engine/src/stores/types.ts:678`):

- `StoreRegistry` is **eleven** separately-implemented stores, not six: `session`, `request`, `user`, `org`, `activeRequests`, `content`, `resourceState`, `checkpoints`, `traces`, `suspensions`, `leases`.
- A **composition seam already exists.** `resolveProfileStores` (`packages/engine/src/flowstate/resolve-slots.ts`) resolves a `CapabilitySlotMap` of slots — `primary` plus forward-compatible `blobs` / `queue` / `scheduler` — onto the flat registry, failing fast when an adapter doesn't declare a slot's capability. Today `primary` resolves ten sub-stores all-or-nothing and the other slots back nothing, but the machinery to compose multiple adapters *is present and tested for the fail-fast path.*
- **`subscribe` is already a store contract, and already backend-swappable.** `RequestStore.subscribeToEvents(requestId, options): AsyncIterableIterator<RequestStreamEvent>` plus `getEvents(fromSequence?)` landed with FIX-569 (`docs/internal/design/store-live-tail.md`). Memory uses an in-process bus, SQLite/filesystem poll, Postgres uses LISTEN/NOTIFY (signal-only, single channel, dedicated pool, PGlite→poll fallback). The design doc *already names the migration path*: "When operators outgrow [LISTEN/NOTIFY], the next move is Redis pub/sub or NATS JetStream behind the same `subscribeToEvents` interface."
- **`DeltaStoreOps`** (`types.ts:203`) — `patchField` / `incField` / `pushToArray` / `deleteField`, CAS-guarded — is implemented by every persistent adapter, with different strategies per engine: Postgres uses native JSONB operators; SQLite and filesystem read-mutate-rewrite the record under CAS. No adapter silently degrades to a plain full-record overwrite; the verb contract is honored everywhere, only the execution differs.
- **No vector contract exists.** Memory rides on `ContentStore` + `ResourceStateStore` keyed by `(scopeType, scopeId, resourceKey)`.
- **Asymmetry to note:** traces are durable on SQLite/filesystem but **in-memory only on Postgres** (`store-postgres/src/index.ts`), undocumented.

### 3.2 What the related-issue landscape actually says

Filtering the ~25 related issues by *landed vs. proposed vs. speculative* changes the picture materially:

- **Landed (treat as facts, not proposals):** subscribe/live-tail (FIX-569); delta verbs (FIX-405); dedicated `request_items` table fixing 78× TOAST bloat (FIX-657); content/state separation into `ContentStore` + `ResourceStateStore` (FIX-298, FIX-347); Vercel pool hygiene + deferred schema init (FIX-415, FIX-437); Postgres + SQLite adapters (FIX-84, FIX-297); **Reactive Blackboard via plain `forEachBackground` over a resource collection, deliberately needing no bus (FIX-345)**; and the trading-desk production drivers FIX-772 (moved to Postgres + an **app-owned relational model layer** — typed tables, repository, versioned migrations, sharing one DB with the FSD store) and FIX-774 (a real transaction ledger + idempotent ingestion on that layer).
- **Specced-but-not-built (commitments-in-waiting):** vector storage (FIX-142, *Todo/High*, which **explicitly defers its backend decision to this issue**); keyword/FTS5 retrieval (FIX-410); EventStore-config split (FIX-362, must be reconciled with FIX-569); cross-flow `.notify(topic)` bus (FIX-441, pluggable, in-process v1); schema versioning (FIX-146).
- **Speculative (low weight):** the pub/sub umbrella (FIX-149), journal (FIX-134 — and FIX-142 flags its current substrate as wrong), RAG package (FIX-72), exploratory SurrealDB adapter (FIX-86), generic perf (FIX-148), unblocked-but-unstarted Mongo/Upstash adapters (FIX-83, FIX-85).

Two load-bearing signals: (1) **FIX-345 proves the access model's "reactive/stigmergic" demand is already satisfied on existing primitives** — a strong argument *against* growing a pub/sub bus inside the store contract. (2) **FIX-772/774 already voted** with production code: resources for agent-facing / streaming / projection state; **app-owned relational tables for the system of record.** The framework question they hand up is narrow and concrete — *is "app-owned tables alongside FSD stores" a blessed pattern?* — not "should the store contract become a relational ORM."

### 3.3 How comparable durable runtimes structure persistence (industry, 2025–2026)

Verified against primary sources. Two patterns dominate, and the framework already sits on the right side of both.

| Runtime | Pluggable persistence contract? | Stream/event vs. record/state separated? | Default(s) |
|---|---|---|---|
| **Temporal** | Yes — `DataStoreFactory` / `customDatastore`; persistence store ≠ visibility store | Yes — event-sourced append-only history; current state replayed, never snapshotted | Cassandra/Postgres/MySQL; SQLite dev-only ([docs](https://docs.temporal.io/temporal-service/persistence)) |
| **LangGraph** | Yes — `BaseCheckpointSaver` ABC + conformance suite; separate `BaseStore` ABC | Yes — `BaseStore` (cross-thread memory, *with vector search*) distinct from checkpointer; streaming independent of persistence | Postgres in prod; SQLite local; Redis option ([docs](https://docs.langchain.com/oss/python/langgraph/persistence)) |
| **Mastra** | Yes — `MastraCompositeStore` routes **per-domain** adapters (memory/workflows/observability/scores) | Yes — `transient: true` chunks stream but bypass storage | LibSQL default; Postgres/Upstash/Mongo/D1/etc. ([base.ts](https://github.com/mastra-ai/mastra/blob/main/packages/core/src/storage/base.ts)) |
| **Vercel WDK** | Yes — "Worlds" adapter system (managed / self-host Postgres / community) | Yes — **streams bypass the event log**, Redis-backed; event log is state source of truth ([streaming](https://workflow-sdk.dev/docs/foundations/streaming)) | `world-vercel` managed default |
| **Inngest** | Partly — SQLite default, Postgres option | Yes — event-stream / queue / state-store are three distinct planes | SQLite default; Postgres + Redis ([self-host](https://www.inngest.com/docs/self-hosting)) |
| **Restate** | **No** — self-contained embedded log (Bifrost) + RocksDB | Unified into one log (counterexample) | Embedded only |
| **Cloudflare** | **No** — managed SQLite Durable Objects; Queues separate | Yes — Queues / `waitForEvent` separate from DO SQLite | Platform-managed |

Five of seven publish a *pluggable contract*; six of seven *separate the stream concern from the record concern*. Mastra's per-domain composite store is almost exactly FSD's capability-slot model. LangGraph's `BaseStore`-with-vector-search is the precedent for keeping vectors a *separate optional store*, not an attribute on records. The two non-pluggable systems (Restate, Cloudflare) are vertically-integrated platforms, not embeddable frameworks — they don't transfer to FSD's "bring-your-own-host" position.

### 3.4 Backend technology findings (verified, 2026)

- **Postgres-all-in-one:** Records — yes, unconditional. Vectors — pgvector ≥0.8.2 is production-credible to ~1–10M vectors (≤50M with `pgvectorscale`); 2000-dim HNSW cap rarely bites. Durable streams — use a **table + `SELECT … FOR UPDATE SKIP LOCKED`**, *not* LISTEN/NOTIFY. LISTEN/NOTIFY is a **wake-up nudge only**: 8000-byte payload cap, no durable replay, single-primary fan-out, a global commit lock that serialized three Recall.ai outages (fix only in PG19, not GA until ~Sept 2026), and it **breaks through transaction-mode poolers** so it's unavailable in exactly the serverless shape. **Apache AGE is not a credible default** — per-PG-version release lag (PG16 stuck on v1.6.0), large issue backlog, and absent from managed PG (Neon/Supabase/RDS-standard). Model edges relationally; treat AGE as a power-user upgrade.
- **NATS JetStream:** Apache-2.0, governance settled (the 2025 Synadia/CNCF dispute resolved with trademarks to the Linux Foundation, repos/domain with CNCF, neutral governance). Durable ordered streams with resumable cursors, KV-with-CAS+watch, Object Store, subject-hierarchy pub/sub — a genuine fit for the streaming/notify concern. Two caveats: **no in-process embed for Node** (Go only — Node runs it as a sidecar over TCP/WS), and it is the **weakest serverless fit** (long-lived connections, no official HTTP request/response gateway). Home turf is single-host and K8s.
- **Redis-shaped:** post-fracture, the OSS answer is **Valkey 9.0 (BSD, Linux Foundation)** — Streams + Pub/Sub + `valkey-search` vector GA. **Upstash** (HTTPS REST) is the clean serverless option (per-request, no socket). **Redis 8 under the AGPLv3 option is fine for an *adapter*** — you link a permissive client (`ioredis`), not Redis source, so the network-copyleft never reaches framework or user code; flag it in docs for AGPL-averse shops. Avoid Garnet (no Streams), KeyDB (dormant), Dragonfly (BSL, weaker vector) as defaults.
- **MongoDB:** `$set`/`$inc`/`$push` map 1:1 to `DeltaStoreOps`; `findOneAndUpdate` + a version field is native atomic CAS — the single strongest structural fit for the records concern. Change streams structurally beat LISTEN/NOTIFY (resume tokens, 16 MiB events, durable replay). But change streams **require a replica set even single-node** (oplog, keyfile, hostname config — more than `docker run`), and **Atlas Vector Search is Atlas-managed only** (not self-host Community). SSPL doesn't reach a shipped adapter (driver is Apache-2.0); the friction is packaging/optics.
- **SurrealDB:** genuinely multi-model (records + graph + vectors + LIVE SELECT) in one engine; BSL-1.1 converting to Apache (2030), free for production. But young/fast-breaking major cadence (3.0 GA Feb 2026), beta SurrealKV, a recurring fsync-durability critique, a LIVE-query auth CVE history, and TiKV-cluster ops for horizontal scale. **Defensible niche all-in-one for local/single-host; not a credible default.**

### 3.5 Necessity verdict — *Build as scoped*

This is a Design/Open-Question issue whose explicit deliverable is the strategy document. The necessity gate's value here is not "should the doc exist" (it should) but "does the strategy resist absorbing surface the framework doesn't need." It does, deliberately:

- It keeps **streams/pub-sub out of the records contract** (FIX-345 shows primitives suffice; only *events* need subscribe, which already exists as a swappable contract).
- It keeps **vectors a separate optional store**, not an attribute on records (LangGraph precedent; avoids forcing every adapter to grow a vector leg).
- It **defers graph edges entirely** (no landed demand; AGE not mature; model relationally).
- It **blesses app-owned relational tables as docs, not a framework abstraction** (FIX-772 already proved this in production).
- It **opinionates defaults per hosting dimension** instead of inventing a new all-in-one engine dependency.

The "build" is a decision document plus a handful of scoped follow-ups — it adds load-bearing vocabulary (the concern taxonomy, the composition posture, per-dimension defaults) that shapes how every future store issue is reasoned about, and it unblocks FIX-142, which is *waiting on this decision*. That is a legitimate "build as scoped."

### 3.6 Key Decisions & Ramifications (top 5)

1. **Posture: publish contracts + formalize the existing capability-slot seam; do not name one "recommended stack."**
   *Alternative rejected:* converge on a single engine (Postgres-only, or SurrealDB all-in-one).
   *Ramification:* locks the framework into the industry-dominant pattern (Temporal/LangGraph/Mastra/Vercel), keeps every hosting dimension serviceable, and makes "which backend" a deployment choice. Cost: the framework must maintain *contracts* and a small set of first-class adapters, and document composition rather than hand users one blessed answer. Rules out the simplicity of a single-stack story.

2. **Streams/subscribe stay a swappable contract (`subscribeToEvents`); pub/sub does NOT become a `DeltaStoreOps` verb or a store-level bus.**
   *Alternative rejected:* add `subscribe(scope, path)` to `DeltaStoreOps`, or unify all stream-shaped surfaces under one `StreamStore`.
   *Ramification:* keeps the records contract small and keeps cross-flow notify (FIX-441) a *separate pluggable bus*, consistent with FIX-345's evidence that fan-out works on primitives. When Postgres LISTEN/NOTIFY is outgrown, a Valkey or NATS adapter slots behind the *existing* interface. Rules out a unified stream abstraction now (revisitable if three+ stream surfaces converge).

3. **Vectors become a separate optional `VectorStore`-shaped capability resolved through the slot model — not an attribute on records.**
   *Alternative rejected:* an indexable `vector` attribute on scope records / a flag on the records adapter.
   *Ramification:* unblocks FIX-142 with a shape (pgvector / sqlite-vec / valkey-search per adapter; embedding provider stays a capability/utility, out of the store). Adapters that can't do vectors simply don't fill the slot. Locks vectors as opt-in; rules out "every records adapter must implement search."

4. **Bless "app-owned relational tables alongside FSD stores" as a documented pattern (shared pool/DB, versioned migrations), not a framework abstraction.**
   *Alternative rejected:* grow the store contract into a relational/ORM system of record.
   *Ramification:* answers FIX-772/774 directly — resources for agent-facing/streaming/projection state, app tables for the system of record — without the framework owning a relational layer. Cost: a documented criterion ("resource vs. table") and guidance on sharing the pool; pushes atomic-cross-record-transaction concerns (FIX-854) to the app tier for now.

5. **Defaults are per-hosting-dimension, not global; first-class adapter set stays small (Postgres, SQLite, memory), with Valkey/Upstash, Mongo, NATS, SurrealDB tiered as community/niche.**
   *Alternative rejected:* one global default adapter; or first-classing every candidate.
   *Ramification:* honest about the gradients (Postgres great in cloud, painful in serverless-edge; SQLite perfect local, impossible distributed) and bounds maintenance to a small blessed set. Rules out promising production support for niche engines; community adapters carry a clear support tier.

---

## 4. Technical Design — the strategy

### 4.1 Posture (the headline decision)

**The framework publishes store *contracts* and a *composition seam*, ships a small set of first-class adapters, and opinionates *defaults per hosting dimension* — it does not mandate one stack, and it does not grow the records contract to host streams, vectors, or graphs.**

Mechanically this means leaning into what `resolve-slots.ts` already started: concerns that genuinely diverge by backend become independently-composable capability slots; concerns that don't stay under `primary`.

### 4.2 Recognized store concerns and where each lives

| Concern | Contract level | Status | Notes |
|---|---|---|---|
| **Records** (session/user/org/request state, CAS + `DeltaStoreOps`) | Framework store contract (`primary` slot) | Landed | The core; Postgres/SQLite/memory today |
| **Checkpoints / suspensions / leases / active-requests** | Framework store contract (`primary`) | Landed | Execution-runtime state; stay with records |
| **Content blobs** (`ContentStore`) | Framework store contract; candidate for `blobs` slot | Landed (under `primary`); slot reserved | Formalize the `blobs` slot for S3-compatible (§5.4) |
| **Streams / events** (persist + `getEvents` + `subscribeToEvents`) | Framework store contract; candidate `events` slot | Landed (on `RequestStore`); split reserved | Reconcile FIX-362 split with FIX-569 (§5.3) |
| **Vectors** (similarity search) | **Separate optional `VectorStore` capability** via slot | Proposed (FIX-142, deferred here) | pgvector / sqlite-vec / valkey-search; embedding provider stays a capability |
| **Keyword / FTS** | Capability/utility (`utilities-keyword-search`), not a core store | Proposed (FIX-410) | FTS5 index lifecycle hooks on write path |
| **Cross-flow pub/sub topics** (`.notify`) | **Separate pluggable bus**, not the store | Proposed (FIX-441) | In-process v1; out-of-process adapters later |
| **Graph edges** | **Deferred — model relationally / app-owned** | Not started | No `EdgeStore` now; revisit if demand lands |
| **Relational system-of-record** | **App-owned tables (documented pattern), not framework** | Landed in trading-desk (FIX-772/774) | Shared pool/DB; "resource vs. table" criterion in docs |

### 4.3 Backend support matrix

Tiers: **First-class** (framework-maintained, production-supported, in the test matrix) · **Community** (shipped/accepted, best-effort) · **Niche** (exploratory, documented caveats).

| Backend | Records | Streams/subscribe | Vectors | Blobs | Edges | Tier | Honest hosting gradient |
|---|---|---|---|---|---|---|---|
| **In-memory** | ✓ | ✓ (bus) | — | ✓ | — | First-class | Test/dev only |
| **SQLite** (`store-sqlite`) | ✓ (read-mutate-rewrite deltas) | ✓ (poll) | sqlite-vec (proposed) | ✓ | — | First-class | Perfect local/single-host; impossible distributed |
| **Postgres** (`store-postgres`) | ✓ (JSONB deltas) | ✓ (LISTEN/NOTIFY *wakeup*) | pgvector | ✓ | relational/AGE-optional | First-class | Great single-host & cloud; painful serverless-edge; NOTIFY is wakeup-only |
| **Valkey / Redis** (proposed) | KV CAS (Lua/WATCH) | ✓ (Streams + Pub/Sub) | valkey-search | — | — | Community | Trivial single-host; Upstash-REST for serverless; default to Valkey/BSD, Redis-8-AGPL flagged |
| **MongoDB** (FIX-83) | ✓ (`$set`/`$inc`/`$push`, `findOneAndUpdate` CAS) | ✓ (change streams, durable/resumable) | Atlas Vector (Atlas-only) | GridFS | — | Community | Cloud/Atlas sweet spot; replica-set cost self-host |
| **Upstash** (FIX-85) | KV CAS | Pub/Sub over SSE | Upstash Vector (sibling) | — | — | Community | The serverless/edge answer (HTTP REST) |
| **NATS JetStream** (proposed) | KV CAS | ✓ (Streams + KV-watch + pub/sub) | — | Object Store | — | Community (streams) | Single-host & K8s strong; sidecar for Node; weak serverless |
| **SurrealDB** (FIX-86) | ✓ | ✓ (LIVE SELECT) | ✓ (HNSW) | — | ✓ (RELATE) | Niche | All-in-one local/single-host; young; TiKV ops for scale |

### 4.4 Composition matrix (recommended per hosting dimension)

Defaults are recommendations, not mandates. Each dimension lists the **default** and a **scale-up** path that stays behind the same contracts.

- **Local dev** — *Default:* SQLite (`primary`) + in-memory bus for subscribe. *Why:* zero-infra, embedded, dev/prod parity on the records contract. *Vectors:* sqlite-vec when FIX-142 lands. Correctness > scale.
- **Single host** (Railway / Fly / VPS) — *Default:* Postgres (`primary` + pgvector for the vector slot), LISTEN/NOTIFY for subscribe. *Scale-up:* add Valkey or NATS for streams/notify behind `subscribeToEvents` if fan-out grows. One DB covers records + vectors + wakeup; lowest ops surface.
- **Cloud / distributed** (K8s / ECS) — *Default:* Postgres for records + vectors; **Valkey (or NATS JetStream) for streams/pub-sub** behind the events contract once cross-instance fan-out and durable replay matter (LISTEN/NOTIFY's global-commit lock is the documented ceiling). *Alternative:* MongoDB for records (change streams give durable resumable events in one engine) + Atlas Vector. Bring-your-own-DB.
- **Serverless / edge** — *Default:* Postgres via HTTP driver (Neon/Supabase pooler) for records + pgvector; **Upstash (REST) for streams/notify** — the only clean fit for the no-long-connection constraint. *Avoid:* LISTEN/NOTIFY (breaks through poolers), self-host NATS/Valkey from functions (connection model fights ephemerality). This is the dimension where the one-binary thesis breaks and composition earns its keep.

### 4.5 Resolution of the eleven open questions

1. **Should `subscribe(scope, path)` become a `DeltaStoreOps` verb?** **No.** Subscribe stays the `RequestStore.subscribeToEvents` contract (stream-shaped), not a records verb. Records are CAS field-path mutations; subscription is a stream concern with different backends.
2. **Unify stream-shaped surfaces under one `StreamStore`?** **Not now.** Keep events/items/trace/journal as bespoke contracts on the stores that need them. Revisit only if three+ surfaces demonstrably converge; premature unification would couple unrelated retention/ordering semantics.
3. **Where do vectors live?** **A separate optional `VectorStore`-shaped capability**, resolved through the slot model, implemented per-adapter — *not* an attribute on records. Embedding provider stays a capability/utility. (Feeds FIX-142.)
4. **Do graph edges deserve an `EdgeStore`?** **No — defer.** No landed demand; model edges as relational adjacency (recursive CTEs) or app-owned tables; multi-model engines (Surreal) fold them into records in the niche case. Revisit when a concrete graph requirement lands.
5. **Prescribe compositions or only publish contracts?** **Both, layered:** publish contracts + a composition seam, *and* document recommended compositions per hosting dimension with opinionated defaults. Mandate nothing.
6. **Single default per hosting dimension?** **Yes — see §4.4.** SQLite local, Postgres single-host/cloud, Postgres+Upstash serverless, with named scale-up paths.
7. **Where does Redis fragmentation leave us?** **Default to Valkey (BSD) for self-host, Upstash for serverless; build against RESP via a permissive client; offer Redis-8-AGPL as supported-but-flagged.** Don't pick Dragonfly/Garnet/KeyDB.
8. **Is JetStream strong enough to replace LISTEN/NOTIFY in the Postgres adapter?** **No — it sits *alongside*, as its own adapter behind `subscribeToEvents`, not inside the Postgres adapter.** LISTEN/NOTIFY stays the Postgres wakeup; JetStream/Valkey become separate stream adapters when scale demands. No Node embed + weak serverless fit rule it out as a default.
9. **Alignment with the post-PMF think-engine.dev target?** **Open — see §11.** The minimum store surface that platform needs isn't documented internally; flagged for the owner.
10. **Migration story if the contract shape evolves?** Lean on FIX-146 (schema versioning / migrate-on-read). This spec's changes are *additive* (new optional slots, new adapters behind existing contracts), so no breaking migration is forced; the one reconciliation is FIX-362's events split with FIX-569's events surface (§5.3).
11. **(implied) Records system-of-record for relational data?** **App-owned tables alongside FSD stores (§4.6)**, not the store contract.

### 4.6 The app-owned relational tables pattern (the FIX-772/774 answer)

Trading-desk already settled this in production: FSD resources are the wrong fit for relational domain data (accounts, holdings, a transaction ledger). The blessed pattern:

- The app owns its own typed tables, repository layer, and versioned migrations.
- It **shares the same Postgres pool/DB** as the FSD `primary` store (one connection surface, one migration runner ordering).
- A documented **"resource vs. table" criterion** decides placement: agent-facing / streaming / projection / per-scope state → resources; system-of-record / relational / cross-entity-integrity / high-volume ledger → app tables.

This stays a *documented pattern with a thin sharing seam* (expose the pool), not a framework abstraction. Atomic cross-record transactions (FIX-854) live in the app tier under this model for now.

---

## 5. Implementation Sequence

This issue produces the **document** (this file + the Linear spec + a persistence-overview docs page) and **spawns scoped follow-ups**. No adapter code lands here. Steps are ordered; later steps are independently specced issues.

1. **Publish this strategy** (this doc) + reframe FIX-664 + post the decision summary to Linear. *Verify:* doc attached, issue reframed to problem/outcomes, In Spec Review.
2. **Add a persistence-overview docs page** consolidating §4.2–§4.4 for users (§9). *Verify:* page renders, sidebar placed, cross-linked. *Depends on:* step 1.
3. **Spawn: events-as-a-slot** — reconcile FIX-362's EventStore-config split with FIX-569's `subscribeToEvents`/`getEvents`/`persistEvents` surface; formalize an `events` capability slot so events can route to a cheaper/append-only backend. *Verify (in that issue):* a profile can place events on a different adapter than records; conformance test passes.
4. **Spawn: vector-store capability shape** — the `VectorStore` slot + per-adapter impls (pgvector first), unblocking FIX-142. *Verify (there):* `ctx.resources.search()` returns ranked results against pgvector; adapters without vectors don't fill the slot.
5. **Spawn: stream adapters behind `subscribeToEvents`** — a Valkey/Redis adapter and/or a NATS JetStream adapter, *when* a deployment outgrows LISTEN/NOTIFY. *Verify (there):* cross-instance live tail works behind the unchanged interface; LISTEN/NOTIFY path unaffected.
6. **Spawn: `blobs` slot formalization** — wire `ContentStore` to an S3-compatible adapter through the reserved `blobs` slot. *Verify (there):* content reads/writes route to S3; `primary` no longer mandatory for blobs.
7. **Spawn: app-owned-tables guidance** — a docs page + the pool-sharing seam, generalized from trading-desk (FIX-772). *Verify (there):* a second app can adopt the pattern from docs alone.

Steps 3–7 are independent of each other and can be prioritized separately; none blocks step 1 or 2.

---

## 6. Edge Cases & Error Handling (strategy-level)

| Case | Position |
|---|---|
| Adapter declares a slot it can't back | `resolveProfileStores` already fails fast with `FlowStateConfigError` — keep this for new slots (events/vectors/blobs). |
| Composed profile leaves a sub-store uncovered | In-memory fallback (historical `resolveStores` behavior) — acceptable for dev; document that production profiles must cover durable concerns explicitly. |
| Postgres LISTEN/NOTIFY outgrown | Documented ceiling; swap to Valkey/NATS stream adapter behind `subscribeToEvents`. Not an error — a planned migration path. |
| Serverless + LISTEN/NOTIFY | Breaks through poolers — strategy steers serverless to Upstash; docs must warn explicitly. |
| AGPL-averse consumer + Redis 8 | Adapter links a permissive client; document the Valkey (BSD) default and the Redis-8-AGPL flag so legal teams can choose. |
| Traces in-memory on Postgres | Pre-existing undocumented asymmetry (§3.1) — flag as a follow-up (§8), decide durable-vs-external explicitly. |
| Vectors on an adapter without a vector leg | Slot simply unfilled; `ctx.resources.search()` surfaces a typed "no vector backend configured" error, not a silent empty result. |

---

## 7. Testing / Validation Strategy

**Goal & goal check.** This is a strategy/decision document; **no real-LLM goal check applies** — there is no observable runtime behavior to exercise. Justification: the deliverable is a set of architectural decisions and docs, validated by review, not by a flow run. The *spawned* issues (steps 3–7) each carry their own goal checks and conformance tests (e.g. cross-instance live-tail behind `subscribeToEvents`; `ctx.resources.search()` against pgvector).

**Validation discipline for this issue:** human spec review (the issue moves to *In Spec Review*), plus the existing store-conformance harness (the FIX-569 per-store factory) as the template every new slot adapter must satisfy. Each follow-up that ships code routes through `fsd:tdd` (features) or `fsd:diagnose` (bugs) and reuses the conformance factory as its regression seam.

---

## 8. Non-Goals

- **No adapter code in this issue.** Mongo/Upstash/SurrealDB/Valkey/NATS adapters are downstream issues.
- **No `StreamStore` unification, no `EdgeStore`, no `subscribe` records verb** — explicitly rejected above (§4.5 Q2, Q4, Q1).
- **No framework relational/ORM layer** — app-owned tables stay app-owned (§4.6).
- **No graph strategy beyond "model relationally / defer"** — AGE stays a power-user upgrade, not a dependency.
- **Deepening opportunities flagged (follow up via `fsd:improve-codebase-architecture`):**
  - `primary` resolves ten sub-stores all-or-nothing (`resolve-slots.ts`) — the slot machinery exists but only one slot projects sub-stores; formalizing `events`/`vectors`/`blobs` slots is the deepening.
  - Traces in-memory only on Postgres — undocumented asymmetry; decide durable-vs-external.
  - `resourceState` is absent from `PRIMARY_REGISTRY_SLOTS` in `resolve-slots.ts` while present in `StoreRegistry`. Runtime coverage is fine (adapters return the full registry including `resourceState`; the in-memory fallback covers any gap), so this is a *declaration-only* asymmetry — the slot list under-reports what `primary` actually backs. Either add `resourceState` to the list or document that the list is illustrative, not exhaustive. Low-risk, but worth resolving when the events/vectors/blobs slots formalize.
  - No store-level resource-mutation log (changes live only on the SSE emitter) — a future audit/webhook seam, out of scope here.

---

## 9. Documentation Plan

**9.1 Docs change required?** **Yes — extend the existing page.** A `persistence/overview.md` page already exists (under the **Server** category, sidebar id `persistence/overview` after `server/connection-resilience`). It already covers adapters, "what gets persisted," tenant isolation, custom stores, live tail, and incremental items. The strategy's *user-facing* delta is three things it does **not** yet cover: composition-by-hosting-dimension, the LISTEN/NOTIFY ceiling-and-migration-path framing, and the resource-vs-table criterion. So this is an **EXTEND**, not a CREATE — and most of the strategy stays internal (this file).

**9.2 Surfaces affected:**
- [x] Reference docs — **extend** `apps/docs/docs/persistence/overview.md` (no new page, no sidebar change)
- [ ] Guides — not yet (a "compose your stores" guide is a follow-up once the events/vectors/blobs slots formalize)
- [x] Package READMEs — `packages/store-postgres/README.md` gets a one-line "LISTEN/NOTIFY is a wakeup, not a durable bus; the ceiling and the move to Valkey/NATS" note; `store-sqlite` README a "local/single-host fit" note
- [ ] Architecture docs — `docs/architecture/state-and-scopes.md` and `streaming.md` already describe the contracts accurately; no change needed beyond this internal strategy doc as the rationale store
- [ ] Blog — no

**9.3 Per-page plan**

```
File: apps/docs/docs/persistence/overview.md
Action: EXTEND
Existing structure to respect: the page already has "Store adapters", "What gets persisted",
  "Tenant isolation", "Custom stores" (incl. Live tail + Incremental items), "Choosing a store".
Insertion points:
  - Add a new "## Composition by hosting shape" section AFTER "Store adapters" and BEFORE
    "What gets persisted": the §4.4 matrix in user terms (local / single-host / cloud / serverless),
    defaults + scale-up paths. Replaces nothing — the existing "Choosing a store" bullets at the
    bottom become a short pointer up to this section.
  - Extend the existing "### Live tail" subsection (under Custom stores) with the LISTEN/NOTIFY
    ceiling and the "move streams to Valkey/NATS behind the same subscribeToEvents interface" path.
  - Add a "## Resource vs. table: where relational data lives" section near the end (the §4.6
    criterion), cross-linked to the trading-desk walkthrough that already demonstrates it.
Audience: a developer who has built a flow on the default store and is now choosing a production backend.
Code examples:
  - One minimal composed-profile snippet showing the slot map with a (future) separate events/vectors
    slot — ~8 lines — to make "composition by slot" concrete. Keep it aligned with the existing
    `stores: { default: { primary: ... } }` examples already on the page.
Links-out: store-postgres README (LISTEN/NOTIFY ceiling), trading-desk walkthrough (resource vs. table).
Voice notes: the term "capability slot" is already introduced on this page — reuse it, don't redefine;
  avoid "powerful/seamless"; watch em-dashes; no internal FIX-IDs in published prose.
```

**9.4 Sidebar diff summary:** **none.** The page already exists in `sidebars.ts` (`persistence/overview` under Server). No `sidebars.ts` / `sidebarsGuides.ts` edits.

**9.5 Cross-link audit:** add a link from `fundamentals/state-and-scopes` ("where state is persisted →") and from `streaming/overview` ("subscribe backends and the LISTEN/NOTIFY ceiling →") into the extended sections, if not already present.

**9.6 Docs non-goals:** no new "compose your stores" how-to guide yet (waits on slots formalizing); no per-adapter deep-dive pages for unbuilt adapters; no migration-from-X page; no second persistence page (extend, don't fragment).

---

## 10. Dependencies

- **Unblocks:** FIX-142 (vector backend decision was explicitly deferred here) → which unblocks FIX-412.
- **Reconciles with:** FIX-362 (events split must build on FIX-569's surface, not duplicate it).
- **Informed by (landed):** FIX-569, FIX-405, FIX-657, FIX-298, FIX-347, FIX-345, FIX-772, FIX-774.
- **No blocking dependency to publish this strategy.** The spawned implementation issues have their own dependencies.

---

## 11. Open Questions

1. **think-engine.dev minimum store surface (Q9).** What is the minimum store surface the post-PMF platform target needs to be plausible? Not documented internally; needs the owner's input. It may raise the priority of the events slot (step 3) or the vector slot (step 4).
2. **Greenlight the vector-store capability shape now, or wait?** FIX-142 is *Todo/High* and waiting. Recommend greenlighting the §4.5-Q3 shape (separate `VectorStore` slot, pgvector first) so FIX-142 can proceed. Confirm.
3. **Community-tier support commitment.** Mongo/Upstash/Valkey/NATS/SurrealDB are tiered *community/niche*. Confirm the project is comfortable shipping these as best-effort (clear support tier in docs) rather than first-class — this bounds the maintenance commitment.
4. **Traces on Postgres** — durable (parity with SQLite) or explicitly "use external tracing"? Small but should be decided, not left undocumented.
