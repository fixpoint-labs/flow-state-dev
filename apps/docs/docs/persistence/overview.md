---
sidebar_position: 1
---

# Persistence

flow-state.dev stores three categories of data: **scope state** (session, user, org), **resources** (content files with metadata), and **items** (the accumulated conversation log). All of this goes through a store abstraction. The server ships with an in-memory store by default. Swap it for the filesystem, SQLite, or Postgres adapter when you need data to survive restarts.

## Store adapters

You declare stores on `createFlowState` as a map of named profiles. A profile maps capability slots (typed containers for a category of storage) to adapters. Every adapter below backs the required `primary` slot — the catch-all state store for sessions, requests, users, orgs, checkpoints, content, and traces. The `blobs`, `queue`, and `scheduler` slots exist in the type but are forward-compatible: no backing store ships for them in Phase 1, so declaring them is a no-op.

| Adapter | Persistence | When to use |
|---------|------------|-------------|
| **In-memory** (default) | None — data is lost on restart | Development, testing, demos |
| **File** | Nested file tree (`.md`/`.json`) on disk | Local development with persistence, single-server deployments |
| **SQLite** | Embedded SQLite database | Single-server deployments wanting concurrency-safe writes |
| **Postgres** | PostgreSQL with `LISTEN/NOTIFY` for cross-process live tail | Production, multi-instance fleets, serverless with shared Postgres |

### In-memory (default)

The default. No configuration needed. All state, resources, and items live in memory. Fast, zero dependencies, gone when the process exits.

```ts
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";

const flowstate = createFlowState({
  flows: { myFlow },
  stores: { default: { primary: inMemoryStores() } },
});
```

### Filesystem store

Writes each scope's data into a directory on disk, surviving restarts. Resource content and resource state persist as a real nested file tree — a resource key like `notes/meeting` becomes `notes/meeting.md` (content) or `notes/meeting.json` (state), so the store directory is browsable in an editor and diffable in git. Good for local development.

```ts
import { createFlowState, filesystemStores } from "@flow-state-dev/engine";

const flowstate = createFlowState({
  flows: { myFlow },
  stores: { default: { primary: filesystemStores({ rootDir: "./.flow-state-data" }) } },
});
```

The directory layout has two halves. **Scope records** sit at the root, one directory per store: `sessions/`, `users/`, `requests/`, and `projects/`. That last one holds org records — the directory name predates the `project` → `org` scope rename and is kept as-is so existing data keeps resolving. **Resource content and state** sit under `content/` and `state/`, and there each scope gets a subdirectory named for it: `session/`, `user/`, `org/`. So a resource key like `notes/meeting` on session `s1` lands at `content/session/s1/notes/meeting.md`.

### Postgres

For production and multi-instance fleets. Stores state in PostgreSQL with `LISTEN/NOTIFY` for cross-process live tail.

```ts
import { createFlowState } from "@flow-state-dev/engine";
import { postgresStores } from "@flow-state-dev/store-postgres";

const flowstate = createFlowState({
  flows: { myFlow },
  stores: {
    default: {
      primary: postgresStores({ connectionString: process.env.FSD_DB_URL }),
    },
  },
});
```

On Vercel, use `vercelPostgresStores()` from `@flow-state-dev/vercel/store` instead — it bakes in the pool tuning and Neon client swap.

Postgres provides the concurrency safety that compare-and-swap relies on. Compare-and-swap means a write carries the version it expects to find, and the store applies it only if that version is still current — so a write built on a stale read is refused instead of silently overwriting someone else's.

