# Fact sheet: Resources and collections (R-08, reference, `reference/resources`)

Pass 1. Cites only: the existing pages (`apps/docs/docs/resources/*.md`), exported surface and doc comments,
tests, `goals/`. No spec was read. Rows other pages' depth passes moved here (the `→ R-08` rows in the
`*.record.md` files) are checked in section 18; every one is carried or named as dropped.

**[impl]** marks an observable behaviour I could confirm only in engine source (an HTTP route, a store key),
not in an exported doc comment. Pass 5 should confirm each by a test or a run before the page states it.

Source abbreviations (all under `/home/user/flow-state-dev/`):

| Abbr | File |
|---|---|
| `res` | `packages/core/src/types/resource.ts` |
| `coll` | `packages/core/src/types/resource-collection.ts` |
| `proj` | `packages/core/src/types/projected-resource-collection.ts` |
| `facet` | `packages/core/src/types/faceted-collection.ts` |
| `chg` | `packages/core/src/types/resource-change.ts` |
| `pat` | `packages/core/src/types/collection-patterns.ts` |
| `cproj` | `packages/core/src/helpers/client-projection.ts` |
| `edges` / `edge` / `trav` | `packages/core/src/graph/resource-edges.ts` / `edge.ts` / `traverse.ts` |
| `rtools` / `rsearch` / `rcontent` | `packages/core/src/tools/resource-tools.ts` / `resource-search-tools.ts` / `resource-content-tools.ts` |
| `vis` | `packages/core/src/types/resource-visibility.ts` |
| `reg` | `packages/engine/src/context/resource-registry.ts` [impl] |
| `keys` | `packages/engine/src/stores/scope-keys.ts` [impl] |
| `rr` | `packages/engine/src/routes/resource-routes.ts` [impl] |
| `sr` | `packages/engine/src/routes/scope-routes.ts` [impl] |
| `rt` | `packages/engine/src/routes/router.ts` [impl] |
| `ru` | `packages/engine/src/routes/route-utils.ts` [impl] |
| `rd` | `packages/engine/src/context/reactive-dispatch.ts` [impl] |
| `cl` | `packages/client/src/client.ts`, `.../resource-client/scope-resource.ts` (`cl-sr`) |
| `rx` | `packages/react/src/hooks/` (`useResource.ts`, `useResourceCollection.ts`, ...) |
| `ov` `col` `ca` `man` `sto` `prj` `edg` `rea` `sea` | `apps/docs/docs/resources/` `overview` `collections` `client-access` `manifest` `storage` `projected-collections` `edges` `reactive-blocks` `searching` |

Existing-page line numbers are the page's own line numbers.

## 0. What the page is, and the four questions

A resource is a named, schema-typed record on a scope: structured `state` plus an optional text `content` body.
A collection is a typed set of such records created at run time under a key pattern. Both are declared on blocks
or the flow and reached on `ctx.resources`. (ov:10-12, col:7-9)

The page is a Reference page: tables and signatures, no narrative. Tables from the page plan: `defineResource`
fields, storage kinds, identity, collection operations, search and edges, the manifest, HTTP and hook access,
when a resource loads.

### The four questions, per stored part

| Stored part | Who owns it | Who can see it | Where it is stored | How many exist |
|---|---|---|---|---|
| Single resource **state** | The scope instance it is declared at: the session, the user in one organization, or the organization. | Blocks on the server, through `ctx.resources.<name>`. A browser only through a `client` block. A model only through the tools its `llmReadable` / `llmWritable` flags open, narrowed per turn by the flow's `resourceVisibility`. | Resource-state store, under (scope type, scope id, resource key). Versioned: every write is a compare-and-swap on the row's version. A delete keeps a tombstone that holds the version. | One per declaration per scope instance. Two accessors that name the same definition object share one row. |
| Single resource **content** | Same as its state. | Same as state, plus `client.content.read`. | Content store, same (scope type, scope id, resource key). Not versioned: the last write replaces. | One per resource, or none until written. A declared `content` / `contentFile` / template seeds what a read returns before any write. |
| Collection **instance** (state and content) | The scope instance the collection is declared at; an owner-keyed collection adds a per-user owner (section 8.5). | As single resources, per instance; the `llmReadable` / `llmWritable` / `client` flags are collection-wide. | The same two stores, one row each per instance, at the key the pattern resolves. | Any number; bounded by `maxInstances` when set. |
| **Edges** | The resource or instance whose state holds them. | As that state. | Inside the resource's state, in an `edges` array. No separate key. | Up to `maxEdges` when set; otherwise unbounded. |
| **Facets** on a faceted collection | The instance. | As instance state. `client` projection decides the browser. | In instance state, fields `facets` and `indexedAs`. | One pair per instance. |
| **Projected collection** rows | The app. The framework stores nothing. | Whoever the app's `read` / `search` hooks answer for. | The app's own store. A per-request read-through cache holds only what the request read. | The app's. No `count()`. |
| **Write session** of a client write (`runBy`) | The writing user. | The request records name the writer. | Session and request stores, at the default write flow's session id for (scope, key, writer). | One write session per writer per resource (goals check below). |
| **Manifest** | The flow. | Any caller with a session of that flow. | Computed per call; not stored. | One per flow kind. |

Sources: res:19-25, 445-462; stores `ContentStore` and `ResourceStateStore` doc comments (`packages/engine/src/stores/types.ts:1255-1262`,
`:1450-1515`) [impl]; reg:1387-1400 (projected holds a per-request cache only) [impl]; coll:60-69, 156-170;
`goals/resources-by-scope/a-pin-is-one-line-and-no-session-is-made-to-read/goal.md` signal `b:one-session-per-writer`.

## 1. Kinds of resource ("storage kinds")

| Kind | Defined with | Handle on `ctx.resources.<name>` | Stored in | Source |
|---|---|---|---|---|
| Single resource | `defineResource(config)` | `ResourceRef` | State store + content store, one key | res:445-531, 596-690 |
| Collection | `defineResourceCollection(config)` | `ResourceCollectionRef` (`get`, `getOptional`, `create`, `getOrCreate`, `upsert`, `list`, `findBy`, `delete`, `count`, `config`, `pattern`, `scope`); each instance is a `ResourceRef` | Same two stores, one row per instance | coll:318-405 |
| Projected collection | `defineProjectedResourceCollection(config)` | `ProjectedResourceCollectionRef` (`get`, `getOptional`, `list`; no mutators, no `count`) | The app's store; nothing in the framework's stores | proj:142-241 |
| Faceted collection | `defineFacetedCollection(config)`, returns `{ collection, search, reindex, resources }` | Same as a collection (it is one) | Collection storage; two extra state fields | facet:151-165 (`FacetedCollection`), 417 |

- A collection is recognised structurally: any config with a string `pattern`. Its identity is its pattern; a `ref` on a collection is never read. `packages/core/src/types/storage-identity.ts:10-14, 20-30`.
- Scope state is a different thing: a flat object every block in the flow shares, so two blocks can collide on a field name. A resource is its own record and cannot collide. Use scope state for flags, counters and config; a resource for content with structure. ov:51-57, sto:25-54, sto:92-130.
- A resource that holds a block-private cache is safe from collisions: each is reached by name through the registry. sto:93-97.

## 2. `defineResource` fields

`defineResource(config)` returns the config plus brand types (`StateType`, `ContextType`, `ClientType`). res:596-690.
`stateSchema` is the only field besides `scope` with no default. All other fields optional.

| Field | Type | Default | What it does | Throws / refuses | Source |
|---|---|---|---|---|---|
| `scope` | `"session" \| "user" \| "org"` | none, required | Storage layer that holds state and content. | Anything else throws `defineResource() requires an explicit scope of "session", "user", or "org" (got …)`. | res:204, 622-626; ov:35-37 |
| `stateSchema` | Zod schema | none, required | Shape of the structured state. A write persists only when the result satisfies it and is an object. | A write that fails it throws and stores nothing (ov:39, ov:222). | res:259; ov:39 |
| `ref` | `string` | the first accessor the definition object appears under | Storage key and storage namespace. Independent of the accessor name on `ctx.resources`. Set it explicitly on any user or org resource you register under two accessors. | none | res:192-197; `storage-identity.ts:41-58` |
| `default` | `JsonValue` | schema's own default, then `{}` | Initial state. | none | res:260; `packages/engine/src/resources/normalize-resource-state.ts:23-46` [impl] |
| `content` | `string` | none | Initial content body. | At most one of `content`, `contentFile`, `contentTemplate`, `contentTemplateRef`: `defineResource() accepts at most one content source, got: …`. | res:261, 608-615; ov:45 |
| `contentFile` | `string \| { path, importerUrl }` | none | Content from a file. A bare string resolves from the working directory; `{ path, importerUrl: import.meta.url }` resolves against the declaring module first, falling back to the working directory. | Same one-source rule. | res:150-160, 262-268; ov:46 |
| `render` | `(content, state) => string \| Promise<string>` | none | Template function applied by `readContent()`. `readContentRaw()` returns the stored body. | `render` with `contentTemplate` or `contentTemplateRef` throws `defineResource() rejects render with contentTemplate/contentTemplateRef …`. | res:269, 616-620; ov:47, ov:265-281 |
| `contentTemplate` | `ResourceTemplate \| string \| { path, importerUrl }` | none | Role-tagged Markdown template, rendered with LiquidJS against `state`. A path resolves at server start. | One-source rule; not with `render`. | res:270-280; ov:283-285 |
| `contentTemplateRef` | `string` | none | Path of another resource whose raw content is the template. Resolved at read time: editing the template or this state changes the next read. | One-source rule; not with `render`. | res:281-287 |
| `llmReadable` | `boolean` | `false` | Opens the resource's content to `readResourceContentTool()` and the three search tools. | none | res:288; ov:289 |
| `llmWritable` | `boolean` | `false` | Opens `writeResourceContentTool()` on it. Independent of `llmReadable`. | none | res:289; `coll:148-152`; col:453 |
| `writable` | `boolean` | `true` | `false` makes every state and content write throw `FlowError` code `resource_read_only`, `retryable: false`. Also refuses `incState` and `pushState`. | none at define time | res:310; reg:195-196, 1129-1133, 2295-2299 [impl]; ov:222 |
| `secret` | `ReadonlyArray<state key>` | none | State fields that never leave the server: omitted from the client snapshot, list and get-state routes, live deltas and debug routes. A `client.data` function sees full state but a secret field in what it returns is dropped. Blocks read them through the handle. | A name not on `stateSchema`, or also in `client.expose`, throws at define time (messages: ca:164-169). | res:290-298; cproj:77-82, 108-140; ca:148-177 |
| `prefetchMode` | `"eager" \| "lazy"` | `"eager"` | When state and content load. A lazy single resource loads when the block that declares it dispatches. | A lazy single resource declared at flow level throws at `defineFlow`: `Single-resource '<key>' declared at flow level cannot be prefetchMode: 'lazy' …`. | res:312-322; `packages/core/src/flow/defineFlow.ts:1555-1566`; col:338 |
| `flowIsolation` | `boolean` | `false` | At user or org scope, `true` stores the resource per flow instance instead of shared across every flow. See section 5. | `true` at session scope throws `defineResource() rejects flowIsolation:true on session-scoped resources …`. | res:199-234, 628-632; sto:62-66 |
| `sharedToLineage` | `boolean` | `false` | Session scope only: one identity across a session and every background session it dispatches. See section 5. | `true` at user or org scope throws `defineResource() rejects sharedToLineage:true on <scope>-scoped resources …`. | res:236-258, 634-640; sto:140-163 |
| `client` | `ResourceClientConfig` | none: invisible to browsers | Browser access. Section 12. | Section 12. | res:324, 74-92 |
| `reactTo` | `ReactiveBindings` | none | Binds blocks to mutations. Only `stateUpdated` and `contentUpdated` on a single resource. Section 11. | `created` or `deleted` throws `defineResource() does not support reactTo.<kind> …`. | res:333, 651-655; chg:200-233 |
| `edges` | `true \| { vocabulary?, maxEdges? }` | none | Typed-edge graph in state. Section 10. | A non-`z.object` `stateSchema` throws `defineResource() with edges requires an object stateSchema (got …)`. | res:352, 658-690 |
| `runBy` | `"default" \| { flow: string }` | none: a client cannot write it | The flow a client's write runs through. User or org scope only. Section 12.5. | Section 12.5. | res:342, 695-760 |
| `canWrite` | `(check) => boolean \| Promise<boolean>` | none | The default write flow's own rule, run after schema and owner checks. Requires `runBy: "default"`. | Section 12.5. | res:350, 187-190 |
| `metadata` | `Record<string, unknown>` | none | `metadata.description` is the "purpose" the agent discovery manifest shows for the resource. | none | res:312; `packages/core/src/manifest/resources-source.ts:32-36` |
| `dynamic` | `never` | none | Removed. A value is a type error. | typed `never` | res:309 |
| `allowedExtensions` | `string[]` | none | Declared on the type. I found nothing in core or engine source that reads it. **Leave off the page.** | none observed | res:311 |

