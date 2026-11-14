# Facts for Resources (C-08, concept)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests, `goals/`, one example. No spec, issue, changeset or `docs/internal`.

Paths are from the repo root. Abbreviations:

- `core` = `packages/core/src`
- `ct` = `packages/core/test`
- `et` = `packages/engine/test`
- `ov` = `apps/docs/docs/resources/overview.md`
- `st` = `apps/docs/docs/resources/storage.md`
- `co` = `apps/docs/docs/resources/collections.md`
- `ca` = `apps/docs/docs/resources/client-access.md`
- `fig` = `apps/docs/docs/resources/state-vs-resources.svg` (the published figure the page redraws)
- `kb` = `examples/knowledge-base/src` (the one example that uses a collection)

Legend: **[page]** the page states it. **[ref]** it belongs on `reference/resources`; the page links, does not state it. **[verify]** not confirmed against running code; keep off the page or soften. **[cut]** history or mechanism; never on the page.

Page scenario (suggested, from the sitemap's own questions): a support desk. `refundPolicy` is one document (session? user? org? see 3), `draftReply` is a block that carries it, `ticketNotes` is a collection. These names are not in the code; every fact below is about the framework.

## 1. What a resource is (opening, model figure)

- A resource is named, stored data a block declares. It has two parts: typed **state** (fields, validated by a Zod `stateSchema`) and a **content** body (a string: markdown, code, prose). `ov:10`, `ov:39`, `fig` (labels "CONTENT: the body", "STATE: its own typed fields"). [page]
- `defineResource({ scope, stateSchema, content, writable })` returns the definition. `scope` and `stateSchema` are required in practice: `scope` throws without `"session" | "user" | "org"`. `core/types/resource.ts:596` (signature), `core/types/resource.ts:623-627` (scope check), `core/types/resource.ts:310` (`writable`), `ov:35-37` (message text; [ref]). [page: the call; the throw is [ref]]
- `content` is the initial body. Alternatives to a literal string (`contentFile`, `contentTemplate`, `contentTemplateRef`, `render`) exist; at most one content source is allowed. `core/types/resource.ts:612-615` (throw), `core/types/resource.ts:260-287` (fields). [ref]
- `writable` defaults to `true`. `ov:48`. `core/types/resource.ts:310`. A resource with `writable: false` refuses state writes with `resource_read_only`. `ov:222`, `co:438`. [ref]
- State and content are two things in one record. State is versioned and has atomic writes; content is not versioned and a later write replaces an earlier one. `ov:39`; `fig` ("state versioned; content is not"). [ref: the page and its figure do not state versioning; revise round 2 dropped the figure note]
- State writers on a resource handle: `patchState` (merge), `setState` (replace), `updateState` (read-modify-write), `incState` (add to a number field), `pushState` (append to an array field). `core/types/resource.ts:445-523` (`ResourceRef`), `ov:84-103`. [page: name patchState and one more in one short example; the full list, delta refusals, JSON storage rules, concurrency are [ref]]
- The handle's `state` is a synchronous getter; the writers return `Promise<void>`, not the new state. `core/types/resource.ts:454-470`, `ov:103`. [page, one clause]
- Content reads: `readContent()` (renders a template if `render` is set) and `readContentRaw()` (the stored body); `writeContent(content)` writes. `core/types/resource.ts` `ResourceRef` (`readContent`, `readContentRaw`, `writeContent`), `ov:244-261`. [page]
- A handle carries `path`, `scope`, `uri`; `uri` is `${scope}/${path}`, e.g. `session/files/readme.md`. `core/types/resource.ts:454-461` (`path`, `uri`, doc comments), `ov:388-413`. [ref: identity]. The page may use `session/draft` style names only inside the figure, as the published figure does (`fig`).
- Storage: a resource is a record of its own in the resource store, keyed by scope then path; session state is fields on the session record. `fig` ("their own store, keyed by scope, then path"; "on the session record"). `st:389` ("Collection instances are stored in the same flat `resources` map as static resources"). [page: one sentence; store backends are [ref]]
- Which store holds it: in-memory by default (gone when the process exits); filesystem, SQLite, Postgres persist. `apps/docs/docs/persistence/overview.md:32` (memory), `:45` (filesystem), `:7`, `:114` ("Resources: Attached to scopes; Always persisted with their scope"). [page: a single clause, "it lasts as long as the store does"; the adapters are [ref]]

### Four questions for the stored part (resource)

| Question | Answer | Source |
| --- | --- | --- |
| Who owns it | Its scope: the session, the user, or the org named by `scope`. A resource hangs off that identity. | `core/types/resource.ts:19-24` (scope type), `core/types/resource.ts:190-197`, `st:60` |
| Who can see it | Blocks that declare it (`ctx.resources.<name>`); the model only when `llmReadable`/`llmWritable` are set and a tool is wired; the browser only when `client` is set. Section 5. | see 5 |
| Where it is stored | The resource store of the scope's store (memory, filesystem, SQLite, Postgres), keyed by scope then path. | `fig`, `persistence/overview.md:90-103` |
| How many exist | A single resource is one per scope identity (one per session, per user, per org). A collection is as many as are created, up to `maxInstances` if set. | `core/types/resource.ts:446-461` (path for single = accessor/ref), `co:7-9` |

- At user and org scope a resource is, by default, shared across every flow the same `userId` or `orgId` touches. `flowIsolation: true` on the resource, or the flow's `isolateUserState` / `isolateOrgState` default, narrows it to the flow instance; the resource's own `flowIsolation` wins in both directions. An owner-pinned instance stores a user-scoped resource per (org, user), shared only with that user's other owner-pinned instances in the org. `core/types/flow.ts:679-696`. `st:62-66` (table), `core/types/resource.ts:207-234` (doc comment). [page: one sentence on the default; the rest is [ref]]
- `flowIsolation: true` on a session-scoped resource throws. `core/types/resource.ts:629-633`. [ref]
- `sharedToLineage: true` (session scope only) gives one resource across a conversation and the background sessions dispatched under it. Without it a background run's session-scoped resource is a different, empty one. `st:140-159`, `core/types/resource.ts:236-258`, `ct/resource.test.ts:21-37`. [ref; it can earn one sentence under scopes if the page has room]

## 2. State or a resource? (section, figure "State and resources")

- Scope state is a flat typed object on a scope (session, user, org). Every block in a flow reads and writes fields of it directly; field names are one shared namespace. `st:9-23`, `ov:55`, `fig` ("Flat fields. One namespace that every block in the flow shares."). [page]
- Two blocks declaring a state field of the same name with different types conflict at build time. `st:93`. [page, one clause for "collide"; the throw text is not cited]
- A resource is its own named record, with typed state and a content body, so it cannot collide with another resource's fields: it is reached by name through the registry. `st:95`, `ov:55`. [page]
- Use state for flags, counters, mode switches, small settings; use a resource for data with its own name and content: documents, plans, notes, knowledge. `st:23`, `st:54`, `ov:57`, `fig` ("Flags, counters, small settings", "documents, plans, artifacts"). [page]
- Decision rows: simple scalar or enum, counter or flag = state; has content and metadata, needs its own identity, complex nested structure = resource; unknown count = collection. `st:82-89`. [page, as sentences or a table of at most six rows]
- For private scratch data one block uses, a resource avoids sharing the flow's state namespace. `st:97-128`. [page, one clause]
- "Choose by the data's nature and lifecycle, not by whether the client sees it." `st:186`. [page]
- Both live on the same three scopes. `st:7`. [page]
- Answer-key item for sitemap question 1 (the refund policy: one document every reply should respect): a resource, because it is a document with its own name and a body; scope **org** if it is the same for everyone in the org, **user** if each user has their own, **session** if it belongs to one conversation. `st:130-138` (scope table: session = belongs to this conversation, temporary working data; user = survives across conversations, personal; org = shared across users), `ov:380-386` ("Session for conversation-local artifacts, user for personal notes and saved snippets, org for shared knowledge bases and team documents"). [page] The page must pick one (org) and say why; the facts above support either.
- Org-scoped resources in a client write on the default write flow need a `canWrite` rule or the app refuses to start. `core/types/resource.ts:342-350`, `core/types/resource.ts:683-720` (doc comment on `validateRunBy`). [ref]

### Four questions for the stored part (session state vs resource: the one thing the figure contrasts)

Session state is not a resource, but the figure sets it beside one, so the page answers for both.

| Question | Session state | Resource |
| --- | --- | --- |
| Who owns it | the session (or user, org) record it is a field of | its scope identity, as a record of its own |
| Who can see it | blocks in the flow; never the browser unless the scope's `client` block exposes it (`expose`, `derived`) | blocks that declare it; browser only through the resource's `client` config |
| Where | on the scope record | the resource store, by scope then path |
| How many | one object per scope | one per declared name; a collection holds many |

Sources: `st:169-186` (scope state never visible to clients; `client.expose`/`derived`), `fig`, `st:187`. [page]

## 3. A resource a block declares (smallest example)

- A block declares a resource with a flat `resources` map on its config: accessor key to definition. `core/types/block.ts:1188-1196` (`DeclaredResources`), `ov:329-341`, `ct/declared-resources.test.ts:72-83`. Works on `handler`, `generator`, `router` (and so on): `ct/declared-resources.test.ts:128-186`. [page]
- The accessor key is what you read on `ctx.resources`; the resource's own `scope` decides where it is stored. The two are independent. `core/types/block.ts:1188-1196`, `ov:331`. [page]
- In the block, `ctx.resources.<key>` is the handle; the registry is typed from the block's declared map. `core/types/block.ts:380-390`, `core/types/resource.ts` (`ResourceRegistry`, `:548`). `ctx.resources` also has `.get(name)` and `.list()`. `core/types/resource.ts` `ResourceRegistry`; `ov:249-250` (`ctx.resources.get("artifact")`). [page: `ctx.resources.<key>` only; `.get` is [ref]]
- An undeclared name is a type error on `ctx.resources`. `core/types/resource.ts` doc on `ResourceRegistry` ("an undeclared name is a missing-property error"). [page, one clause]
- A resource is declared where it is used: no flow-level entry is needed. `ov:343`, `ct/flow.test.ts:464-481`. [page]
- The same definition can also be declared on `defineFlow({ resources })`; those load on every request (section 6). `ov:63`, `ov:70-79`. [ref/page, one clause]

Code the page can show (not in the repo; written to type-check against the signatures above): a `defineResource` for `refundPolicy` with `scope: "org"`, `stateSchema: z.object({ version: z.string().default("v1") })`, `content: "..."`; a `handler`/`generator` named `draftReply` with `resources: { refundPolicy }`; `await ctx.resources.refundPolicy.readContent()`. Types: `core/types/resource.ts:596`, `core/types/block.ts:380-390`, `core/blocks/generator.ts:608-614` (`prompt`, `tools`). Model id `openai/gpt-6-luna` (`examples/hello-chat/src/flows/hello-chat/flow.ts:17`).

## 4. Collections (section)

- Static resources have a fixed name. A collection is a typed set of resources created at runtime when the number of instances is not known ahead. `co:7`, `ov:311`. [page]
- `defineResourceCollection({ pattern, scope, stateSchema, ... })`. `pattern` is a key pattern: `files/*` (one level), `files/**` (any depth), `[topic]/notes` (a bracketed parameter). `core/types/resource-collection.ts:418`, `:73-74`, `co:40-46`. [page: `**` form only; the other two [ref]]
- `**` must be the last segment. `core/test/resource-collection.test.ts:174`, `co:46`. [ref]
- The property name you assign in `resources` is how you reach the collection at runtime, not the pattern string. `co:9`, `co:25-33`. [page]
- On `ctx.resources.<key>`: `create(key, initial)` makes an instance and returns its handle, and throws if it exists; `get(key)` rejects if not found; `getOptional(key)` returns `undefined`; `getOrCreate`; `upsert`; `list(prefix?)`; `count()`; `delete(key)`. All return Promises. `core/types/resource-collection.ts:322-401`, `co:52-81`. [page: `create`, `get`, `getOptional`, `getOrCreate`, `upsert`; the rest [ref]]
- Each instance is a resource handle: it has its own `state` and its own content, and the same writers. `co:83`, `core/types/resource-collection.ts:329` (returns `ResourceRef`). [page]
- Instances are stored under keys the pattern builds: `files/**` with `create("readme.md")` gives `files/readme.md`. `co:389`, `ov:394`. `collection.create("key")` prepends the pattern prefix. [page, one sentence]
- A collection caps itself with `maxInstances`; at the cap, `eviction: "none"` (default) makes `create` throw, `"lru"` evicts the least recently accessed, `"oldest"` the first created. `eviction` other than `"none"` without `maxInstances` throws. `core/types/resource-collection.ts:115-116`, `:467-473`, `co:273-283`. [page: one sentence, "set a cap"; policy table [ref]]
- `findBy(index, value)` with `indexes` declared on the collection looks items up by a state field. `core/types/resource-collection.ts:382-391`, `co:159-207`. [ref]
- Other collection kinds: owner-private (`ownerPrivate`), owner-writes (`ownerWrites`), projected (read-only view of app-owned data; B-35-ish), faceted (`defineFacetedCollection`). `co:209-269`, `co:11`, `co:578`. [ref, or one link]
- Eager vs lazy loading (`prefetchMode`), `prefetchWindow`, lifecycle hooks (`onInstanceCreated`, `onInstanceUpdated`, `onInstanceDeleted`): `co:285-367`, `co:543-564`. [ref]
- Parallel branches creating distinct instances is safe; two branches writing the same key are last-writer-wins. `co:87-89`. [ref]
- Example that uses a collection: `kb/concepts.ts:49-56` (`defineResourceCollection({ pattern: "concepts/**", scope: "user", stateSchema, edges: true, llmReadable: true, llmWritable: true })`), declared on the flow at `kb/flow.ts:206` (`resources: { concepts: kb.collection }`). [page: shape only]
- Sitemap question 3 answer key: ticket notes pile up, so a **collection**, `defineResourceCollection({ pattern: "ticketNotes/**", scope: ... })`; a block adds one with `resources: { notes: ticketNotes }` and `await ctx.resources.notes.create("<key>", { ... })`. `co:25-33`, `co:61`. Note: `create` of an existing key throws; `getOrCreate` or `upsert` is the safe form. `core/types/resource-collection.ts:334-347`, `co:120-127`. `get(key)` rejects when missing; `getOptional` returns `undefined`. [page]
- A collection holds shape, not a bounded set: "If the set is bounded and predictable (three artifact slots), a static resource with an array or record in its state is simpler." `co:400`. [page, one clause]

### Four questions for the stored part (collection instance)

| Question | Answer | Source |
| --- | --- | --- |
| Who owns it | The scope the collection declares (`session`, `user`, `org`), by the scope identity | `core/types/resource-collection.ts:99`, `co:389` |
| Who can see it | Blocks that declare the collection; the model if `llmReadable`/`llmWritable`; the browser if `client` set (count always shown once client-visible, items only with `state.read`) | `core/types/resource-collection.ts:146-152`, `core/types/resource.ts:98-106`, `co:479-494` |
| Where it is stored | The same resource store as single resources, one record per instance, under `pattern prefix/key` | `co:389` |
| How many | Unbounded unless `maxInstances` is set | `co:281`, `core/types/resource-collection.ts:115-116` |

## 5. Who can read it: the model, your code, the browser

Three readers; each is off or on by what the definition says.

**Your code (blocks).**
- A block reads and writes through `ctx.resources.<key>` when it declares the resource. `core/types/block.ts:380-390`. [page]
- A `writable: false` resource refuses writes from blocks (`resource_read_only`); reads still work. `ov:222`, `co:410-438`. [ref]

**The model.**
- A resource is not automatically visible to a generator. `llmReadable` and `llmWritable` default to off. `ov:289`, `core/types/resource.ts:288-289` (fields), `core/types/resource-collection.ts:146-152` (doc: "Default `false`"), `ct/resource-content-tools.test.ts:30` (config defaults `?? false`), `ct/resource-content-tools.test.ts:82-83` (`llmReadable: false` stays out). [page]
- With `llmReadable: true`, a generator wired with `readResourceContentTool()` can read the resource's content, and find it with `grepResourceContent` and `searchResources`; with `llmWritable: true`, `writeResourceContentTool()` can overwrite the body. `ov:289`, `co:450-451`, `ct/resource-content-tools.test.ts:96-105`. The write tool gates on `llmWritable` alone. `core/types/resource-collection.ts:149-152`. [page: the two flags and the two tools]
- The tools address a resource by its scope-qualified `uri`, e.g. `session/files/readme.md`; results of the glob/grep tools feed the read tool. `ov:293`. [ref]
- A collection declares the flags once, and they apply to every instance. `co:448-453`. [page]
- The model reads content through these tools, not by the block putting state in the prompt; whether a block passes resource content into a prompt is the block's code. (Derived from `ov:289`: "Resources are not automatically exposed to generators.") [page, careful: do not claim state is injected]
- A flow can narrow what the model reaches with `resourceVisibility`, a function returning `"visible"`, `"read-only"` or `"hidden"` per resource; a hidden resource does not exist to the built-in tools. It does not affect `ctx.resources.<name>` in your own blocks. `core/types/flow.ts:674`, `ov:295-307`, `et/resource-visibility.test.ts:110-137`. [ref]
- `secret: [...]` lists state fields that never leave the server, including to the browser; they are omitted from the model-facing instance read too. `core/types/resource.ts:289-298` (doc), `core/types/resource-collection.ts:140-146`. [ref]

**The browser.**
- Resources live on the server. Without a `client` property the resource is invisible to clients. `ca:7`, `ca:36`, `core/types/resource.ts:324` ("Omit to keep the resource invisible to clients"). [page]
- A `client` config opens two channels: `content` (permissions: `read`, `prefetch`; on collections also `create`, `update`, `delete`) and a state projection (`expose`, `exclude` or `data`; at most one). `core/types/resource.ts:30-92`, `ca:36-57`. [page: `client` exists and what `expose` does; the permissions table is [ref]]
- `expose: ["tone"]` sends only those fields; with none of the three set, the full state is sent on a collection (when `state.read`) and nothing from a single resource unless a projection is set. `ca:133`, `core/types/resource.ts:70-73` ("With none set, the full state is sent to the client") vs `ca:133`: "On a single resource, `clientData` is included only when you declare `expose`, `exclude`, or `data`." [verify: these two sentences disagree for a single resource; use only `expose` on the page]
- Setting more than one of `expose`, `exclude`, `data` throws at definition. `ca:135-141`, `core/types/resource.ts:70-73`. [ref]
- A collection's `count` is emitted for a client-visible collection; items need `client.state.read: true`. `core/types/resource.ts:98-106`, `co:479-494`. [ref]
- React: `useResource`, `useResourceContent`, `useResourceCollection`, `useResourceCollectionList`; HTTP endpoints; live updates; the manifest. `ca:291-460`, `manifest.md:86-108`. [ref: `reference/resources`]
- The figure's dashed arrow (`ONLY WHEN EXPOSED`) from resources to the browser: `fig` ("sees neither unless a client config exposes it"; the published figure states this for both session state and resources). For session state the exposing config is the scope's `client` block, for a resource its own `client`. `st:169-184`. [page]
- The manifest lists every resource that opts into any client-visible affordance, per flow kind; `GET /sessions/:id/manifest`; `useResourceManifest`. `manifest.md:7-55`, `:102-108`. [ref]

## 6. It travels with the block

- A block's `resources` map bubbles up: a sequencer collects the declarations of every step, a router those of its routes, and `defineFlow` merges the result into the flow's `resources`. `ov:360`, `core/flow/defineFlow.ts:749-762` (`collectBlockResources`), `ct/flow.test.ts:464-481`, `ct/declared-resources.test.ts:370-600` (sequencer `.step`, `.parallel`, `.forEach`, `.branch`, nested sequencers). [page]
- So including a block in a flow installs its resources, session-scoped ones included; the flow does not have to repeat the declaration. `ov:343`, `ct/flow.test.ts:464-481`, and for flow instances `ct/flow.test.ts:880-895`. [page]
- A child's resource does not enter the parent's own set (a sequencer's `ownDeclaredResources` stays its own) but is still collected for the flow. `ct/declared-resources.test.ts:280-368`. [cut: mechanism]
- Same accessor key, same `defineResource()` object: deduplicated, no conflict. Same accessor key, two different definition objects: throws `Resource conflict: "<name>" is declared with different defineResource() references. Use the same reference across blocks, or pick distinct accessor keys.` `core/blocks/internal/build-block.ts:61-82`, `ct/declared-resources.test.ts:238-254`. [ref; the page says "share one definition, not two copies of it" in a clause]
- A flow-level declaration of a name a block also declares must be the same definition object; otherwise `defineFlow` throws `Resource conflict in flow "…"`. `ov:360`, `ct/flow.test.ts:540`. [ref]
- A capability can carry resources too (resources "declared by this block, the flow it lives in, or any capability it uses"). `core/types/block.ts:381-383`, `core/blocks/internal/resolve-capabilities.ts` (declared resources are merged). [ref/verify: not shown in a test cited here; keep to blocks on the page]
- Sitemap question 2 answer key: you drop `draftReply` into another flow, and its `refundPolicy` declaration comes with it: the other flow registers the resource without any `resources` entry of its own, and the resource is read at the scope it was defined with (org: the same org-wide document that other flows in that org already see, unless `flowIsolation: true`). Caveats the page must keep honest: the *definition* comes with the block; the *stored data* is keyed by scope and ref, and at org scope without `flowIsolation` is shared across every flow the same `orgId` touches. `st:62-66`, `core/types/resource.ts:207-234`. [page]
- The flow does not need to name every resource; but a flow may also declare resources itself, which load every request. `ov:63`. [page, one clause]

### Four questions for the stored part (the declaration)

| Question | Answer | Source |
| --- | --- | --- |
| Who owns the definition | the block that declares it; the flow merges it | `core/flow/defineFlow.ts:749-762` |
| Who owns the data | the scope identity of the resource | section 1 |
| Where is the data | resource store, by scope and path | `fig` |
| How many | one definition per accessor key per flow; one record per scope identity | `core/blocks/internal/build-block.ts:61-82` |

## 7. Does it load when nothing declares it? (sitemap question 4)

- No. A request loads content only for resources the flow declares (directly, or through its blocks). The context resolves each declared fixed resource by storage key and each collection by its pattern prefix, and reads exactly those. Content nothing declares is not pulled into the context, even if it is stored in the same scope. `ov:362-376`. [page; also says the undeclared data stays stored, `ov:376`]
- Stored data still exists and is reachable through the state endpoint; the scoping is about what a request loads, not what is persisted. `ov:376`. [ref]
- Flow-level resources (`defineFlow({ resources })`) load at the start of every request. Resources declared in a dispatched action's block tree load when that action runs; a sibling action's resources are not loaded. `ov:61-80`, `et/prefetch-waves.test.ts:94-141` ("Wave 1: loads the flow-level single resource regardless of action"; "Wave 2: loads only the dispatched action's collections, not siblings'"), `et/resource-load-trace.test.ts:246`. [page, short]
- `prefetchMode: "lazy"` defers loading further (a lazy collection loads per key touched; a lazy single loads when its declaring block dispatches). Default `"eager"`. `ov:82`, `core/types/resource.ts:316-323`, `et/prefetch-waves.test.ts:143-178`. [ref, one link]
- The DevTool's block trace shows resource loads per block (store fetch vs cache). `et/resource-load-trace.test.ts:1-11`, `co:342`. [ref]

## 8. What it gets you (page section; each point observable, tied to the example)

Candidates, each with its evidence. The page keeps three or four.

- **A resource is named, so it does not collide.** Two blocks can each have a `status` in their own resources; a flow's state fields share one namespace and clash. `st:93-95`. [page]
- **The block brings what it needs.** Drop a block into a flow and its resources install with it; no wiring in the flow. `ov:343`, `ct/flow.test.ts:464-481`. [page]
- **State and content in one record, with writes that don't lose updates.** `incState` and `pushState` are single guarded writes: two requests incrementing the same counter both land. Contrast with read-add-patch, which can lose one. `ov:175-179`, `core/types/resource.ts:471-500`, `goals/resource-concurrency/two-contexts-patching-one-resource-both-land/` (goal). [page: one sentence; race detail [ref]]
- **It lasts as long as its scope and store.** A user-scoped resource is there in the user's next session; on a persisting store it survives restarts. `st:130-138`, `persistence/overview.md:32,45,114`. [page]
- **Private by default.** Not seen by the model or the browser until the definition opts in. `ov:289`, `ca:7`. [page]
- **Only what is declared is loaded**, so cost follows the flow, not everything stored in the scope. `ov:376`. [page]
- **Concurrent edits at user/org scope through the client are checked by version**: a stale client write is refused and re-applied, so two people editing the same org entry both keep their change. `goals/resources-by-scope/a-pin-is-one-line-and-no-session-is-made-to-read/goal.md` (signal `b:both-changes-stored`). [ref: needs `runBy`; keep off the page]

## 9. How it fits with the others (neighbours)

- **State** (`ctx.session.state` etc.): flat fields; see 2. The page already says it; do not repeat in this section.
- **Items**: what a session records (messages and results), kept as items and covered on the sessions page. `persistence/overview.md:7`, `:114-115`. [page, one clause with a link; "separate store" is not stated]
- **Searching resources** (glob by path, grep by content, lexical search), **edges** (typed links between resources, `edges: true` on a resource or collection), **reactive blocks** (`reactTo`: run a block when a resource changes), **projected collections** (read-only view of app-owned data): each a link, none explained. `ov:415-422`, `co:570-578`, `core/types/resource.ts:328-336` (`reactTo`), `core/types/resource.ts:354` (`edges`). [page: links only; B-34 to B-37]
- **Memory** is built from resource-like stores; not cited here. [cut: no source read; leave out]
- Not a database: resources are named records a flow reads by key, with `list`/`findBy` on collections; there is no query language over state. `co:159-207` (equality-only `findBy`), `co:332` (`list()` scans the whole prefix on a lazy collection). [page, one clause, only if wanted; or [ref]]

## 10. Reference rows this page does not state (for `reference/resources`)

Fields of `defineResource` and `defineResourceCollection`; the scope-throw messages; `flowIsolation`, `sharedToLineage`, `runBy`, `canWrite`; `secret`; the five state writers and `getOrPatchState` (`ov:345-356`); delta refusals (`resource_delta_refused`, `resource_read_only`); what is stored and JSON round-trip (`ov:161-171`); concurrent writers; `readCommitted` (`ov:224-242`); templates; identity (`path`, `scope`, `uri`); patterns; `create({ replace })`, `upsert`; indexes and `findBy`; owner-private and owner-writes; eviction table; eager/lazy; lifecycle hooks; `writable`; LLM tools and `resourceVisibility`; client config, content permissions, projection shapes, HTTP endpoints, hooks, live updates, manifest.

## 11. Figures (facts for the two figures)

**State and resources** (redraw of `fig`):
- Left: the session's state, "on the session record"; fields such as `mode: "agent"`, `messageCount: 4` (the figure's own sample values; on the page use the support desk names instead); read as `ctx.session.state`. `fig`.
- Right: resources, "their own store, keyed by scope, then path"; each with CONTENT (the body) and STATE (its own typed fields); read as `ctx.resources.<name>`; a collection item is the same shape, one record per item (`session/files/readme.md`). `fig`.
- Annotations in the published figure: "The browser sees neither unless a client config exposes it". `fig`.
- Marks the sitemap adds: hatching on both (both outlive the request: both are stored with the scope), a dashed arrow `ONLY WHEN EXPOSED` to the browser. Hatching and dashed meanings: `docs/contributing/user-docs.md` figures table (outlives the request; lasts one action run). Whether the dashed outline means "one action run" conflicts with a dashed arrow: confirm in `user-docs-figures.md` when drawing. [verify]

**A resource travels with its block**:
- `draftReply` (a block) carries a `resources: { refundPolicy }` declaration; two flows each include `draftReply`; each flow's resource map then holds `refundPolicy` (arrow `INSTALLS`). `ct/flow.test.ts:464-481`, `ct/flow.test.ts:880-895`, `ov:343`.
- The stored data is keyed by scope and ref, not by flow (at org scope with `flowIsolation` off, both flows read one document). `st:62-66`. The figure should not suggest each flow gets its own copy.

## 12. Flagged for the page's caller

- `ca:133` and `core/types/resource.ts:70-73` differ on what a single resource with no projection sends to the client. The page avoids the case. [verify against a running host before stating either]
- `ov:57` links "State vs Resources" to `/docs/resources/storage`; that page and `ov:51-57` overlap, so there is one story to tell, not two.
- Old docs call a resource's content "like a file" (`ov:10`). The page may use "document" for the content body; "file" invites the filesystem store confusion (the filesystem store writes resources as real files, `persistence/overview.md:45`).
- No example in `examples/` or `labs/` declares a resource on a block that is shared across two flows; the portability claim rests on `ct/flow.test.ts` and `ct/declared-resources.test.ts`, not on a running pair of flows. [verify if the page wants to show two flows running]
- The scenario names (`refundPolicy`, `draftReply`, `ticketNotes`) are inventions for the page and appear nowhere in the code. The layout the page's code titles use is `src/flows/<flow>/blocks/<block>.ts` per `docs/contributing/user-docs.md`.