Not every scope-state write carries a version. An increment, an append, or a write to one key of a record field is handed to the store as the operation itself, and the store applies it to the value it currently holds. On the built-in stores, concurrent increments and appends both land; a custom store that doesn't implement those operations takes a version-checked whole-record write instead, and one of the two is refused. Concurrent writes to one field don't combine — the second one replaces the first, and neither call reports a conflict. [State Operations](../fundamentals/state-operations.md#cas-semantics) lists which calls go which way.

### Concurrency by store

Where the comparison happens differs by store, and it is worth knowing before you pick one. Either the store compares the version and writes as one indivisible step, or it holds a lock in memory while it reads, compares and writes. What separates them is how far the guarantee reaches.

| Store | Scope state | Resource state | Guarantee covers |
|---|---|---|---|
| In-memory | Atomic in the store | Atomic in the store | This process. There is nothing outside it to cover |
| Filesystem | Under a per-key lock | Under a per-key lock | **One store instance** |
| SQLite | Atomic in the store | Atomic in the store | Every writer against the database file |
| Postgres | Atomic in the store | Atomic in the store | Every connection to the database |

The filesystem row is the one to read twice. The lock lives on the store instance, in memory rather than on disk, so it covers every write that goes through that instance and nothing past it. A second store pointed at the same directory races with the first, whether the two sit in one Node process or two. Most apps build one store and hand it to `createFlowState`, so in practice the boundary falls at the process; the instance is what actually draws it. That is fine for development, and it is not a multi-process deployment story; reach for SQLite or Postgres there.

The filesystem store also has no field-delete operation, so `deleteStateRecord` there writes the whole scope record at the version the run last read, in one attempt. Lose that race and the call returns `false` with the key still stored. Request state behaves the same way on every store, because none of them offer field delete on the request record.

The resource-state column reaches your flow code, not just callers holding the store directly. A flow mutating `ctx.resources` or a collection instance writes at the version its execution context read, so a write built on a stale read is refused and re-applied against the value that won rather than overwriting it — see [the mutation model](../state/mutation-model.md) for what that looks like from inside a flow.

Deleting a resource on any store leaves a small marker row behind instead of removing it. The marker keeps the version, which is what stops a worker holding a pre-delete version from matching the resource that later replaces it. Nothing ages a marker out — there is no sweep, no timer, no retention window — so a workload that creates and deletes many resource keys accumulates one row per deleted key.

Markers are reclaimed at exactly one moment: when a session record is **created** under a session id, the runtime clears that id's markers immediately before it writes the record. Reusing a session id therefore gives you writable resources again, rather than a session whose static resources are permanently refused. Nothing happens at delete time — while a session is merely gone, its markers are still doing their job.

A reclaimed key's version restarts at `1`, so the pre-delete guarantee above does not carry across a reused id: a worker still holding a version from the old session can match a row in the new one. And the reclamation is not fenced against a second creator racing it for the same id — the loser of that race can clear a marker inside the session that won, which lets the next ordinary write bring a deleted resource back. Neither is reachable without deliberately reusing a session id.

## What gets persisted

| Data | Where it lives | Persistence behavior |
|------|---------------|---------------------|
| **Scope state** | Session, user, org scopes | Always persisted (except request scope, which is ephemeral) |
| **Resources** | Attached to scopes | Always persisted with their scope |
| **Items** | Session item log | Persisted by default. `status` items are always transient. `state_change`/`resource_change` are transient in production. |
| **Request state** | Request scope | Lives for one action execution, then discarded |
| **Sequencer state** | Sequencer execution | In-memory only, never persisted |

## Who owns a record

Every session and request records the flow instance that created it, as `flowId`, next to the definition it came from, as `flowKind`. For an ordinary flow the two are the same string. For a flow that runs as several named copies they differ: a session started through `review-east` has `flowKind: "review"` and `flowId: "review-east"`. The owner is what the server checks before it runs, resumes, retries or reads anything under the record — [Flows](/docs/fundamentals/flows#how-an-instance-is-addressed) covers what that check refuses on each surface. The listing filter is exact: `flowId: "review-east"` returns that copy's sessions and never a record with no owner.

**Records with no owner.** A session or request whose `flowId` is absent is read as belonging to the one instance of its kind, so a database full of ordinary singleton flows needs nothing done. A collection flow with such history is different: the server cannot tell which copy a bare `review` record belongs to, so it refuses to guess. Any route, resume, or retry that reaches one of those records answers `409 { "error": "migration-required" }` until an operator attributes it. Nothing migrates automatically: attribution is a fact about your deployment, not something the framework can derive from the row.

**What else moves with the owner.** A copy's private user and org data is filed under the copy too, so the same attribution decision covers more than the two record tables. If your collection flow sets `isolateUserState` / `isolateOrgState`, or declares a user- or org-scoped resource with `flowIsolation: true` (see [Sharing state across flows](/docs/advanced/flow-isolation)), then this history moves as well:

| Cell | Where it lives now | Where it belongs |
|---|---|---|
| Isolated user or org scope state | one record keyed `<identity>:<kind>` | one record per copy, keyed `<identity>:<copy id>` |
| Isolated user or org resource state | `(user\|org, <identity>:<kind>, resource key)` | the same key with the copy's id |
| Isolated user or org resource content | the same coordinates in the content store | the same key with the copy's id |
| Deletion markers for those resources | beside the rows they fence | move with them, or the version guarantee is lost |
| Session-scoped state and content of a re-keyed child session | under the child's old session key | under its new key |

A scope record is one blob, so it moves whole — splitting fields between copies by guesswork is how the "private" data you were protecting gets mixed. And a shared record (an ordinary singleton's, or a resource declaring `flowIsolation: false`) does not move at all: it was never a copy's to begin with.

**Identity ids containing a colon or a backslash move too, whatever your flows do.** A copy id is any string you choose, so the key has to encode the `<identity>:<copy id>` pair rather than run the two strings together — otherwise two different pairs can name one cell, and one account reads another's private data. Ids made of ordinary characters encode to themselves and key exactly as they did before, which is the common case and needs nothing. An id carrying a colon or a backslash picks up a backslash in front of each one — `u:1` is now keyed `u\:1`, shared and isolated cells alike — so inventory those identities with the rest. Some identity providers issue subjects that look like this; if yours does, its old keys were the ambiguous ones, which is why they change.

The last row only applies if step 3 of the procedure below re-keys any child sessions. If the inventory finds none, note that and leave session-scoped data alone.

**Attributing owners, once.** The SQLite and Postgres stores add the nullable `flow_id` column on open, with an index, and never backfill it. Attribution is a one-time procedure you run offline, in this order:

1. **Quiesce.** Stop every process that writes to the stores: the web tier, workers, schedulers. A record attributed while a run is still in flight can be re-stamped underneath you. Back the store up, and where the adapter allows it do the work on the copy — the backup is your only rollback, so keep it offline rather than wiring it up as a fallback the running server can read. Write down the copies you actually register, retired kinds included; the mapping below is against that list.
2. **Inventory.** Count what has no owner, by kind: `SELECT flow_kind, COUNT(*) FROM sessions WHERE flow_id IS NULL GROUP BY flow_kind;` and the same over `requests`. Kinds that are ordinary singletons need nothing. Each collection kind in the list is a mapping decision you have to make: which copy each of those records belongs to (a tenant, a region, a config version, whatever distinguished them when they were written).

   If the kind isolates user or org state, or declares an isolated resource, list its cells from the table above in the same inventory. Read them from the raw rows and files, not through the server's ordinary reads: those hide deletion markers, and a resource with content but no state never shows up in a state listing at all. One line per cell is enough — `user u_12 / kind review / resource notes/a / to review-east / because <your evidence>` — and every cell needs a destination, including ones belonging to identities that no longer appear in any active session. A count of zero is a fine answer once you have looked at the store; it is not an answer you can get from a `get` returning nothing.
3. **Backfill.** Apply the mapping to both places a row keeps its owner, in one statement. The indexed `flow_id` column is what listings filter on; the `data` blob is the record the server reads back, and a later write of the whole record rewrites the column from it, so a column updated on its own reverts to `NULL` the next time the row is saved. SQLite:

   ```sql
   UPDATE sessions
   SET flow_id = 'review-east',
       data = json_set(data, '$.flowId', 'review-east')
   WHERE flow_kind = 'review' AND flow_id IS NULL AND <your predicate>;
   ```

   Postgres:

   ```sql
   UPDATE sessions
   SET flow_id = 'review-east',
       data = jsonb_set(data, '{flowId}', '"review-east"')
   WHERE flow_kind = 'review' AND flow_id IS NULL AND <your predicate>;
   ```

   Run the same predicate over `requests`, so a request never ends up under a different owner than its session. Child sessions that another flow dispatched into a collection copy are keyed by the copy that ran them; re-key those under the copy you attribute them to, or the parent's next dispatch starts a fresh child instead of adopting the old one.

   Then move the cells you inventoried, using your adapter's recipe below. Check the whole plan before you write anything: a destination that already holds data, or holds a deletion marker, is a conflict to resolve rather than a row to overwrite, and two cells whose source and destination keys chain into each other have to be moved from a staged snapshot rather than renamed one at a time. Move each resource's state and its content together — they are one thing to your users.
4. **Read back.** Re-run the inventory, and check the blob agrees with the column: `SELECT COUNT(*) FROM sessions WHERE flow_id IS NOT NULL AND json_extract(data, '$.flowId') IS NULL;` (SQLite) or `... AND data->>'flowId' IS NULL;` (Postgres) should be zero, and so should the inventory's count for every collection kind. Any remaining row still answers `migration-required`. Check the moved cells the same way: every source in your inventory has a destination holding it, and nothing is left under a kind you converted. Remove the old addresses only once you have. Then bring the writers back and read a session's state and resources through each copy before you admit traffic.

If something fails, leave the writers stopped. Before you have admitted traffic, rollback is restoring the backup. After the converted store has taken new writes it is the only correct one — don't start an older build against it.

The column names above are the SQL stores'. The filesystem and in-memory stores hold the same `flowId` field on each record and need the same mapping applied to their files, if you keep history there at all.

### Moving a copy's private data, per adapter

The stores need no new columns or directories for this — the copy's id goes into keys that already exist. What differs is how you reach the raw rows.

| Adapter | What to do |
|---|---|
| **In-memory** | Nothing. It starts empty on every restart, so there is no history to attribute. |
| **Filesystem** | User records are `users/<encoded id>.json`, org records are under `projects/`. Resources are `state/<scope>/<encoded scope id>/<encoded key>.json` and `content/<scope>/<encoded scope id>/<encoded key>.md`, marker files included. Stage a full copy of the directory, move the attributed entries with the same encoding, rewrite the `id` field inside each scope record, and leave every other byte alone. Don't follow symlinks, and stop on a directory you don't recognise. Nothing here is atomic across directories, so keep traffic stopped until the whole replacement is verified. |
| **SQLite** | `users.id` / `orgs.id` are the keys to rewrite, along with the `id` inside each row's JSON `data`. Resource rows are keyed `(scope_type, scope_id, resource_key)` — move `scope_id`, and keep the resource key, version, lifecycle and content exactly as they are. Do it in a transaction on the backup copy, reading the tables directly rather than through the store API. |
| **Postgres** | The same keys and the same transaction, on a quiesced database or a staged snapshot, in whichever schema you configured. Scope and resource payloads are JSONB and content is text; preserve them verbatim. |
| **Custom store** | Use your store's own export and restore, under the same maintenance window and the same checks. A store that can't show you its deletion markers or preserve versions can't be converted safely — that is a `migration-required` stop, not a case for a generic read-everything-and-write-it-back loop. |

Move rows, not calls. Going through the normal `set` and `delete` API mints new versions and drops markers, which is exactly the history you are trying to keep.

### When to stop

Stop the cutover, restore the backup, and change nothing when:

- A cell has no attribution you can defend, or two plausible ones. The stop condition is `migration-required` — the same one the running server raises when it meets a record with no owner. Only your records say who owned a cell; that a kind has just one copy today does not.
- A destination already holds data, or a deletion marker.
- You meet a file or a row in a layout you don't recognise.

None of these is a case for guessing. Leave the original data intact and resolve the attribution first.

## Tenant isolation

If you send a tenant id (the `x-tenant-id` header by default), session storage is namespaced by tenant automatically. Two tenants using the same session id get separate records. The isolation is per scope:

| Scope | Tenant-isolated? |
|-------|------------------|
| Session (record, state, session-scoped resources) | Yes |
| Request (history, listing) | Yes |
| User | No — shared across tenants by design |
| Org | No — shared across tenants by design |

The session store key becomes `${tenantId}:${sessionId}`; request records keep a bare `sessionId` and a separate `tenantId` that listing filters on. Persistent adapters (SQLite, Postgres) add a nullable `tenant_id` column through an idempotent migration, so upgrading an existing database needs no manual step and existing rows read back as no-tenant. Single-tenant apps that never send the header are unchanged. See [State and scopes](/docs/fundamentals/state-and-scopes#multi-tenant-isolation) for the full model.

## Custom stores

The store interface is pluggable. If you need Redis, an alternative SQL backend, or another store, implement the `StoreRegistry` shape and pass it in. The contracts are documented per-method in `@flow-state-dev/engine`. A custom store isolates by tenant the same way the built-ins do: namespace records by their `id` (already tenant-prefixed for sessions) and honor the `tenantId` field on `SessionListOptions` / `RequestListOptions` (present means exact-match, including `undefined`; absent means no filter).

A custom store also has to honor session parentage. A session can belong to another session instead of to a person — `SessionRecord.parentSessionId` carries the parent's id, and is undefined on a session someone started directly. `SessionListOptions.parentage` picks which of those a listing returns:

| `parentage` | Returns |
|---|---|
| omitted, or `"top-level"` | Only sessions with no parent |
| `"all"` | Every session, parented or not |
| `{ parentOf: sessionId }` | Only that session's children |

Omitting `parentage` narrows to `"top-level"`, which is the reverse of how an omitted `tenantId` behaves in the same object. A store that ignores the field hands back child sessions to a caller that asked for top-level ones, and nothing in the type system catches it — the field is optional. Treat a parent id of `null` the same as an absent one, and conjoin `parentage` with the other filters rather than letting it widen past them.

### Live tail

`RequestStore` exposes `subscribeToEvents(requestId, options)` so the SSE wire can serve a request started on any instance. Stores choose their own delivery mechanism:

- The in-memory store fans out from an in-process bus.
- SQLite runs one shared poll loop per request, fanned out to every subscriber and woken in-process by the write path; the filesystem store polls `getEvents(requestId, fromSequence)`.
- Postgres uses `LISTEN/NOTIFY` on a dedicated client. See `@flow-state-dev/store-postgres` for details.

### Incremental items storage

Backed adapters store items incrementally rather than inside the request record's JSONB column. The SQLite and Postgres adapters write one row per item into a dedicated child table (`request_items`); the filesystem store appends items and events to an append-only log instead. `RequestStore.persistItems` and `get` keep the same shape either way, so a flow author sees no difference. An operator does — see [Persistence cost model](/docs/server/setup#persistence-cost-model) for how each backend stores its data.

- `RequestStore.list()` does not populate `record.items` by default on any adapter; pass `withItems: true` to opt in.
- `RequestStore.countItems(requestId)` returns how many items a request holds without loading their payloads — session retention's `maxItems` check uses it so a sweep stays cheap on long histories. A custom store must implement it; the backed adapters answer with an indexed `COUNT` on `request_items`.
- Upgrade is lazy (no offline backfill), but the deploy is **forward-only**. Validate in staging before rolling out.

See the [`@flow-state-dev/store-postgres` README](https://github.com/fixpoint-labs/flow-state-dev/blob/main/packages/store-postgres/README.md#items-storage) for the schema, the optional storage-reclamation steps (`pg_repack`), and the rollback constraints.

`getEvents` accepts an optional `fromSequence` for cursor reads — omitting it returns the full log (used by completed-request replay). A custom store that doesn't need cross-process tail can implement `subscribeToEvents` as an iterator that yields the catch-up via `getEvents` and then ends; clients fall back to bulk replay for completed requests.

The exact interface may evolve. Check the `@flow-state-dev/engine` package source for the current contract.

## Looking up sessions by metadata

Some apps don't carry a session id around. The natural identity of a session is whatever combination of inputs the user just chose — a ticker and a date, a project id and a branch, a customer id and a quarter. For those apps, set `title` and `metadata` at create time and resolve sessions by filtering the list.

```ts
import { createSessionClient } from "@flow-state-dev/client";

const sessions = createSessionClient({ baseUrl: "" });

type RunKey = { ticker: string; date: string };

async function resolveSession(flowKind: string, userId: string, key: RunKey) {
  const list = await sessions.listSessions({ flowKind, userId });
  const match = list.find(
    (s) =>
      s.metadata?.ticker === key.ticker && s.metadata?.date === key.date,
  );
  if (match) return match.id;

  const created = await sessions.createSession({
    flowKind,
    userId,
    title: `${key.ticker} · ${key.date}`,
    metadata: key,
  });
  return created.id;
}
```

Server-side `metadata` filtering on `GET /api/flows/sessions` is not yet available; the route returns the full list for `(flowKind, userId)` and the client filters in memory. That's fine for local development and small-tenant use. Apps that expect hundreds of sessions per user should treat this as a deliberate ceiling and revisit when a server-side filter lands.

Note the shape of `resolveSession` above: it lists, finds nothing, then creates. Two calls that overlap both find nothing and both create, so you end up with two sessions for one key. If that matters, use the derived id instead.

### Deriving the session id from your data

When the natural identity of a session is something you already have, you can use it as the session id directly rather than looking it up.

The id has to carry everything that tells one session from another. Session storage keys off the tenant and the session id, nothing else: `userId` and `flowKind` are fields on the record, not part of the key. So inside one tenant, two users deriving the same ticker and date land on the same session, and so do two flows. The second caller gets a `409` for a session that isn't theirs, and reading that session back returns the other user's or the other flow's record, or a `403` in an app that configures authentication. Derive the id from enough to keep them apart:

```ts
const sessionId = [flowKind, userId, key.ticker, key.date].join("-");

const created = await sessions.createSession({
  flowKind,
  userId,
  sessionId,
});
```

Pick a separator your components can't contain, or hash them, so that two different component sets can't join into the same string.

Creating a session that already exists returns `409 Conflict`. On SQLite and Postgres that holds under concurrency: if two requests create the same id at the same moment, one gets `201` and the other `409`, with no window where both succeed and the second quietly overwrites the first. Treat the `409` as "someone else got there" and read the existing session.

The filesystem store gives you that among writes through one store instance. Point a second store at the same directory and both can find the id free and both write, so one record overwrites the other and both callers see a `201`. That happens whether the two stores sit in one Node process or two. It's the same per-instance limit that applies to its compare-and-swap, laid out in [Concurrency by store](#concurrency-by-store). The in-memory store holds its data in the instance, so two of them are two separate datasets rather than a race.

The tradeoff against the metadata approach is that the id becomes part of your data model. Session ids are namespaced per tenant, so two tenants using the same derived id stay separate, and you cannot change an id later without creating a new session.

The trading-desk example uses this pattern end-to-end — see the [walkthrough](/guides/trading-desk-walkthrough#session-lifecycle-and-persistence).

## Choosing a store

Pick by where you run — there's no single "recommended stack":

- **Local dev** — in-memory (default), or the filesystem store when you want data to survive restarts. Zero setup.
- **Single server** (Railway, Fly, a VPS) — SQLite or Postgres, for durable concurrency-safe writes. The filesystem store is fine for very low concurrency, but its per-request event log doesn't hold up under real load — reach for SQLite instead.
- **Multiple servers / cloud** — Postgres. You need a shared store with real concurrency semantics and cross-instance live tail (Postgres uses `LISTEN/NOTIFY`). `LISTEN/NOTIFY` is a wake-up signal with a real fan-out ceiling; at high event volume, put streaming on Redis or NATS behind the same `subscribeToEvents` interface.
- **Serverless / edge** — Postgres over an HTTP driver (e.g. a Neon/Supabase pooler). `LISTEN/NOTIFY` doesn't survive transaction poolers, so use an HTTP-based service (e.g. Upstash) for live updates.
- **Special requirements** — implement a custom store against the `StoreAdapter` interface.

### Resource vs. app-owned tables

Resources are the right home for agent-facing, streaming, and per-scope state. For a real relational **system of record** — a ledger, normalized domain entities, cross-row integrity — don't force it into resources: give the app its own typed tables and migrations, sharing the same database and pool as the store. The trading-desk example does exactly this.