State of the returned definition: when `edges` is set, the framework adds `edges: Edge[]` (default `[]`) to the
`stateSchema` and to `default`, unless `stateSchema` already has an `edges` key (res:658-690).

## 3. `defineResourceCollection` fields

All fields of section 2 that make sense per instance, with these differences. coll:70-261, 410-557.

| Field | Type | Default | What it does | Throws / refuses | Source |
|---|---|---|---|---|---|
| `pattern` | `string` | none, required | Which keys the collection holds. `*` one segment, `**` any depth (last segment only), `[param]` one named segment. | Not matching `/^(?:[a-zA-Z0-9_\-.*[\]]+)(?:\/[a-zA-Z0-9_\-.*[\]]+)*$/`; no `*`, `**` or `[param]`; `**` not last. | pat:8-40; col:36-47 |
| `scope` | `"session" \| "user" \| "org"` | none, required | As single resource. | Anything else throws `defineResourceCollection() requires an explicit scope …`. | coll:99, 446-452 |
| `stateSchema` | Zod schema | required | Shape of one instance. | A write that fails it throws and creates/patches nothing (col:94). | coll:114 |
| `maxInstances` | `number` | unbounded | Cap on live instances. | `< 1` throws `defineResourceCollection() maxInstances must be >= 1`. | coll:115, 466-469 |
| `eviction` | `"none" \| "lru" \| "oldest"` | `"none"` | What `create` does at the cap: `none` throws `Namespace "<pattern>" has reached maxInstances (<n>)`; `lru` evicts the least recently accessed (`get`, `getOptional`, `getOrCreate`, `create`, patch paths count as access); `oldest` evicts the first key in the cache's insertion order. Eviction fires `onInstanceDeleted` and a `deleted` reaction with `evicted: true`. | `lru` or `oldest` without `maxInstances` throws `defineResourceCollection() eviction requires maxInstances`. With `prefetchMode: "lazy"` throws. | coll:116, 470-483; reg:1662-1674, 2354-2414 [impl]; col:238-248 |
| `prefetchMode` | `"eager" \| "lazy"` | `"eager"` | Eager loads the whole pattern prefix up front; lazy loads per key (and `list(prefix)` loads only that sub-tree). All reads are async either way. | `lazy` with any eviction but `none` throws. | coll:117-128, 476-483; reg:2000-2060 [impl]; col:250-340 |
| `prefetchWindow` | `number` | `0` | Items inlined in the session snapshot's `prefetched` list, in lexicographic storage-key order, not recency. Per-item `clientData` is included only when `client.state.read` is true. | Not a non-negative integer throws. Above 100 logs a `console.warn`. | coll:182-190, 485-497; `ru:419-500` [impl]; col:543-564 |
| `contentTemplate` / `contentTemplateRef` | as single | none | Applied to each instance. | Both set throws `defineResourceCollection() accepts at most one template source …`. | coll:130-133, 442-446 |
| `client` | `CollectionClientConfig` | none: invisible | Section 12. | Section 12. | coll:136 |
| `llmReadable` / `llmWritable` | `boolean` | `false` | Collection-wide, applied to every instance. Content tools, search tools; `llmReadable` also gates `resourceTools().readResource`, which omits `secret` fields. | none | coll:138-152; col:446-455 |
| `secret` | keys | none | As single resource. | As single resource. | coll:154-161 |
| `writable` | `boolean` | `true` | `false` refuses `patchState`, `setState`, `updateState`, `incState`, `pushState`, `writeContent`, `upsert` of an existing key, `create(..., { replace: true })` of an existing key, and `delete` (even of an absent key). `create`, `getOrCreate` and `upsert` of a missing key still succeed. Message: `Resource "<storageKey>" is read-only`; for content, `Resource "<storageKey>" content is read-only`. Code `resource_read_only`. | none at define time | coll:162-170; reg:1129-1133, 1148-1152, 1355-1358, 1700-1735, 1953-1958 [impl]; col:406-444 |
| `edges` | as single | none | Graph per instance, in that instance's state. | Non-object schema throws. | coll:172-180, 524-545 |
| `onInstanceCreated(key, state, ctx)` / `onInstanceUpdated(key, state, prevState, ctx)` / `onInstanceDeleted(key, ctx)` | functions, may return a Promise | none | Awaited by the call that caused them. `ctx` is `CollectionHookContext`: `log(message)`, `scopeType`, `scopeId`, `cell`, `orgId` (server-derived). `log` does not surface anywhere I could observe. | none | coll:32-70, 207-218; reg:1514-1524, 1789-1797, 1978-1980, 2403-2405 [impl] |
| `reactTo` | `ReactiveBindings` | none | All four kinds. Section 11. | Section 11. | coll:221-231 |
| `indexes` | `Record<name, fn \| { version, value }>` | none | Fields rows can be looked up by with `findBy`. | Name empty or containing `@` refused at define time. | coll:233-242; col:122-172 |
| `stampOrgId` | `boolean` | `false` | `create` (and the create branch of `getOrCreate`/`upsert`) writes the execution's organization into the instance's `orgId` when the caller names none. A create naming another org throws and writes nothing. An update keeps the stored `orgId`; naming another throws. | `stateSchema` must declare `orgId`: `defineResourceCollection() stampOrgId on "<pattern>" requires the stateSchema to declare orgId …`. | coll:192-206, 514-520; `packages/engine/test/resource-collection.test.ts:732-880` |
| `ownerPrivate` / `ownerWrites` | `{ param: string }` | none | Section 8.5. | Section 8.5. | coll:75-94 |
| `flowIsolation` / `sharedToLineage` | `boolean` | `false` | As single resource, applied to every instance. | Same refusals. | coll:100-113, 454-464 |
| `runBy` / `canWrite` | as single | none | As single, per entry. | Section 12.5. | coll:243-260 |

`defineFacetedCollection` takes the collection fields above except `stateSchema`, `reactTo`, `client`, `writable` (it adds or restricts them; section 9).

## 4. Handle operations

### 4.1 Single resource: `ResourceRef` (`ctx.resources.<name>`)

| Member | Takes | Returns | Notes | Source |
|---|---|---|---|---|
| `state` | none | `Readonly<State>`, synchronous getter | The value as the request first read it. Another request's later write is invisible to this one. | res:462; ov:224-228 |
| `patchState(updates)` | `Partial<State>` | `Promise<void>` | Merge fields. | res:463 |
| `setState(next)` | full state | `Promise<void>` | Replace everything. | res:464 |
| `updateState(fn)` | `(state) => state \| Promise<state>` | `Promise<void>` | Read, modify, write. | res:465 |
| `incState(deltas)` | number-valued fields only, each a number | `Promise<void>` | One guarded write. Missing or `null` field starts from `0`. Refuses a non-number target, a non-finite delta or a non-finite result; nothing is written when any field of a multi-field call is wrong-typed. | res:466-489 |
| `pushState(field, value)` | an array-valued field, one element | `Promise<void>` | Same guard. Missing or `null` field starts from `[]`. Refuses a non-array target. | res:490-503 |
| `getOrPatchState(key, compute)` | key, sync or async function | `Promise<value>` | Returns `state[key]` if it is not `undefined` (a stored `null` is a hit, and `compute` is not called). Otherwise runs `compute`, stores the result and returns it; a `compute` that returns `undefined` stores nothing. Concurrent misses on one key in one request share one `compute` call. No time-based expiry. | res:504-522; ov:345-356 |
| `readContent()` | none | `Promise<string \| null>` | Rendered content (applies `render` or the template). | res:523 |
| `readContentRaw()` | none | `Promise<string \| null>` | Stored body, placeholders intact. | res:524 |
| `writeContent(text)` | string | `Promise<void>` | Replaces the body. Fires `contentUpdated`, not `stateUpdated`. | res:525; ov:244-281 |
| `path`, `scope`, `uri` | none | strings | Section 5.1. | res:454-461 |
| `config` | none | `Readonly<ResourceConfig>` | The definition. | res:529 |
| `edges` | none | `ResourceEdgeApi`, present only if declared | Section 10. | res:530 |

- All state writers return `void`. The new state is read back off `ref.state`. ov:103.
- Delta call signatures are typed to the state shape only where the state type is written out (a `ResourceRef<UsageState>` parameter). A handle read off `ctx.resources.<name>` is not narrowed, so a wrong field compiles and refuses at run time. `incState` still requires numeric deltas. ov:136-152, `packages/core/test/resource-delta-verbs.type-test.ts`.
- An undeclared accessor on `ctx.resources` is a type error (missing property), not a run-time lookup. res:535-560 (`ResourceRegistry` doc comment).
- `ctx.resources.get(name)` and `ctx.resources.list()` also exist on the registry. res:548-552; ov:250.
- A resource refusal: `FlowError` with `code: "resource_delta_refused"`, `retryable: false`, messages `Resource "<name>" incState target "<field>" is not a number (got <type>)` and `Resource "<name>" pushState target "<field>" is not an array (got <type>)`. reg:181-186 [impl]; ov:181-222.
- A delta on a `writable: false` resource is refused (`resource_read_only`), as are `patchState`, `setState`, `updateState`. ov:222.

### 4.2 What state writes store

- State is saved as JSON; every store (memory, SQLite, Postgres, filesystem) stores the same thing for the same write. `Date` becomes its ISO string; `Map`/`Set` become `{}`; `Infinity` and `NaN` become `null`; `undefined` fields and functions are dropped. A `bigint` or a cyclic object fails the write with a `TypeError` and nothing is stored. Within the request, `ref.state` may still hold the value as written. ov:161-171.
- On a single resource, state is validated against `stateSchema` on every read. If any field fails, the whole state reads back as the resource's default; nothing is thrown or logged. The next write builds on that default. A `z.date()` field fails this way; `z.coerce.date()` reads back as a `Date`. A collection instance is not parsed on read, so a date there comes back as an ISO string. `normalize-resource-state.ts:56-65` [impl]; ov:169-171.
- A write result that fails the schema throws and stores nothing; it does not substitute a default. `normalize-resource-state.ts:1-14, 56-65`; link target for the full rule is the state mutation model page (`/docs/state/mutation-model`).
- Delta calls are single guarded writes: a loser re-runs against the winner's value. Memory, SQLite and Postgres compare-and-swap in the store. The filesystem store guards per key in-process, so two stores over one directory, or two processes, can lose an increment. `ResourceRef.incState` doc comment, res:466-489; ov:173-179; `ResourceStateStore` doc `stores/types.ts:1450-1515`.
- `readCommitted(ref, project)` from `@flow-state-dev/core/helpers` reads the committed value: it runs a no-op `updateState`, so it needs a writable ref (`resource_read_only` on `writable: false`, `project` never runs) and returns `undefined` only when `project` returns `undefined`; a read that cannot happen, such as on a deleted instance, throws. `packages/core/src/helpers/update-state-with.ts:150-175`; ov:224-242. Companion helper `updateStateWith` (`update-state-with.ts:131`).

### 4.3 Collection: `ResourceCollectionRef`

| Member | Takes | Returns | Behaviour | Source |
|---|---|---|---|---|
| `get(key)` | string, or `{ param: value }` for a `[param]` pattern | `Promise<ResourceRef>` | Rejects `Resource instance "<key>" not found in collection "<pattern>"` when absent. Rejects `Key "<key>" does not match collection pattern "<pattern>"` when the key is outside the pattern (including a nested key under `files/*`). | coll:329-330; reg:1593-1612; `resource-collection.test.ts:105-148` |
| `getOptional(key)` | same | `Promise<ResourceRef \| undefined>` | `undefined` when absent or outside the pattern. | coll:332; reg:1614-1626 |
| `create(key, initial?, { replace? })` | key, `Partial<State>`, options | `Promise<ResourceRef>` | Throws `FlowError` code `resource_already_exists` (`Resource instance "<key>" already exists`, `retryable: false`) when the key exists. `{ replace: true }` overwrites with `setState` semantics (schema defaults fill unsupplied fields) and creates when missing. At `maxInstances` with `eviction: "none"` throws; otherwise evicts after the write commits. Refuses an initial state that fails `stateSchema`. | coll:333-354; `packages/engine/src/errors/flow-error.ts:274-296`; reg:1628-1800; `resource-collection.test.ts:97-104, 215-300` |
| `getOrCreate(key, initial?)` | | `Promise<ResourceRef>` | Returns the existing instance without writing; creates when missing. A create race lost to another writer returns the winner. | coll:355-359; reg:1802-1840 |
| `upsert(key, update, createOnly?)` | | `Promise<ResourceRef>` | Exists: patches with `update` (`onInstanceUpdated`). Missing: creates with `{ ...createOnly, ...update }`, `update` wins on overlap (`onInstanceCreated`). `createOnly` is ignored on the patch branch. `maxInstances` is checked only when adding. | coll:360-377; reg:1840-1925; `resource-collection.test.ts:305-448` |
| `list(prefix?)` | string | `Promise<ResourceRef[]>` | Every instance in the pattern, or those whose storage key starts with `<pattern prefix>/<prefix>` (plain string prefix, not segment-bound). No paging. | coll:378-380; reg:1927-1945; `resource-collection.test.ts:537-585` |
| `findBy(index, value)` | declared index name, string / number / boolean | `Promise<ResourceRef[]>` | Equality only; types stay apart (`1` vs `"1"`). Key order. Throws when the collection declares no such index. Never returns a row whose current value does not match. | coll:381-391; col:122-172 |
| `delete(key)` | | `Promise<void>` | Removes the instance and its content. No-op when absent. Fires `onInstanceDeleted` and a `deleted` reaction (`evicted: false`). | coll:393-398; reg:1947-1992; `resource-collection.test.ts:168-185, 515-535` |
| `count()` | | `Promise<number>` | Live count. | coll:400-401; reg:1994-1998 |
| `pattern`, `scope`, `config` | | | | coll:324-326, 403-404 |

- Reads (`get`, `getOptional`, `list`, `count`) are async in both prefetch modes; `ref.state` on a resolved ref is a synchronous getter. coll:307-318; col:15-19, 252-274.
- On a lazy collection, `get` loads one key; `list(prefix)` loads that sub-tree; `list()` and `count()` read the whole prefix in one unbounded scan. reg:2005-2060 [impl]; col:330-332.
- Key resolution: a string key is appended to the pattern's static prefix after normalisation (backslashes become `/`, leading and trailing slashes stripped, repeated slashes collapsed; empty keys, `..` and control characters throw). A parameter object substitutes `[name]` segments; a value with `/`, `\`, `..` or control characters throws; a missing parameter throws `Missing parameter "<name>" for pattern "<pattern>"`; a string key for a parameterised pattern throws. `pat:185-276`.
- Static prefix: the segments before the first wildcard or parameter (`files/**` has `files`). `[topic]/notes` has none, so loading it reads every key in the scope. `getPatternPrefix` from `@flow-state-dev/contracts/helpers/pattern-prefix`; `reg:652-661` [impl].
- Parallel branches writing distinct keys are safe; the same key is last-writer-wins; `incState`/`pushState` accumulate. col:52-54.
- Instances carry the single-resource methods (`state`, `patchState`, `setState`, `updateState`, `incState`, `pushState`, `readContent`, `readContentRaw`, `writeContent`, `getOrPatchState`) plus `path`, `scope`, `uri`. col:48-50.

### 4.4 Content on a collection instance

`readContent()` returns `null` until a body is written. `writeContent` stores it; deleting the instance deletes its content. `resource-collection.test.ts:491-535`.

## 5. Identity: path, scope, uri, and the full storage key

### 5.1 The three handle fields

| Field | Value | Example | Source |
|---|---|---|---|
| `path` | The within-scope storage key. A single resource: its `ref`, else its accessor. A collection instance: the pattern-resolved key. A plain string, not a filesystem path: no segment normalisation beyond key normalisation (4.3), `..` is rejected in keys. | `files/readme.md`; `[topic]/notes` with `{ topic: "react" }` gives `react/notes` | res:447-454; ov:392-396; `resource-path.test.ts` |
| `scope` | `"session" \| "user" \| "org"` | | res:455 |
| `uri` | `${scope}/${path}`. Opaque: not an RFC 3986 URI; do not pass to `new URL()`. Unique across scopes in a flow. The handle the model tools and search results use. | `session/files/readme.md` | res:456-461; ov:402-411 |

### 5.2 Lookup: What is a resource's full storage key?

A resource's row lives at (scope type, **scope id**, **resource key**). The resource key is `path`. The scope id depends on scope [impl: `keys`]:

| Scope | Scope id (shared, `flowIsolation` false) | Isolated (`flowIsolation: true`) | Source |
|---|---|---|---|
| `session` | The session id, prefixed `<tenantId>:` when the request has a tenant. With `sharedToLineage: true`, the lineage root's id instead. | not allowed | `keys:243-250, 570-575`; `lineage-scope.ts:57-70` |
| `user` | `<userId>:~org:<orgId>`: one cell per (user, organization). | `<userId>:~org:<orgId>:<flowInstanceId>` | `keys:177-181, 457-466` |
| `org` | `<orgId>` | `<orgId>:<flowInstanceId>` | `keys:220-227, 457-466` |

- Each component is escaped: `\` and `:` are backslash-escaped. `keys:156-158`.
- The organization is the admitted run's or the stored session's, never a request field. A missing or malformed org for a user-scope key throws `OrgRequiredError`. `keys:43-56, 177-181`.
- `uri` does not include the scope id. Two users' `session/files/a` are the same `uri` and different rows.
- Two accessors that name one definition object share one row; the canonical key is `ref`, else the first accessor in declaration order. Set `ref` on any non-session resource registered under two names so a reshuffle does not orphan data. `storage-identity.ts:32-58`.

### 5.3 Cross-flow sharing (`flowIsolation`)

| Setting | Reachable by | Source |
|---|---|---|
| `flowIsolation: false` (default at user and org scope) | every flow on the server, for that user in that organization, or for that org | res:199-234; sto:62-66 |
| `flowIsolation: true` | only the flow copy that wrote it. The coordinate is the resolved flow **instance** id, so two registered copies of one definition each get their own cell. A singleton's instance id is its kind. | res:199-234; sto:62-72 |
| `scope: "session"` | only that session; `flowIsolation` is an error | res:628-632 |

- Registration refuses two flow kinds that declare the same shared ref with conflicting settings. It does not catch overlapping collection patterns (`files/*` beside `files/a`) or two instances of one kind whose overrides differ. res:221-233 (doc comment).
- An id containing `:` or `\` re-keys under isolation and needs the offline cutover described on the persistence overview page. res:217-224.
- A user-scoped resource on an owner-pinned instance: res:206-208 mentions it; the keys source says the pin no longer chooses a key. **Leave owner pins off the page**; flagged because the doc comment at res:206-208 and `keys:43-56` disagree.

### 5.4 `sharedToLineage`

- Default `false`: a session-scoped resource resolves against the running session, so a background child session hydrates its own empty copy.
- `true`: resolves against the lineage root, so a conversation and every session it dispatches (children nest) read and write the same rows through `ctx.resources`.
- Session scope only; user and org already span sessions.
- Does not share session state, does not serialize writes (ordinary contention, fenced by the store's version check), does not reach sideways to a different conversation's lineage.
- A flow-level declaration and a block-level declaration of one accessor that disagree on `sharedToLineage` throw at `defineFlow` with a message naming both settings.
- Collections take it too.
Sources: res:236-258; coll:105-113; sto:140-167; `defineFlow.ts:1236-1272`; `packages/engine/test/shared-to-lineage.test.ts`.

## 6. Declaring, merging and sharing resource definitions

| Rule | Source |
|---|---|
| A block declares `resources: { accessor: definition }`. The accessor is the key on `ctx.resources`; the definition's own `scope` decides where it is stored. | ov:329-343 |
| Sequencers and routers bubble child blocks' resources up; `defineFlow` merges them into the flow's `resources`. Declaring a resource on a block installs it in any flow that includes the block. | ov:358-360 |
| The same accessor with the **same definition object** deduplicates. A **different** `defineResource()` / `defineResourceCollection()` result under one accessor, at flow level or on blocks, throws at `defineFlow`: `Resource conflict in flow "<kind>": "<accessor>" is declared at flow level with a different defineResource() reference than a block declares. Use the block's reference, or pick a distinct accessor key.` | `defineFlow.ts:748-760, 1255-1262`; ov:360; col:385 |
| So two blocks that need one resource must import one `defineResource` result, in a leaf module. | ov:360 |
| A flow-level declaration is only needed for data every action needs; it loads on every request. | ov:61-80 |

## 7. Content and templates

| Item | Behaviour | Source |
|---|---|---|
| Content sources | One of `content`, `contentFile`, `contentTemplate`, `contentTemplateRef`. | res:608-615 |
| Seed content | A single resource with a declared body returns that body from `readContent()` and from the client content route before any run has written it. `rr:104-114` [impl] | |
| `readContent()` vs `readContentRaw()` | Rendered (with `render` or the template, against current state) vs stored. | ov:246-281 |
| Template format | YAML front matter plus a LiquidJS `<system>` body, rendered against `state`; loaded with `loadResourceTemplate` or `parseResourceTemplate` (`@flow-state-dev/core/resource-template`). Full walkthrough lives on the resource-templates page. | ov:283-285; prj:19 |
| Content is not versioned | A later write replaces the earlier one. State is versioned. | ov:39 |
| Content size / type | `contentType` and `extension` appear on `ResourceRef` but the registry does not set them. **Leave off the page.** | res:526-527; `reg` grep: no assignment |

## 8. Collections: patterns, hooks, indexes, owners

### 8.1 Pattern table

| Pattern | Example keys | Matches |
|---|---|---|
| `files/*` | `files/readme.md` | One level. `files/src/utils.ts` does not match. |
| `files/**` | `files/readme.md`, `files/src/deep/nested.ts` | Any depth. `**` must be the last segment. |
| `[topic]/notes` | `react/notes`, `rust/notes` | A `[name]` segment is one segment bound to a key parameter; address with `{ topic: "react" }`. |

`pat:98-138`; col:36-47. A key outside the pattern is refused by `get`, `create`, `getOrCreate`, `delete` (`Key "<key>" does not match collection pattern "<pattern>"`) and answers `undefined` from `getOptional`. reg:1599-1604, 1613-1618, 1636-1640, 1806-1812, 1844-1848, 1950-1954 [impl].

### 8.2 Hooks vs reactions

`onInstance*` callbacks are for cheap side effects; `reactTo` runs a real block inside the turn (section 11). Both may be set on one collection. The callbacks are awaited by the mutating call and receive a logging-only context, so they cannot emit items or run blocks. reg:1789-1797, 1978-1980 [impl]; col:344-367; rea:12-22.
**Existing page says "Hooks are synchronous" and "Hook context provides log(message) and scopeType" (col:365). Both are wrong; see section 19.**

### 8.3 Indexes (`findBy`)

| Rule | Source |
|---|---|
| An index entry is a function `(key, state) => value` (version 1) or `{ version, value }`. | coll:233-242; col:122-157 |
| Returns a string, number or boolean, or an array of them (the row is found by each); `null`/`undefined` means no value. | col:144 |
| Must answer from `key` and `state` alone. A function that throws fails the write it runs for. | col:146 |
| Raising `version` rebuilds the index on the next lookup in each scope. Adding an index to a populated collection needs no backfill; the first `findBy` in each scope reads the collection once. | col:148-159 |
| SQLite and Postgres: one index query plus one row read per hit. Memory and filesystem: scan the collection and filter. | col:161-168; coll:381-391 |
| Two collections in one scope whose patterns can match the same keys cannot declare one index name at two versions: the server refuses to start. | col:157 |
| Every write through the server's stores keeps the index current; a process on a version without `findBy` support can miss entries. | col:172 |
| Goal check | `goals/collection-indexes/find-rows-by-a-declared-field` |

### 8.4 Eager vs lazy, snapshot and list, `prefetchWindow`

See section 3 rows `prefetchMode`, `prefetchWindow`. A client-visible collection's snapshot entry is `{ count, prefetched? }`; a projected one is `{ prefetched: [] }` with no `count`. ru:449-500 [impl]; col:479-495.

### 8.5 Owner-keyed collections

| | `ownerPrivate: { param }` | `ownerWrites: { param }` | Source |
|---|---|---|---|
| Who reads a row | Only the user its owner segment names. Lists and counts omit it; `getOptional` returns nothing; `get` and any write throw. | Everyone the scope serves (server and browser). | coll:75-94; `owner-private.ts:30-53` [impl] |
| Who writes | Its owner. | Its owner only; anyone else's create, update or delete throws and changes nothing, whether through the collection, a ref they read, or the browser routes. | same |
| Key | Put `ownerSegment(userId)` at the `param` segment. `ownerSegment` returns `~` plus the percent-encoded user id (`a-z0-9-` pass through; other bytes become `%XX`). Exported from `@flow-state-dev/core`. | same | pat:140-177 |
| Browser read | Refused at define time: `client.state.read`, `client.content.read`, `client.content.prefetch` each throw `Owner-private collection "<pattern>" must not enable a browser read.` | Allowed. | coll:586-606 |
| Pattern rule | Declare `param` exactly once, as a whole `[param]` segment; no `**`. | same | coll:608-622 |
| Both modes | `declares both ownerPrivate and ownerWrites; choose one.` | | coll:427-430 |
| Eviction | n/a | `eviction` other than `"none"` throws `... must not evict: an eviction would delete another user's resource.` | coll:431-439 |
| Refusal text (exact) | `A resource in an owner-private collection is readable only by the user it belongs to.` | `A resource in an owner-writes collection is written only by the user it belongs to.` | `owner-private.ts:47, 53`; `packages/engine/test/owner-private-fence.test.ts:28` |

- A key segment starting `~` is reserved in every app for these two modes. No other collection reads or writes a key carrying one: a wider collection such as `[tenant]/**` lists without them and a write through it is refused. A key's first `~` segment is its owner, so no segment before the owner parameter may start with `~`. A single resource whose `ref`/accessor has such a segment is refused when its flow registers. col:196, 207; `owner-private.ts:264-290` [impl].
- Registration refuses (the app does not start) a collection in the same scope whose pattern can reach an owner-keyed collection's keys, whichever registers first. Same pattern declared `ownerPrivate` on one flow and `ownerWrites` on another is refused. Same owner-private collection on several flows is fine; a collection in another scope is fine. col:198-205, 232; `owner-private.ts:203-262` [impl].
- Goals / tests: `packages/engine/test/owner-private-fence.test.ts`, `owner-private-admission.test.ts`, `owner-writes-fence.test.ts`.

## 9. Projected collections (read-only view of app-owned data)

`defineProjectedResourceCollection(config)`. proj:142-181, 283-362.

| Field | Type | Meaning | Refusal at define time | Source |
|---|---|---|---|---|
| `pattern` | wildcard only: `positions/*` or `positions/**` | Keys. | `[name]` patterns throw `defineProjectedResourceCollection() requires a wildcard pattern …` | proj:143-148, 293-304 |
| `scope` | `session \| user \| org` | Routes `scopeId` into the hook context. | other value throws | proj:149-150, 306-310 |
| `stateSchema` | Zod | Shape of one record. | | proj:151 |
| `read({ key, ctx })` | `Promise<record \| null>` | Resolve one record by within-scope key. `null` means none. Required. | missing `read` or `search` throws `requires both read and search backing functions` | proj:154-155, 312-316 |
| `search({ query, ctx })` | `Promise<{ hits: [{ key, state }], nextCursor? }>` | Resolve a page. Required. | | proj:156-163 |
| `contentTemplate` / `contentTemplateRef` | as collections | Render each record against `state`. | both throws | proj:165-168, 318-322 |
| `llmReadable` | `boolean`, default off | Gates the read and search tools. There is no `llmWritable`, `writable`, `edges`, `prefetchMode`, `maxInstances`, `eviction`, `secret`. | | proj:169-170, 136-141 |
| `client` | `CollectionClientConfig` | As collections. | `client.content.create`, `update` or `delete` throw `defineProjectedResourceCollection() rejects client.content.<flags> …` | proj:171-176, 324-338 |
| `reactTo` | `created`, `stateUpdated`, `deleted` | `contentUpdated` throws. I found no public call that reports an app-side change, so I cannot say what fires these. **State only that they are accepted at definition; ask before documenting firing.** | `contentUpdated` throws | proj:116-130, 348-354; `projected-resource-collection.test.ts:104-109` |
| `metadata` | record | | | proj:179 |

- `ProjectedResourceContext` handed to both hooks (server-derived, never caller input): `scope`, `scopeId`, `userId`, `orgId?`, `tenantId?`, `flowKind`, `signal?`. Scope every query by `userId` and `orgId`: a user-scoped projected collection belongs to a user inside one organization. proj:89-110; prj:52, 111-125.
- `ResourceQuery` handed to `search`: `{ search?, prefix?, filter?: Record<string, JsonValue>, limit?, cursor? }`. `filter` is equality only. proj:48-59.
- Ranking, filtering and paging are the hook's; hits stay in the order returned; `nextCursor` is opaque and echoed. proj:61-87; prj:97-99.
- `ctx.resources.<name>` is a `ProjectedResourceCollectionRef`: `get`, `getOptional`, `list(query?: string | ResourceQuery)`. A bare string is `{ search }`. `list` returns `{ items, nextCursor? }` of read-only refs with state and rendered content resolved. No `create`, `upsert`, `delete`, `count`. proj:219-241; prj:69.
- A `ProjectedResourceRef` has `path`, `scope`, `uri`, synchronous `state`, `readContent()`, `readContentRaw()`, and `config.llmReadable`. proj:194-208; prj:73.
- Two reads of one key in one request share one `read` call; the next request calls the hook again; the framework caches nothing across requests. reg:1387-1425 [impl]; prj:69, 135.

Results table (checked against code; existing page rows prj:75-85):

| Call | Result | `read` called? | Source |
|---|---|---|---|
| `get`, app has the record | the ref | yes | reg:1485-1500 |
| `get`, `read` returns `null` | throws `Resource instance "<key>" not found in projected collection "<pattern>"` | yes | reg:1497-1500 |
| `getOptional`, `read` returns `null` | `undefined` | yes | reg:1502-1508 |
| `read` returns a record that fails `stateSchema` | throws `Projected collection "<pattern>" read for "<key>" returned a record that failed stateSchema: …` | yes | proj:381-399 |
| `get` with a key outside the pattern | throws `Key "<key>" does not match projected collection pattern "<pattern>"`; `getOptional` returns `undefined` | no | reg:1432-1441 |
| `list` and a hit fails `stateSchema` | the hit is dropped and logged (`console.warn`); the rest of the page returns | `search` yes | proj:420-446 |
| Org-scoped, session has no org, in a flow block | `get` throws not found, `list` returns an empty page | no | proj:384-386, 430-432 |
| Org-scoped, session has no org, on the HTTP item-state route | the call is refused with an error naming `organization`; `read` is not called | no | `packages/engine/test/projected-resource-routes.test.ts:230-282` |
| HTTP item-state route, record absent | `200` with `null` | yes | `rr:697-703`; `projected-resource-routes.test.ts` |
| Client `POST`/`PATCH`/`DELETE` on the collection | `403`, body error matches `read-only projected collection` | no | `rr:226-231, 346-349`; `projected-resource-routes.test.ts:285-297` |

- Access by caller: a block (`get`, `getOptional`, `list`); the agent's `searchResources` (pushes the query to `search`, can page with `nextCursor` only when exactly one projected collection is the only searchable source; mixed or multi-collection search is one page, no cursor); `globResources` and `grepResourceContent` skip projected collections; `readResourceContentTool` reads one by `uri`; the agent CRUD tools (`resourceTools()`) skip projected collections; HTTP list `GET /sessions/:id/resources/:ref?limit=&cursor=&topicPrefix=` (`topicPrefix` maps to `query.prefix`; returns the app's `nextCursor`); React `useResourceCollectionList`. rsearch:233-262; rtools:64-82; rr:480-560; prj:99-109.
- The snapshot shows `{ prefetched: [] }` with no `count`. ru:449-462 [impl]; prj:109, 137.
- Write surface: no ref mutators; agent CRUD tools skip; client write routes closed. Changing data is the app's own handlers; the next read sees it. prj:127-131.
- Limits: no cross-request cache; wildcard patterns only; no `count()`; framework does not re-rank; `globResources`/`grepResourceContent` skip. prj:133-140.

## 10. Edges

`edges: true | { vocabulary?: string[], maxEdges?: number }` on `defineResource` or `defineResourceCollection` (per instance). edges:22-28.

| Fact | Source |
|---|---|
| Opt-in. A resource that does not declare `edges` is unaffected. The framework adds `edges: Edge[]` (default `[]`) to the state schema and default value; an existing `edges` key in `stateSchema` is left alone; `stateSchema` must be a `z.object` or define throws. Edges live in the resource's own state; there is no separate storage key. | res:352, 658-690; coll:172-180, 524-545; edg:10, 30 |
| Edge fields: `id` (assigned on `add`, a random UUID), `from`, `to` (node ids, strings), `type` (active-voice relation), `confidence` ([0,1], default 1), `validFrom` (ISO or `null`, default `null`), `validUntil` (`null` means still true), `source` (provenance ids, default `[]`), `createdAt` (ISO, set on add). | `edge:35-45`; edges:145-161 |
| Node convention `"namespace:key"`. `nodeRef("ticker", "NVDA")` gives `ticker:nvda` (key lowercased); `parseNodeRef` splits on the first colon. Import from `@flow-state-dev/core/graph`. | `edge:13-26`; `packages/core/package.json` `./graph` export (line 71) |
| Reads (`all`, `neighbors`, `egoGraph`, `shortestPath`) are synchronous over `ref.state.edges`. Writes (`add`, `supersede`, `remove`, `pruneDangling`) are async and persist through `updateState`, so they follow the resource's normal write path (schema check, change event, reactions). | edges:1-15, 40-58; edg:45 |

`.edges` API (`ResourceEdgeApi`), present on a ref only when declared:

| Method | Takes | Returns | Notes | Source |
|---|---|---|---|---|
| `add(input)` | `{ from, to, type, confidence?, validFrom?, source? }` | `Promise<Edge>` | Throws `Edge type "<type>" is not in the declared vocabulary: …` when a `vocabulary` is set and `type` is not in it. On overflow past `maxEdges`, culls: superseded edges first (oldest `createdAt`), then active edges by lowest `confidence` (ties: oldest first). The just-added edge is never culled. | edges:30-38, 88-123, 145-172; `core/test/graph/resource-edges.test.ts:71-150` |
| `supersede(edgeId, at?)` | | `Promise<void>` | Sets `validUntil` (default now). The edge stays. No-op for an absent id. | edges:174-182; test:153-172 |
| `remove(edgeId)` | | `Promise<void>` | Hard delete. | edges:184-189 |
| `all(opts?)` | `{ at? }` only | `Edge[]` | No arguments: every stored edge, superseded ones included. With `at`: edges active at that instant (`validFrom` null or <= at, `validUntil` null or > at). | edges:191-193; `trav:30-42` |
| `neighbors(node, opts?)` | | `Edge[]` | Edges touching the node. | edges:195-197 |
| `egoGraph(node, opts?)` | | `{ nodes, edges }` | Within `depth` hops; includes the node; keeps only edges with both ends reached. | edges:199-201; trav:121-154 |
| `shortestPath(from, to, opts?)` | | `Edge[] \| null` | Ordered chain; `null` when none within `depth`; `[]` when `from === to`. | edges:203-205; trav:156-192 |
| `pruneDangling(knownNodes)` | iterable of node ids | `Promise<number>` | Drops edges whose `from` or `to` is not in the set; returns the removed count. | edges:207-216 |

Traversal options (`neighbors`, `egoGraph`, `shortestPath`): `depth` default 2, clamped to 0..6 (`MAX_DEPTH`); `direction` `"both"` (default), `"out"`, `"in"`; `relationTypes` (default all); `at` (default now). All traversals are depth-bounded and cycle-safe. `trav:15-28, 81-86`.

- Sizing: hundreds to low thousands of edges per resource; **not a graph database**; for millions of edges or planner-grade path matching, use a real store. edg:76-80. (Drop the breadth-first and in-memory description: mechanism.)
- The first framework consumer is memory relations (`/docs/memory/relations`). edg:80.

## 11. Reactive blocks (`reactTo`)

`reactTo` on `defineResource` and `defineResourceCollection`. Each entry is a block, or `{ block, when }`. chg:126-164.

| Which kinds | Single resource (`defineResource`) | Collection (`defineResourceCollection`) | Projected | Source |
|---|---|---|---|---|
| `created` | refused | yes | yes | chg:200-221; proj:348-354 |
| `stateUpdated` | yes | yes | yes | |
| `deleted` | refused | yes (also on capacity eviction) | yes | |
| `contentUpdated` | yes | yes | refused | |

Refusal text: `defineResource() does not support reactTo.<kind> — single resources have no create/delete lifecycle and only fire "stateUpdated" / "contentUpdated". Use reactTo.stateUpdated or reactTo.contentUpdated.` chg:219-222.
A binding that is not a block throws `<definer> reactTo.<kind> must be a block (got …)`; a `when` that is not a function throws `… .when must be a function`. chg:224-231.

State and content are separate axes. `patchState` / `setState` / `updateState` / `incState` / `pushState` fire `stateUpdated` only; `writeContent` fires `contentUpdated` only. Bind one block to both to react to either. There is no `updated` umbrella kind. chg:161-163; rea:58, 130; `integration-tests/src/scenarios/reactive-blocks-fix751.test.ts:315-381`.

`ResourceChange` payload (kinds `created`, `stateUpdated`, `deleted`): chg:58-74.

| Field | Type | Meaning |
|---|---|---|
| `key` | string | Instance key, or the single resource's ref name. |
| `ref` | string | Full storage path, e.g. `memos/launch`. |
| `kind` | `"created" \| "stateUpdated" \| "deleted"` | |
| `state` | state or `null` | Post-mutation. `null` on `deleted`. |
| `prevState` | state or `null` | Pre-mutation. `null` on `created`. |
| `evicted` | boolean | `true` only for a `deleted` from capacity eviction (LRU or oldest); `false` for an explicit `delete()` and for every other kind. |

`ResourceContentChange` payload (kind `contentUpdated`): `{ key, ref, kind: "contentUpdated" }`. Bodies are never inlined; the block calls `readContent()`, which returns the new body because the reaction runs after the body is persisted. chg:76-89; `reactive-blocks-fix751.test.ts:315-381`.

| Schema helper | What it is | Source |
|---|---|---|
| `resourceChangeSchema(stateSchema)` | Zod schema for `ResourceChange`; `state` and `prevState` are `stateSchema.nullable()`. An input schema, so strict-output rules do not apply. Exported with the `ResourceChange` type from `@flow-state-dev/core`. | chg:91-110 |
| `resourceContentChangeSchema()` | Takes no state schema. | chg:112-124 |

| Behaviour | Source |
|---|---|
| Timing: blocking, inside the turn that made the change. Items it emits are ordered with the turn's other output. No `mode` field. A throw fails the mutating turn. For a side effect, make the bound block a sequencer that uses `.sideChain()`: its failure does not fail the turn. | `rd:1-20`; rea:136-149; `reactive-blocks-fix751.test.ts:33-83, 142-194` |
| `when`: receives the change payload and returns a boolean; `false` skips the block. For `contentUpdated` the payload is `ResourceContentChange` (`key`, `ref`), so a content `when` cannot gate on state. | chg:130-149; rd:233-240 [impl] |
| `evicted` lets a `deleted` reaction skip capacity evictions. | rea:166-175 |
| Cascade limits per turn: re-entrancy depth 8, total fan-out 1000. Not configurable. At a breach the block that would exceed the cap is skipped and a `reactive_cascade_exceeded` diagnostic is emitted as a failed `error` item; nothing throws. | `rd:44-45, 244-258` [impl]; `reactive-blocks-fix751.test.ts:195-314` |
| A payload that fails the block's `inputSchema` skips the block and emits a `reactive_input_invalid` diagnostic. Not on the existing page. | rd:262-273 [impl] |
| Trace: nested under the block that made the mutation, not the request root. Trace path `__reactive__/<ref>/<kind>#<n>` where `<n>` is a per-run counter. A reaction that mutates another resource nests its own reaction beneath it. | rd:282-296 [impl]; rea:183-185; `reactive-blocks-fix751.test.ts:84-141` |
| What fires `contentUpdated`: server-side content writes (a tool's `writeContent`, the generic content tool, a file flush). `client.content.update` (browser) runs outside any flow turn and does not fire it. | rea:132 |
| `onInstance*` callbacks vs `reactTo`: callbacks are awaited functions with a logging-only context; single resources have no callbacks, only `reactTo`; both may coexist on one collection. | rea:12-22; reg:1789-1797 [impl] |

## 12. Client access (browser)

### 12.1 What the browser can read without `expose`: the lookup

| Declaration | What reaches the browser |
|---|---|
| No `client` block | **Nothing.** The resource is left out of the session snapshot and the manifest. Content read, collection state read, create, update and delete routes answer `403` (`… not permitted for "<ref>"`); `404 Unknown resource "<ref>"` is for a ref the flow does not declare. The collection `count` is not emitted either. |
| Single resource with `client` but no `expose`, `exclude` or `data` (for example `client: { content: { read: true } }`) | The snapshot entry has **no `clientData`**: state stays private. Content only through the content route if `content.read`, or inline if `content.prefetch`. |
| Single resource with `expose`, `exclude` or `data` | `clientData` = that projection of state. |
| Collection with `client.state.read: true` and no projection | Each item's `clientData` is the **full stored state** (identity). |
| Collection with `client` but no `state.read` | `count` is emitted; per-item state routes answer `403`; prefetched entries carry `topic` only. |

Sources: `cproj:226-258` (`hasClientProjection`); `ru:419-500` (snapshot builder) [impl]; `rr:75-130, 480-520, 560-600` [impl]; `packages/engine/test/resource-state-routes.test.ts:557` (omits resources with no client config); ca:33-38, 119-133, 213-218.
**The existing page contradicts itself (ca:38 "full state is sent" vs ca:126-133) and the `ResourceClientConfig` doc comment (res:62-65) repeats the ca:38 wording. Code and manifest agree with ca:126-133. See section 19.**

### 12.2 `client` config shape

| Field | On | Meaning | Source |
|---|---|---|---|
| `content.read` | both | Client may fetch the rendered content body. | res:30-35 |
| `content.prefetch` | both | Content is included inline in the snapshot entry. Skip for many items or large bodies. | res:30-35; ca:267-289 |
| `content.create` / `update` / `delete` | collections only | Client may `POST` / `PATCH` content / `DELETE` an item. `create` alone leaves a gap: grant `update` with it (see 13.3). | res:40-48; ca:44-76 |
| `state.read` | collections only | The list and item-state routes succeed and carry `clientData`; the snapshot's `prefetched` entries carry `clientData`. `count` is always emitted. | res:98-108; ca:202-221 |
| `expose` | both | Whitelist of state keys. Type-checked against the schema. | res:80-84 |
| `exclude` | both | Every key except these. A field added later is published by default, so prefer `expose` for rows carrying server-set fields (leases, claims, retry counts). | res:84-86; ca:222-235 |
| `data` | both | `(state) => JsonValue \| Promise<JsonValue>`. Sees full state; a secret field in its return is dropped. Annotate the return type to keep the precise client type. | res:49-72, 86-89; ca:102-113, 317-323 |
| `live` | both | Streams the projected `clientData` as an inline delta on each mutation, merged into the client's cached snapshot, no refetch. Default `false`. Never carries content. Requires client-visible `clientData`. | res:90-91, 138-144; ca:593-620 |

Define-time refusals: more than one of `expose`/`exclude`/`data` throws `<definer> for "<ref>": client config may set at most one of `expose`, `exclude`, or `data`. Got: …`; `expose`/`exclude` naming a key not on the schema throws `… names key(s) not on stateSchema: … Valid keys: …`; `live` without client-visible data throws `… client.live requires the resource's clientData to be …` (collections: set `state.read: true` or a projection; single: a projection). cproj:77-140; ca:135-146, 614.
`ClientDataOf<typeof definition>` extracts the projected client type: `data` gives the function's awaited return, `expose` a `Pick`, `exclude` an `Omit`, none the full state. `secret` is not removed from the derived type under identity or `exclude`; pair `secret` with `expose`. res:424-441; cproj:46-62; ca:177, 295-323.

### 12.3 Browser reads: routes and calls

All paths are under `/api/flows`. Permissions are enforced from `client`. rt:258-330 [impl]; rr [impl]; ca:452-467.

| Method and path | Needs | Answers |
|---|---|---|
| `GET /sessions/:id/resources/:ref/content` | `content.read` (single resource) | `200 { ref, content }`; `400` for a collection; `403` without permission. Serves the declared seed content when nothing is stored. |
| `GET /sessions/:id/resources/:ref/:topic/content` | `content.read` (collection) | `200 { ref, topic, content }`; `404 Item "<topic>" not found in "<ref>"`; `400` topic outside pattern. `content` is `null` when no content row exists. |
| `GET /sessions/:id/resources/:ref?limit=&cursor=&topicPrefix=` | `state.read` | One page: `{ items: [{ topic, storageKey, clientData? }], nextCursor? }`. `limit` default 50, 1 to 200, else `400 limit must be 1–200`. Keyset paging: `cursor` is the last storage key returned. `topicPrefix` matches the **full storage key** (`artifacts/projects/abc`). Items sorted by storage key. Session, user and org scope. |
| `GET /sessions/:id/resources/:ref/:topic` | `state.read` | `{ topic, storageKey, clientData }`; `200` with `null` when the topic is absent; with no projection configured a `hint` field replaces `clientData`. |
| `POST /sessions/:id/resources/:ref` | `content.create` | Creates; body `{ topic, content? }`; `201 { topic }`. Seeds state from the `stateSchema` parsed against `{}`: a schema that cannot seed from `{}` gets `400` naming the field; an existing topic gets `409 Item "<topic>" already exists`. |
| `PATCH /sessions/:id/resources/:ref/:topic/content` | `content.update` | Body `{ content }`; `200`. `404` for an absent item. A single resource's content cannot be updated from the client: `400 Content mutation is only available for collection resources`. |
| `DELETE /sessions/:id/resources/:ref/:topic` | `content.delete` | `200`; absent topic is also `200`; `409 … was modified concurrently; re-read it and retry` when the item's state changed during the request; a rejected delete leaves the item intact. |
| `GET /sessions/:id/manifest` | session exists | Section 14. |

- `POST`, `PATCH`, `DELETE` on a session-addressed collection work **at session scope only**: a user or org collection answers `501 Collection mutations only supported for session scope`. User and org writes go through `runBy` (12.5). rr:249-251, 358-360 and the DELETE handler [impl].
- Owner-keyed collections: the list, count, prefetch window and item routes filter by the caller's owner rule; create/update/delete answer `403` with the owner refusal. rr [impl].
- `:topic` is a multi-segment wildcard; encode slashes as `%2F`. A topic literally `content` collides with the `/:ref/content` route. rt:273-320 [impl]; ca:467.
- The topic arrives as a bare key or the full storage key. rr [impl].
- Browser writes: create writes state then content; a failed content write leaves a live item with no content row (reads `null`, retry gets `409`, repair with `PATCH`, which needs `update`). A concurrent `DELETE` or `PATCH` in that window can leave an orphaned body or lose the `PATCH`. Send `content` with every `POST`. `packages/engine/test/resource-collection-routes.test.ts:196-480`; ca:469-566. (Mechanism-heavy; pass 6 keeps the three outcomes and the two habits.)

### 12.4 Client and React surface

Client (`createClient`) `client.resources` (`ResourcesApi`): cl:488-523.

| Method | Calls |
|---|---|
| `getResourceContent(sessionId, ref)` | `GET …/resources/:ref/content` |
| `getCollectionResourceContent(sessionId, ref, topic)` | `GET …/:ref/:topic/content` |
| `createCollectionResource(sessionId, ref, { topic, content? })` | `POST` |
| `updateResourceContent(sessionId, ref, topic, { content })` | `PATCH` |
| `deleteCollectionResource(sessionId, ref, topic)` | `DELETE` |
| `listCollectionResources(sessionId, ref, { limit?, cursor?, topicPrefix? })` | page `{ items: [{ topic, clientData? }], nextCursor? }` |
| `getCollectionResourceState(sessionId, ref, topic)` | item state or `null` |
| `getResourceManifest(sessionId)` | the manifest |

Reads resolve to `{ ref, topic?, content }`. A refused call rejects with `ClientHttpError` whose `status` is the server's. cl:707-736; ca:450.
`client.resource(def, { key? })` (`ScopeHandleOf`): a user or org resource or collection by scope and key, no session. A resource handle: `read()` → `{ value, version }` (version 0 means nothing stored, value is the schema's default), `state()`, `set(value, { version? })`, `update(updater)` (re-reads and re-applies on `stale_version`, three attempts at most, then rejects), `send(action, input)`. A collection handle: `list({ limit?, cursor?, topicPrefix? })` → `{ items: [{ topic, storageKey, value, version }], nextCursor? }`, `listAll`, `entry(entry)` with `read()` (`null` at version 0 when absent or not the caller's), `set`, `update`, `delete`. A session-scope definition throws `client.resource takes a user or org resource; a session resource is read through its session`. Write failures reject with `ResourceWriteError` carrying `code` (`stale_version`, `write_refused`, `not_writable`, …). `cl-sr:1-140`; cl:546-554. **Not on any existing docs page.**

React (`@flow-state-dev/react`), `packages/react/src/index.ts:37-68`:

| Hook | Signature | Returns | Source |
|---|---|---|---|
| `useResource(def, options?)` | `options`: `session`, `sessionId`, `key`, `client`, `pollIntervalMs` | Session scope: `{ value, stale }` (value from the snapshot). User or org single: `{ value, stale, set, update }`. User or org collection: `{ value: ScopeEntry[] (first page, up to 200), stale, set(entry, value), update(entry, fn), delete(entry) }`. Needs no session at user or org scope; stays current on change notices and a timer. | `rx useResource.ts:1-60, 131-175` |
| `useResourceContent(session, ref)` | | `{ clientData, content, isLoading, refetch }`; refetches when the snapshot changes; uses prefetched content when present. | `useResourceContent.ts:16-60` |
| `useResourceCollection<TClient>(session, ref)` | | `{ list(options?), get(topic), query(options), actions: { create, update, delete }, refetch, prefetched, count, live, wrap }`. `actions` always exist; the server answers `403` without the permission. | `useResourceCollection.ts:30-110, 174` |
| `useResourceCollectionList<TClient>(session, ref, { limit?, topicPrefix? })` | | `{ items: CollectionResourceHandle[], hasMore, isLoading, error, refetch, loadMore }`. | `useResourceCollectionList.ts:60-100` |
| `useCollectionResource<TClient>(session, ref, topic)` | | `{ item, isLoading, error, refetch }`; layers the `live` overlay over the fetched item. | `useCollectionResource.ts:20-60` |
| `useResourceManifest(session)` | | `{ manifest, isLoading, error }`; one fetch per `flowKind`, module-level cache, no SSE. | `useResourceManifest.ts:1-70` |

- A `CollectionResourceHandle` is `{ topic, clientData?, fetchContent(): Promise<string | null> }`. `packages/client/src/types/index.ts:387-391`.
- `useSession(sessionId, { flowKind, live: true })`: a live view reads again when another session writes, creates or deletes an item it can read; the announcement carries no data; the view re-reads with the caller's own permissions. Only a resource a client can read announces this way (one with `client`, or any resource of a scope declaring `client.derived`). An owner-private change is announced without naming the row. ca:568-591.
- Live updates: by default a `resource_change` event on the request's stream only invalidates; hooks refresh the snapshot when the request completes. Collections announce every instance mutation (including capacity evictions) whatever their `client`; single resources announce only when `live: true`; content writes never carry data. With `client.live: true` the delta rides on the event; a delete marks the item gone; `count` and list pages reconcile at the end of the request. ca:568-620.
- `lifecycleSchema(statuses)` (from `@flow-state-dev/core`) returns a required `status` enum plus nullable `startedAt`, `completedAt`, `errorMessage` (each `.nullable().default(null)`) to spread into a `stateSchema`. ca:622-635; `packages/core/src/helpers/lifecycle-schema.ts:36`.

### 12.5 `runBy` and `canWrite` (a client writing a user or org resource)

| Rule | Source |
|---|---|
| `runBy: "default"` uses the framework's default write flow: checks schema, owner and `canWrite`, and writes at the version the client read. `runBy: { flow: "<kind>" }` names a flow the app hosts, whose actions write it with their own rules. With no `runBy`, a client cannot write it; server flows still write it from inside their actions. | res:162-171 |
| `canWrite({ prev, next, userId, orgId })` (single) / `canWrite({ key, prev, next, userId, orgId })` (collection; `prev` absent on create, `next` absent on delete). `userId` and `orgId` come from the verified sign-in. Requires `runBy: "default"`. **An org resource on the default write flow must declare `canWrite`** (`() => true` for everyone) or define throws. A user resource is its owner's either way. | res:172-190, 735-760; coll:262-290 |
| Define-time refusals (each throws, naming the resource): `canWrite` without `runBy: "default"`; `runBy` other than `"default"` or `{ flow: "<non-empty string>" }`; `runBy` at session scope; `runBy` with `flowIsolation: true`; `runBy` with no `client` config; a single resource whose `client` projects no state (needs `expose`, `exclude` or `data`); `runBy: "default"` with `writable: false`; with a computed `client.data`; org scope without `canWrite`; on a collection: without `client.state.read: true`, and `"default"` with an eviction other than `none`. | res:695-760; coll:559-584; `packages/core/test/resource-run-by.test.ts:15-110` |
| Routes: `GET /resources/:scope/:key` (resource value and version), `GET /resources/:scope/:key/entries?limit=&cursor=&topicPrefix=` (cursor page, limit default 50, 1 to 200), `GET /resources/:scope/:key/entries/:entry`, `POST /resources/:scope/:key/actions/:actionName` (send). `:scope` is `user` or `org` (else `400 invalid_scope`). Reads need `client.state.read` on collections (`403 not_readable`). A send to a resource with no `runBy` answers `403 not_writable`; an unregistered `runBy` flow answers `409 runby_flow_missing`. | rt:140-175; sr:62-203, 240-314 [impl]; goals note below |
| The caller is the signed-in user and org; a `userId` in the body or query is ignored when the host signs callers in. | `goals/resources-by-scope/…/goal.md` signal `b:forged-user-ignored` |
| Two writers who read one version both keep their change: the loser's write is refused `stale_version` and re-applied (`update`, three attempts). | goal signal `b:both-changes-stored`; cl-sr:1-14 |
| Reads make no session; a write makes one write session per writer. | goal signals `a:no-session`, `b:one-session-per-writer` |
| `client.flow(kind).identity()` returns `{ userId, orgId }` for the signed-in caller with no session; `GET /api/flows/:flowKind/identity`. | cl:441-447; rt:194-200 |

**None of 12.5 is on an existing docs page** (`grep runBy|canWrite apps/docs` finds nothing). It changes what a reader can do: a browser can write a user or org resource.

## 13. Search and model access

### 13.1 Model access flags and tools

| Item | Behaviour | Source |
|---|---|---|
| `llmReadable` (default false) | Opens content to `readResourceContentTool()`, and to `globResources`, `grepResourceContent`, `searchResources`. Collections declare once for every instance; a collection that did not opt in is skipped before it is listed or read, so nothing is loaded to learn it was off limits. | rtools:244-262, 283-300; rsearch header 1-28; col:446-455 |
| `llmWritable` (default false) | Opens `writeResourceContentTool()`. Independent of `llmReadable`. `writable: false` still refuses. | rcontent:52-72; col:442, 453 |
| `readResourceContentTool()` | Tool name `readResourceContent`. `uri` optional: omitted returns `{ uris }` of every readable resource, sorted; given returns `{ uri, content }` rendered content. An absent or non-readable uri throws `Readable resource not found for uri: <uri>`. | rcontent:25-50 |
| `writeResourceContentTool()` | Tool name `writeResourceContent`. `{ uri, content }` → `{ uri, ok: true }`. Throws `Writable resource not found for uri: <uri>`. | rcontent:56-72 |
| Addressing | By scope-qualified `uri` (`session/notes/onboarding`), the same handle search results return. | rcontent:1-12 |
| `resourceTools()` | Four CRUD tool blocks: `createResource({ path, state? })`, `readResource({ path })`, `updateResource({ path, state })`, `deleteResource({ path })`, each by within-scope path. `readResource` reaches only `llmReadable` collections and drops `secret` fields. Create, update and delete reach only collections the flow's visibility rule leaves `"visible"`; **the code does not check `llmWritable` for them** (confirmed at round 1: `resolvePathToCollection` tests `isLlmReadable` for a read and `access === "visible"` for a write, rtools:360-375; only `writeResourceContentTool` tests `llmWritable`, rcontent:56-71). They skip projected collections. No `listResources` (removed). | rtools:120-250, 359-380 |
| `resourceVisibility` on `defineFlow` | `(ctx, { name, ref }) => "visible" \| "read-only" \| "hidden"`. Called on every listing and lookup: synchronous and cheap; decide from data the server wrote, never the turn's input. `hidden` answers like an unregistered resource (unlisted, unsearched, unread, unwritten, not found by uri). `read-only` lists, searches, reads, refuses writes like a non-`llmWritable` resource. It only narrows: `visible` is still bound by `llmReadable`/`llmWritable`. Block code that names a resource (`ctx.resources.payroll`) is not narrowed. With no rule, every declared resource is reachable as its flags allow. Workforce sets the rule for workers. | vis:1-40; rtools:30-54; ov:295-307; `packages/engine/test/resource-visibility.test.ts` |
| Agent discovery manifest | The `resources` manifest source lists every `llmReadable` resource (one entry per resource: `id` = uri, `purpose` = `metadata.description` or `Readable resource at <path>`, `contract` = read or read-and-write per `llmWritable` and `writable`) and one entry per readable projected collection. Not the same thing as the client manifest (section 14). | `packages/core/src/manifest/resources-source.ts:1-89`; man:114-116 |

### 13.2 The search tools (`resourceSearchTools()` returns `{ globResources, grepResourceContent, searchResources }`)

All three cover static resources and store-backed collection instances, gate on `llmReadable`, and return scope-qualified uris. Glob patterns and `prefix` match the within-scope path (`concepts/**`), not the uri. Lexical only: no synonyms, no meaning. rsearch:1-28, 99-296; sea:199-226.

| Tool | Input (default) | Output | Behaviour | Source |
|---|---|---|---|---|
| `globResources` | `pattern` (null), `limit` (100) | `{ uris }` | Matches `ref.path` with picomatch (`dot: true`): `concepts/**` any depth, `concepts/*` one level, `concepts/*hooks*` within a segment. Null pattern lists every readable resource. Sorted, then cut to `limit`. Reads no content. Skips projected collections. | rsearch:116-138; sea:36-48 |
| `grepResourceContent` | `pattern`, `prefix` (null), `maxResults` (50) | `{ matches: [{ uri, line, snippet }] }` | Regex per line; an invalid regex is matched as a literal substring. `line` is 1-based. `prefix` matches on a path boundary (`concepts` matches `concepts` and `concepts/x`, not `conceptsX`). Searches the **rendered** content. Snippets cut at 200 characters plus `…`. The pattern is not sandboxed: a pathological regex can be slow; isolate before using attacker-controlled patterns. Skips projected collections. | rsearch:36-96, 140-182; sea:50-59, 72-78 |
| `searchResources` | `query`, `prefix` (null), `limit` (10), `cursor` (null) | `{ results: [{ uri, score, snippet }], nextCursor? }` | Terms are the lowercased query split on non-word characters. Store-backed resources score by total occurrences of the terms; zero-score resources are dropped; sorted by score then uri. A projected collection receives the query through its `search` hook; its results rank by hook order (`score` is `items.length - i` per collection: descending, the first hit highest, the last `1`). `cursor` and `nextCursor` apply only when exactly one projected collection is the only searchable source; otherwise one page with no cursor, and when both kinds are present the budget is split so neither starves the other. | rsearch:184-293; sea:61-70; prj:106, 139 |

- The text tools match only `llmReadable` resources, against rendered content (a state-driven template is found by the words it renders to, not its source). sea:72-78.
- `readResourceContentTool` accepts a uri a search returned. sea:226.

## 14. The client manifest

`GET /sessions/:sessionId/manifest` (`getResourceManifest`, `useResourceManifest`). The static set of resources a session's flow exposes to a client, with declared capabilities. Pure metadata. rr:729-818 [impl]; man:1-116.

```ts
// packages/client/src/types/index.ts:394-428
type ResourceManifestEntry = {
  ref: string; kind: "single" | "collection"; scope: "session" | "user" | "org";
  pattern?: string; prefetchWindow?: number; hasClientData: boolean;
  client: { content?: { read?, prefetch?, create?, update?, delete? }; state?: { read? } };
};
type ResourceManifest = { flowKind: string; resources: ResourceManifestEntry[] };
```

| Field | Value | Source |
|---|---|---|
| `ref` | The flow's accessor for the resource. | rr:769 [impl] |
| `kind` | `"collection"` when the config has a string `pattern` (projected collections included), else `"single"`. | |
| `pattern`, `prefetchWindow` | Collections only; `prefetchWindow` is `0` when unset. | rr:806-812 |
| `hasClientData` | Collection: `client.state.read === true`. Single: has an `expose`, `exclude` or `data` projection. | rr:777-787 |
| `client` | Copies of the `content` and `state` flags as declared. `client` carries no `expose`, `exclude`, `data`, `live`, `secret`. | rr:803-805 |

- Inclusion rule: an entry appears if `hasClientData` is true or any `client.content` or `client.state` flag is `true`. A resource with no `client`, or `client: {}`, or only `false` flags, is absent. rr:763-795 [impl]; man:55.
- Static per `flowKind`: two sessions of one flow get the same manifest, so cache by `flowKind`, not session id. The route needs the session to exist (`404` if unknown) and no other gate: it is the public surface. The hook fetches once per `flowKind` and shares it through a module-level cache; no SSE. rr:729-760; `useResourceManifest.ts:1-70`; man:9, 100-108.
- Does not carry data schemas, per-item data or runtime updates. man:19-23, 110-112.
- Use: capability-aware UIs (show Create only when `client.content.create`), DevTool enumeration (including empty collections), session bootstrap. man:11-15.
- Not the agent discovery manifest (section 13.1). man:114-116.

## 15. Debug routes

`GET /sessions/:id/debug/resources`, `…/debug/resources/:ref/items`, `…/debug/resources/:ref/content`, `…/debug/resources/:ref/:topic/content` return full server-side state for the DevTool, ignoring `client` projections. Off by default in production (`debugEndpointsEnabled` / `FSDEV_DEBUG_ENDPOINTS=1`; otherwise `403`). Fields named in `secret` are never returned. cl:466-478; rt:332-365 [impl]; ca:637-645.

## 16. When a resource loads (and which resources load for a request)

Lookup: **Which resources load for a request?** Only declared ones, in three tiers. ov:59-82, 362-376.

| Tier | Declared at | Loads | Source |
|---|---|---|---|
| Flow level | `defineFlow({ resources })` | At the start of every request, before any action runs. | ov:63; `reg:756-770` [impl] |
| Action level | Inside a dispatched action's block tree: a block's `resources`, or bubbled up through a sequencer | When that action runs. A sibling action's resources stay untouched. | ov:65-67; `packages/engine/test/prefetch-waves.test.ts` |
| Lazy | `prefetchMode: "lazy"` | A lazy single resource loads when the block that declares it dispatches. A lazy collection loads per access: one store read per key (`list(prefix)` reads that sub-tree). | ov:82; `packages/engine/test/prefetch-lazy-collection.test.ts`; reg:2000-2060 [impl] |

- Eager is the default; lazy changes when data loads, not the call shape: reads are async in both modes. ov:82; col:252-274.
- Content for undeclared resources is never pulled into the context, even when other keys exist in the scope. A fixed resource loads by its exact storage key (state and content, two reads); a collection loads by its pattern prefix (`getByPrefix`), and a pattern with no static prefix (`[topic]/observations`) loads every key in the scope. A scope with no declared resources issues no reads. Projected collections are skipped (no scan). ov:362-376; reg:642-720 [impl].
- The persisted data for a scope is still reachable through the state endpoint; scoping applies to the per-request context. ov:376.
- The DevTool's Resource Loads panel shows per-block fetched-versus-cached keys and timings. col:340-342.
- `getOrPatchState` and the `readCommitted` read are covered in 4.1.

## 17. Scope levels (lookup table)

| Scope | Lifetime | Storage cell |
|---|---|---|
| `session` | One session. A background session dispatched from it has its own, unless `sharedToLineage`. | session id |
| `user` | Across sessions for that user **in one organization** | `<user>:~org:<org>` |
| `org` | Shared across sessions in an organization | `<org>` |

ov:378-386; sto:131-140; `keys:177-181, 220-227`. "Choose the scope that matches the data's lifetime."

## 18. Ledger of the moved rows (`→ R-08`)

Each row is a claim. **Carried** means true as stated or after the stated correction, and the sheet section that holds it. **Dropped** says why.

| # | Row (short) | Verdict | Where / why |
|---|---|---|---|
| 1 | Bash sync requirements: `path`, `hash`, `updatedAt`; content kept separately | **Carried, corrected.** The three fields are required string fields; content is in the content body, not state. State tracks path, content hash, last-sync timestamp. The workspace sets them; a value returned for those keys from `createState` is ignored. `FileEntryState` has string values only. | `packages/tools/src/bash/types.ts:50-66`; `capability.ts:61-67`; `apps/docs/docs/tools/bash.md:360-371` |
| 2 | Resource handle operations: `readContent`, `writeContent`, `patchState`, `state`, type error on an undeclared name | **Carried.** Wider than the row: the full table is 4.1. | res:445-531, 535-552 |
| 3 | Identity and scope: storage keys, cross-flow sharing, `flowIsolation` | **Carried.** 5.2, 5.3. User keys carry the organization, which the row does not say. | `keys` |
| 4 | Collection operations incl. `create` throws on existing, pattern syntax, prefix auto-prepended | **Carried.** 4.3, 8.1. Auto-prepend: a string key is appended to the static pattern prefix; `list("src/")` also prepends it. | reg:1927-1945 |
| 5 | Model access: `llmReadable`, `llmWritable`, the two tools, collection inheritance | **Carried.** 13.1. | |
| 6 | Browser access: `client.content.read`, `expose`/`exclude`, default none | **Carried, corrected.** "Default none" is true only with no `client` block; a collection with `state.read` and no projection sends full state. 12.1. | |
| 7 | Resource identity across blocks: definition travels, stored data keyed by scope, two blocks share one `defineResource` result | **Carried.** 6, 5.2. | |
| 8 | When a resource loads | **Carried.** 16. | |
| 9 | What the browser can read without `expose`: nothing unless `client` | **Carried, corrected.** Same as row 6: nothing without `client`; with `client` the answer depends on single vs collection. 12.1. | |
| 10-12, 14-17, 19-22 | Projected collection table lines: definition fields, scope and ownership, options, operations, `ProjectedResourceRef`, results table, HTTP rows, definition refusals, search hook contract, access-by-caller, manifest snapshot row, hook context, write surface, limits | **Carried.** Section 9. One correction: the results-table `organization` row is the HTTP route only; in a flow block an org read with no org is "not found" (9). | |
| 13 | `defineResource` field `edges`, `true` or `{ vocabulary, maxEdges }`, defaults, past `maxEdges` or outside vocabulary | **Carried.** 10. Past `maxEdges` is a cull (superseded first, then lowest confidence), not an error; outside the vocabulary `add` throws. | edges:30-123 |
| 18 | Edge storage in the resource's own state, no separate key | **Carried.** 10, 0. | |
| 19 | State shape: `edges: Edge[]` default `[]` injected; existing `edges` field left alone; `stateSchema` must be a `z.object` | **Carried** (the "corrected by pass 5" wording is right). | res:658-690 |
| 20 | Edge record fields | **Carried.** 10. `createdAt` and `id` are framework-assigned. | |
| 21 | `.edges` timing: reads sync, writes async | **Carried.** 10. | |
| 22 | Edge operations table incl. `depth` clamp 6, `shortestPath` null / `[]` | **Carried, corrected.** `all` takes only `{ at }`; `all()` with no argument returns superseded edges too. | 10 |
| 23 | Edge limits: sizing, not a graph DB | **Carried.** | edg:76-80 |
| 24 | Resource visibility: server copy vs client projection, secret never exposed | **Carried.** 12.2 (`secret`), 12.1. | |
| 25 | Reactive bindings vs `onInstance*`; callbacks awaited, logging-only context; single resources only `reactTo` | **Carried** (the "corrected by pass 5" wording is right). 8.2, 11. | |
| 26 | `reactTo` entry shape | **Carried.** 11. | |
| 27 | Which kinds each form accepts | **Carried.** 11 table. | |
| 28 | Which write fires which kind | **Carried.** 11. | |
| 29 | `ResourceChange` payload and null cases | **Carried.** 11. | |
| 30 | `resourceChangeSchema` and `ResourceChange` | **Carried.** 11. | |
| 31 | `ResourceContentChange`; `resourceContentChangeSchema()` | **Carried.** 11. | |
| 32 | Content reactions share timing, depth cap, `when`, trace; `readContent()` returns new body | **Carried, one correction:** `when` on a content binding receives `ResourceContentChange`, not a state payload. 11. | chg:143-149 |
| 33 | What fires `contentUpdated`: server writes yes, `client.content.update` no | **Carried.** 11. | rea:132 |
| 34 | Reaction timing: blocking, no `mode`, a throw fails the turn, `.sideChain()` | **Carried.** 11. | |
| 35 | `evicted` semantics | **Carried.** 11. | |
| 36 | Cascade limits 8 and 1000, `reactive_cascade_exceeded` | **Carried** ("corrected by pass 5" is right). 11. Also `reactive_input_invalid`, not in the row. | rd:44-45 |
| 37-43 | Search rows: `searchResources` calls projected hook; result identity; `globResources` options; `llmReadable` gate; `grepResourceContent` options; `searchResources` options; what text tools match; grep not sandboxed | **Carried.** 13.2. | |
| 44-52 | Faceted rows | **Carried, with corrections.** Section 19 (facets) below. | |

Rows I dropped: none dropped whole. Pieces dropped as mechanism (cut, not moved): breadth-first and in-memory description of edge traversal (edg:78); the order of the create route's two writes and the residual race windows beyond the three outcomes (ca:528-566); the `reindex` concurrency of 8 (`facet:197`, internal, unobservable except by timing); "a lazy collection's cost one store read per key" beyond the `prefetchMode` row.

### 18.1 Faceted collection table lines (section 9 of the old searching page)

`defineFacetedCollection(config)` returns `{ collection, search, reindex, resources }`. facet:151-165, 417.

| Fact | Source |
|---|---|
| Config: the collection fields except `stateSchema`, `reactTo`, `client`, `writable`; plus `name` (the accessor), `evaluator` (an evaluator block), `stateSchema` (a `z.object`, the app's fields). | facet:114-148 |
| `name` is the key the collection is registered under; pass `tickets.resources` to `defineFlow({ resources })`, which also carries resources the evaluator declares; do not register another entry under `name` (it replaces the collection and nothing is indexed). Your own blocks declare `resources: { tickets: tickets.collection }`. If nothing, or a different collection, is registered under `name`, the **first body write fails** with an error naming `resources` (`defineFacetedCollection "<name>": no collection is registered under "<name>". Pass the returned resources to defineFlow({ resources }) …`); the body is already saved; only the turn fails. | facet:437-460; sea:328-330 |
| The evaluator's input is the body (a string); questions must be a fixed object, not a function. | facet:151-165; sea:326 |
| State fields added: `facets` (answers keyed by question id, stored as returned; `null` until classified and whenever a classification failed or was superseded) and `indexedAs` (token of the write the facets describe; `null` when none). Reserved: a `stateSchema` that already declares either is refused. | facet:104-113, 189; sea:348 |
| Definition-time refusals (each throws `defineFacetedCollection "<name>": …`): non-evaluator; function questions; evaluator whose input schema rejects a string and has no `connectInput`; evaluator with a `flowConfigSchema`; evaluator resource under the collection's own accessor; evaluator single resource with `prefetchMode: "lazy"`; `stateSchema` not a `z.object` or already holds `facets` or `indexedAs`; a question id `minConfidence`; parameterised key pattern; `writable: false`; `client.content.create` or `update`; own `reactTo.contentUpdated`; empty `name`. | facet:205-300; `packages/core/test/faceted-collection.test.ts` |
| Classification runs on every body write inside a flow turn, whatever the source (action, tool, agent). Order: (1) a blocking write clears `facets` and stamps a fresh `indexedAs` token, so a failed classification leaves no facets; (2) classification runs on a side chain, so a failed or refused model call shows in the trace and does not fail the save, and facets are in place when the turn ends; (3) answers are written only when the token still matches, so a newer write's answers win. The guard commits with the write; on the filesystem store it holds within one process only. Nothing retries. | facet:1-37; sea:154-162; `goals/index-time-facets` |
| `search` block: input one optional value per **choice** question (its option keys) plus optional `minConfidence` in [0,1]; output `{ keys: string[] }`; runs no model; a document with no facets never matches; as an agent tool the options appear as allowed values. `minConfidence` is tested only for the choices the query names (`matchesFacets`, facet:350-366): a named choice whose stored answer has no confidence fails it. A query naming no choice matches every row with facets, whatever `minConfidence` is. Yes/no and scale answers are stored on `facets` but not offered to search. `facet:85-98, 340-395`; sea:164-180. |
| `reindex` block: input `{ force?: boolean }`; classifies documents with no facets (every document with `force`); output `{ reindexed: string[], failed: string[] }`; failed documents keep no facets and are not retried; a document a newer write rewrote mid-reindex is in neither list. | facet:96-101; sea:182-188 |
| Clients may read and delete documents in a faceted collection but cannot create or edit bodies (`client.content.create` / `update` refused). | facet:130-136; sea:186 |
| Projected collections are not built by `defineFacetedCollection`: pass facet values in the `filter` of the `list` query. | sea:178 |
| If text lives in state rather than the body, `defineFacetedCollection` does not fit: bind `created` and `stateUpdated` yourself with a `when` that checks the text fields changed. | sea:188 |
| An existing hand-built `contentUpdated` reaction that stores `facets` and `indexedAs` moves over by deleting both fields from `stateSchema`. | sea:190-192 |

## 19. Contradictions: existing pages vs code (verify; the page follows the code)

| # | Existing page says | Code or tests say | Where |
|---|---|---|---|
| A | `useResource(session, "soul")` returns `{ clientData, fetchContent }` (ca:330-356). | `useResource(def, { session })`; session scope returns `{ value, stale }`; no `fetchContent`. | `useResource.ts:131-175` |
| B | `useResourceCollectionItem(session, "artifacts", topic)` (ca:301). | No such hook. `useCollectionResource(session, ref, topic)`. | `index.ts:61` |
| C | `useResourceCollection` returns `{ items, actions }` with `items` keyed by storage key and `fetchContent` per item (ca:387-427). | Returns `{ list, get, query, actions, refetch, prefetched, count, live, wrap }`. | `useResourceCollection.ts:76-110` |
| D | `useResourceCollectionList` returns `pagination?.hasMore` (col:506-514); list response `{ items, pagination: { offset, limit, total, hasMore, nextOffset } }` and `?limit=&offset=&topicPrefix=` (col:500, 520-527). | Cursor paging: `{ items: [{ topic, storageKey, clientData? }], nextCursor? }`; params `limit`, `cursor`, `topicPrefix`; hook returns `hasMore`, `loadMore`. | `rr:480-560`; `useResourceCollectionList.ts:60-100`; `types/index.ts:362-365` |
| E | `fsd.resources.getCollectionItemContent`, `createCollectionItem`, `deleteCollectionItem` (ca:439-447). | `getCollectionResourceContent`, `createCollectionResource`, `deleteCollectionResource`. | `cl:488-523` |
| F | Snapshot `resources.session.artifacts.items["artifacts/readme.md"].clientData` (ca:243-265). | A collection entry is `{ count, prefetched? }`; `prefetched` is a list of `{ topic, storageKey, clientData?, content? }`. A single resource is `{ clientData?, content? }`. | `ru:419-500` [impl] |
| G | Requests for resources without `client` return 404 (ca:465; ca:450 "404 for a resource with no `client` config"). | `404` only for a ref the flow does not declare; a declared resource with no `client` answers `403 … not permitted`. | `rr:75-130, 215-235` [impl] |
| H | Without `expose`/`exclude`/`data`, the full state is sent (ca:38; also the `ResourceClientConfig` doc comment, res:62-65). | A single resource sends no `clientData` without a projection (ca:126-133 agrees); a collection with `state.read` sends full state. | `cproj:226-258` |
| I | Hook context "provides `log(message)` and `scopeType`. Hooks are synchronous." (col:365). | Context has `log`, `scopeType`, `scopeId`, `cell`, `orgId`; hooks are awaited and may return a Promise. | coll:32-70, 207-218; reg:1789-1797 |
| J | Owner refusals were quoted with an older wording that called the resource by another name (col:194, col:230). | `A resource in an owner-private collection is readable only by the user it belongs to.`; `A resource in an owner-writes collection is written only by the user it belongs to.` | `owner-private.ts:47, 53`; `owner-private-fence.test.ts:28` |
| K | "`list()` or `count()` reads the entire prefix" on a lazy collection (col:332). | True of `list()` with no prefix and `count()`; `list(prefix)` loads only that sub-tree. | reg:2005-2060 |
| L | The reactive `when` "receives the same `ResourceChange`" (rea:153). | A `contentUpdated` binding's `when` receives `ResourceContentChange`. | chg:143-149 |
| M | Trace path `__reactive__/<resource-ref>/<kind>` (rea:185). | Path ends `#<n>` (a per-run counter). | rd:285 |
| N | `nodeRef` helper (edg:184) shown without an import path. | `@flow-state-dev/core/graph`; not on the root export. | `graph/index.ts`; `package.json:71` |
| O | `client.content.update` lets a client edit content (ca:51-55, 427). | Browser create, update and delete routes work at **session scope only**; user and org collections answer `501`. User and org writes go through `runBy`. A **single** resource's content cannot be updated from the client (`400`). | `rr:249-251, 354-360` [impl] |
| P | Collections "accessed by the property name" and `ctx.resources.get(name)` (ov:250). | Both exist. | res:548-552 |
| Q | `useResource(...)` / `fsd.resources` are the browser's only ways to a user or org resource. | `client.resource(def)` and `useResource(def)` read and write user and org resources with no session, through `runBy`. Absent from the existing pages. | 12.4, 12.5 |

Items on the existing pages I could not confirm and **left off**: the DevTool "Raw / Client / Diff" toggle wording (ca:641) is DevTool UI, not this page's subject; the `useResource` "if `prefetch: true`, `fetchContent()` returns the cached snapshot content" claim (ca:356) describes a return shape that no longer exists.

## 20. Answers to the three lookups

1. **What is a resource's full storage key?** (scope type, scope id, `path`). `path` is `ref` or the first accessor (single) or the pattern-resolved key (collection instance). Scope id: session `[tenant:]sessionId` (lineage root with `sharedToLineage`); user `<user>:~org:<org>[:<flowInstanceId>]`; org `<org>[:<flowInstanceId>]`; the instance suffix only with `flowIsolation: true`. `uri` is `${scope}/${path}` and omits the scope id. 5.1, 5.2.
2. **Which resources load for a request?** The flow's `resources` map (every request) plus the resources in the dispatched action's block tree (when it runs), minus lazy ones until first use; an undeclared resource never loads; projected collections never load a copy. 16.
3. **What can the browser read without `expose`?** Nothing when there is no `client` block. With a `client` block: a single resource gets no state (only content its `content` flags allow); a collection with `state.read` gets each item's full state; a collection with no `state.read` gets `count` and `topic`s only. A `secret` field is never sent. 12.1.

## 21. Things I could not settle (for pass 5 to run, or the caller to decide)

1. `resourceTools()` create, update and delete do not check `llmWritable` in code (13.1). The page states it as the behaviour.
2. A projected collection's `reactTo`: accepted at definition; I found no public way for an app to report a change. Do not document firing.
3. User-scoped data is per (user, organization). The existing scope table (ov:380-384, "Across sessions for a user") omits the organization; `sto` already says "for that user in that organization". The page's scope table should carry it.
4. `res:206-208` (owner-pinned instance note) conflicts with `keys:43-56` (the pin no longer chooses a key). Left off the page.
5. `runBy` / `client.resource` / `useResource(def)`: new, undocumented, and a teaching change (a browser can write a user or org resource). The Reference page needs the section; a Concepts page may need a pointer.
6. Whether the page lists the three `ownerPrivate`, `ownerWrites`, `indexes` and `stampOrgId` options in the main field table or a sub-table; the old pages bury them in prose, and they are exact-answer material.

## 22. Revise round 1 (changes to the sheet)

- Owner refusal messages: `A resource in an owner-private collection is readable only by the user it belongs to.` and `A resource in an owner-writes collection is written only by the user it belongs to.` (`packages/engine/src/resources/owner-private.ts:47,59`; section 19 row J). The page now uses these.
- `getOrPatchState`: `existing !== undefined` is the test, so a stored `null` is returned and `compute` never runs. `packages/core/src/types/resource.ts:786-803`.
- `searchResources` on projected collections: `score` is `page.items.length - i` per collection, so the first hit has the highest score and the last has `1`. `packages/core/src/tools/resource-search-tools.ts:240-246`.
- `llmWritable` gates only `writeResourceContentTool()`. `llmReadable` gates the content, glob, grep and search tools and `resourceTools().readResource`. `createResource`, `updateResource` and `deleteResource` are gated by the flow's `resourceVisibility` rule only. `packages/core/src/tools/resource-tools.ts:360-375`, `resource-content-tools.ts:56-71`.
- Concurrent writes: `incState`, `pushState` and `updateState` each re-run against the winner's stored value when they lose a race (the registry's `updateState` hands the updater a refreshed clone on every retry, `packages/engine/src/context/resource-registry.ts:1299-1320, 2230-2250`). The filesystem store guards a key in-process only (`ResourceRef.incState` doc comment, `packages/core/src/types/resource.ts:466-478`).
- Faceted stale-answer guard: the page states only that earlier answers are discarded, and that the filesystem store guards within one process. The memory-store cross-process wording is dropped (an in-memory store does not span processes).
- `ctx.resources.get(name)` returns the declared handle and `ctx.resources.list()` an array of every declared handle (`ResourceRegistry`, `packages/core/src/types/resource.ts:539-553`).
- `ClientDataOf` with no projection or with `exclude` includes `secret` fields in its type; their values are never sent (section 12.2).
- `onInstance*` context: the page lists `log`, `scopeType`, `scopeId`, `orgId` and leaves `cell` out (a storage coordinate, section 8).
