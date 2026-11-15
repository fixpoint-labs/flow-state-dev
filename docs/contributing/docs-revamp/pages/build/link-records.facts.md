# Facts for Link records with edges (B-35, recipe)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests, `goals/`, one example. No spec, no `docs/internal/`, no `CLAUDE.md`, no PR or commit text. The sitemap's `Sources` line (`resources/edges`, keep) is an existing user doc, so it is cited. A claim a test pins is marked **[test]**. One claim was checked by type-checking a scratch file against the package source (marked **[tsc]**); the scratch file is deleted. Nothing else was run.

Paths are from the repo root. Abbreviations:

- `ed` = `packages/core/src/graph/edge.ts`
- `re` = `packages/core/src/graph/resource-edges.ts`
- `tr` = `packages/core/src/graph/traverse.ts`
- `gi` = `packages/core/src/graph/index.ts`
- `rs` = `packages/core/src/types/resource.ts`
- `rc` = `packages/core/src/types/resource-collection.ts`
- `rt` = `packages/core/test/resource.test.ts`
- `ret` = `packages/core/test/graph/resource-edges.test.ts`
- `trt` = `packages/core/test/graph/traverse.test.ts`
- `eng` = `packages/engine/src/context/resource-registry.ts`
- `engt` = `packages/engine/test/context/resource-registry.spec.ts`
- `pg` = `apps/docs/docs/resources/edges.md` (the page this recipe is cut from)
- `ov` = `apps/docs/docs/resources/overview.md`
- `mr` = `apps/docs/docs/memory/relations.md`
- `kb` = `examples/knowledge-base/src` (the one example that uses edges)

Legend: **[page]** the page states it. **[ref]** belongs on `reference/resources`; the page links, does not state it. **[contradiction]** the existing page or another source disagrees with the code; the ruling is given. **[cut]** design history or mechanism; never on the page. **[answers Q1]** the sitemap question "What does an edge connect?".

## Read this first: corrections the page must carry

1. **`ref.edges` is optional on a block's resource handle, so `ref.edges.add(...)` does not type-check.** `pg:50-53` and `pg:70-73` call `ref.edges.add(...)` straight off `ctx.resources.research`. The type is `edges?: ResourceEdgeApi` on both `ResourceRef` and `ResourceContext` (`rs:404`, `rs:529-530`; the doc comment says consumers access it "via `ref.edges!`"). Type-checking a handler that declares a resource with `edges` and reads `ctx.resources.<name>.edges.neighbors(...)` gives `TS18048: ... .edges is possibly 'undefined'`; reading it as `ctx.resources.<name>.edges!` once into a local compiles **[tsc]**. A non-null assertion on one expression does not narrow a second read of the same path, so the example takes `edges!` once into a `const`. **[contradiction: the code wins. The example binds `const links = ctx.resources.<name>.edges!;` and calls `links.add`, `links.neighbors`.]** The handler form is `handler({ name, inputSchema, resources: { <name>: <def> }, execute: async (input, ctx) => ... })` (`ov:119-133`, `ov:334-340`).
2. **`shortestPath` defaults to depth 2.** `pg:58` says "null if there isn't one" and the example is two hops. `shortestPath` returns `null` when the target is farther than `depth`, and the default depth is 2 (`tr:82-86`, `tr:157-192`, `trt:143-146` **[test]**). A path of three or more edges needs `{ depth: 3 }` or more. Depth is clamped to 6 (`tr:16`, `tr:85`). The page's example may keep to two hops and say the depth default once. The ceiling (6) is **[ref]**.
3. **Traversals ignore superseded edges unless told otherwise.** `neighbors`, `egoGraph` and `shortestPath` filter to edges active "now" when `at` is not given (`tr:44-53`, `tr:31-42`). `all()` with no `at` returns every stored edge, superseded ones included (`re:242-244`, `ret:184-194` **[test]**). `pg:73` is right about `all({ at })`; the page must also say that a bare `all()` includes ended edges.
4. **`add` does not check that the endpoints exist, and does not dedupe.** `add` writes an edge between two strings (`re:196-223`); nothing looks the nodes up. The same `{ from, to, type }` added twice is two edges with two ids (`re:203-211`). The knowledge-base example checks that both concepts exist before calling `add` itself (`kb/capability.ts:100-111`) and skips edges to unknown targets on import (`kb/okf/import.ts:61-67`). **[page: one sentence: an edge links two ids you choose; the framework does not check they point at anything. `pruneDangling` is the cleanup.]**
5. **`nodeRef` and `parseNodeRef` come from `@flow-state-dev/core/graph`, not from the package root.** The graph barrel exports them (`gi:10-17`), the subpath is declared in `packages/core/package.json:71-74`, and `packages/core/src/index.ts` has no `nodeRef` or `graph` export. `defineResource` comes from `@flow-state-dev/core`. `pg:34` names the helpers with no import.
6. **`nodeRef` lowercases the key.** `nodeRef("ticker", "NVDA")` is `"ticker:nvda"` (`ed:16-19`, doc comment). `pg:34` writes it as an example only. If the page uses `nodeRef`, a ticket id like `T-4821` becomes `ticket:t-4821`, and a bare string `"ticket:T-4821"` would be a different node. **[page: if `nodeRef` is used, say once that it lowercases the key. Every node id in the example then goes through it, or none does.]**

## The one example the page carries

The revamp's app is a support desk (`docs/contributing/user-docs.md` "Code examples"; the Resources concept sheet uses `refundPolicy`, `draftReply`, `ticketNotes`: `docs/contributing/docs-revamp/pages/concepts/resources.facts.md:12`). **[page example, suggested]** Tickets that duplicate or block each other. A resource `ticketLinks` declares edges; a block `linkDuplicate` adds `ticket:4821 duplicates ticket:4790`; a block `findRelated` follows them. These names are not in the code; every fact below is about the framework. The page's code blocks are titled with paths under the layout in `user-docs.md`: the resource at `src/flows/support/resources/ticket-links.ts`, the blocks at `src/flows/support/blocks/link-duplicate.ts` and `.../find-related.ts`. The example type-checks against `packages/core/src` (the `handler` and `defineResource` shapes were compiled **[tsc]**: `scope: "org"`, `edges: { vocabulary: [...], maxEdges: 500 }`, `resources: { ticketLinks }`, `ctx.resources.ticketLinks.edges!`).

An org-scoped resource written only by a block needs no `canWrite`; `canWrite` is required only for a client write through `runBy: "default"` (`rs:342-350`). **[ref]** The existing page uses `scope: "user"` with `writable: true` (`pg:20-27`); either works. Pick one scope and say why in a clause (a ticket's links are the same for everyone on the desk, so org).

## 1. Declare an edge (step 1)

- Pass `edges` to `defineResource`: `edges?: boolean | EdgeSlotConfig`. `true` uses defaults; an object sets `vocabulary` and `maxEdges`. `rs:351-352`, `re:73-79`, `pg:12-28`. [page]
- With `edges` declared, the framework adds an `edges: Edge[]` field to the resource's state schema and to its `default`; the author does not declare it in `stateSchema`. `rs:656-685` (schema at `rs:667-669`, default at `rs:670-678`), `rt:164-175` **[test]**, `pg:30`. [page]
- The stored array is part of the resource's own state: no separate storage key, no separate database. `re:52-60` (module doc), `pg:10`. [page]
- `stateSchema` must be a Zod object. `defineResource` with `edges` on any other schema throws `defineResource() with edges requires an object stateSchema (got ...)`. `rs:661-666`, `rt:186-192` **[test]**. [ref]
- A schema that already has an `edges` key is left alone (the author's own shape wins); the default likewise. `rs:667`, `rs:670-678`, `rt:194-204`, `rt:218-226` **[test]**. [ref]
- `edges: false` or unset: no field is added and no `.edges` API is attached. `rs:661` (`if (config.edges)`), `rt:206-216` **[test]**, `engt:1934-1940` **[test]**, `pg:10` ("a resource that doesn't declare them behaves exactly as before"). [page, one clause]
- `vocabulary?: string[]`: when set, `add` throws if `type` is not in it. The message is `Edge type "<type>" is not in the declared vocabulary: <list>`. `re:75-76`, `re:197-201`, `ret:71-77` **[test]**, `engt:1923-1932` **[test]**. [page: the throw in one sentence; message text is not stated]
- `maxEdges?: number`: a size cap. When an `add` takes the array over the cap, the framework drops edges to get back under: ended (superseded) edges first, oldest first; then the lowest-confidence live edges, oldest first among ties. The edge just added is never the one dropped. `re:77-78`, `re:117-174`, `re:213-220`, `ret:79-151` **[test]**. [ref: the order. Page: "`maxEdges` caps how many are kept; past it, `add` drops the oldest ended edges first, then the least confident."]
- A collection can declare edges too: `defineResourceCollection({ ..., edges })`. Each instance carries its own edge array and its own `.edges` API, backed by that instance's state. `rc:174-180`, `rc:530-540`, `eng:1369-1376`, `engt:1942-1957` **[test]**. [page: one sentence, with a link to Collections; the example does not use it. Projected collections have no `edges` option: `packages/core/src/types/projected-resource-collection.ts:139` (doc comment). [ref]]

## 2. Add one (step 2)

- `ctx.resources.<name>.edges` is the API, present only when the resource declared `edges`. `rs:404`, `rs:529-530`, `eng:2310-2317`, `engt:1904-1921` **[test]**. [page]
- `add(input)` returns a promise of the stored `Edge`. Input fields: `from`, `to`, `type` (required) and optional `confidence`, `validFrom`, `source`. `re:81-89`, `re:92-94`. [page]
- `add` assigns the `id` (a random UUID), `createdAt` (now) and sets `validUntil` to `null`. `confidence` defaults to `1`, `validFrom` to `null`, `source` to `[]`. `re:202-212`, `ed:35-45`, `ret:42-54` **[test]**. [page: the defaults, in the field table]
- The stored `Edge` fields: `id`, `from`, `to`, `type`, `confidence` (number 0 to 1, default 1), `validFrom` (ISO datetime or null, default null), `validUntil` (ISO datetime or null, null = currently valid), `source` (array of provenance ids, default []), `createdAt` (ISO datetime). `ed:35-45`. [page: `id`, `from`, `to`, `type`, `confidence`, `validFrom`/`validUntil`, `source`, as `pg:36-43` does. `createdAt` is [ref]; `pg`'s table omits it.]
- An edge is directed (`from` to `to`) and typed (`type`, written in active voice: `drives`, `works_at`). `ed:28-34`, `ed:39`, `pg:34`. [page]
- A node is a bare string id. For links between resources the convention is `"<namespace>:<key>"`. `nodeRef(namespace, key)` builds one and lowercases the key; `parseNodeRef(ref)` splits at the first colon only, so a key may contain colons, and a bare string has no namespace. `ed:13-26`, `edge.test.ts:5-22` (`packages/core/test/graph/edge.test.ts`) **[test]**. [page: the convention and `nodeRef`; `parseNodeRef` is one clause or [ref]]
- A write goes through the resource's normal state write, so it persists and notifies like any other state write. `re:52-60`, `eng:2310-2312` (comment: "edge writes persist and emit `onResourceChanged` like any other state write"), `pg:47`. [page, one clause: "an edge write is a state write"; what that triggers (a client refresh, a reactive block) is C-08 / B-36, not here]
- `supersede(edgeId, at?)`: ends an edge. It sets `validUntil` to `at` (an ISO string) or now. The edge stays stored. A missing id does nothing. `re:95-96`, `re:225-233`, `ret:153-171` **[test]**. [page]
- `remove(edgeId)`: deletes the edge outright. `re:97-98`, `re:235-240`, `ret:173-182` **[test]**. [page]
- Supersede, then add, is how a link changes over time: the old edge keeps its record, so a read with `at` set to a past instant still sees it. `re:95`, `tr:30-42`, `pg:65-74`, `mr:38`. [page: a short "when a link changes" paragraph with the three-line example in `pg:70-73`, using `links` not `ref`]
- `pruneDangling(knownNodes)`: removes every edge with an endpoint not in `knownNodes` and resolves to the count removed. `re:107-108`, `re:258-267`, `ret:213-221` **[test]**. [page: one sentence]

## 3. Follow it (step 3)

- All four reads are synchronous: they read the edge array already in the resource's state. `re:99-106`, `re:193`, `re:242-256`, `pg:47` ("Reads are synchronous over the in-state array"). [page]
- `neighbors(node, opts?)` returns the edges that touch `node` (an array of `Edge`, not of node ids). `re:101-102`, `tr:62-66`, `trt:59-75` **[test]**. [page]
- `egoGraph(node, opts?)` returns `{ nodes, edges }`: every node within `depth` hops, `node` itself included, and the edges whose two ends are both in that set. `re:103-104`, `tr:121-154`, `trt:112-127` **[test]**. [page]
- `shortestPath(from, to, opts?)` returns the ordered edges from `from` to `to`, `null` if there is none within depth, and `[]` when `from` equals `to`. `re:105-106`, `tr:156-192`, `trt:129-146` **[test]**. [page]
- Traversal options (`TraversalOpts`): `depth` (default 2, clamped to 6, a negative number is 0), `direction` (`"out" | "in" | "both"`, default `"both"`), `relationTypes` (only these edge types), `at` (ISO time; only edges active then, default now). `tr:15-28`, `tr:82-86`. [page: the four names in one sentence; the clamp, the negative case and the activity rule are [ref]]
- Direction defaults to `"both"`: a traversal walks an edge against its direction unless `direction: "out"` or `"in"` is passed. `tr:23`, `tr:68-79`, `trt:59-75` **[test]**. [page: one sentence, since `from` and `to` read as a one-way link; a reader who wants only what a ticket points at passes `direction: "out"`]
- An edge is active at `at` when `validFrom` is null or not after `at` and `validUntil` is null or after `at`. `tr:30-42`, `trt:25-57` **[test]**. [ref]
- Traversals are depth-bounded and cycle-safe: a graph with a loop terminates. `tr:1-11`, `trt:158-170` **[test]**, `pg:63`. [page, one clause]
- The traversal functions also exist as standalone functions over any `Edge[]` (`neighbors`, `egoGraph`, `shortestPath`, `traverse`, `activeAt`, `MAX_DEPTH`), exported from `@flow-state-dev/core/graph`, with no store or runtime. `gi:19-27`, `tr:1-11`. [ref]

## 4. What an edge connects (answers Q1)

- An edge connects two node ids, strings the author chooses. Nodes are not declared anywhere; a node exists only because an edge names it. `ed:13`, `ed:35-39`, `re:196-223`. [page, answers Q1]
- The edge is stored in the one resource that declares it, and the traversals see only that resource's edges. `re:193` (`ref.state.edges`), `re:182-185`. A graph that spans several resources is one resource's edge list whose node ids use `"<namespace>:<key>"` to name things held elsewhere (`ticket:4790`); the framework does not follow the id to a resource. [page, answers Q1: "A node is a name, not a record."] The `pg:34` wording is "for links that point at another resource, the convention is `namespace:key`"; the convention is the author's, the framework does not resolve it.
- No check that an endpoint exists or is a real resource: see correction 4. [page]
- Edges are directed, but traversals default to `"both"`: see section 3. [page]

## 5. Where the data lives: the four questions

The page is about a stored part, the `edges` array.

| Question | Answer | Source |
| --- | --- | --- |
| Who owns it | The resource it is declared on, so the resource's scope (session, user or org) owns it. An edge has no owner of its own. | `re:52-60`, `rs:351-352`, `rc:174-180` |
| Who can see it | Blocks that declare the resource (`ctx.resources.<name>`). It is part of the resource's state, so whatever shows that state shows the edges. Whether a browser sees it follows the resource's `client` projection. The model sees nothing unless a block hands edges to it. **[verify: client projection of the `edges` field was not read; keep it to "it is part of the resource's state" and link C-08 / `reference/resources` for visibility.]** | `re:52-60`, `ov:39` |
| Where it is stored | Inside the resource's own state record: no new storage key, no separate table. It lasts as long as the resource's store does. | `re:52-60`, `pg:10`, `apps/docs/docs/persistence/overview.md:114` (resources are attached to scopes and persisted with their scope) |
| How many exist | One edge list per resource, or one per collection instance. Capped only if `maxEdges` is set; otherwise unbounded. The existing page says traversal stays fast for "hundreds or low thousands of edges per resource" and is not a graph database. | `re:74-79`, `rc:174-180`, `pg:78`, `mr:55` |

- The size claim "fast for hundreds or low thousands" is the existing page's, not pinned by a test. The implementation walks the whole array on every traversal (`tr:44-53`, loops at `tr:102-103`). [page, as one sentence of limits: "Edges are scanned in memory; this is for hundreds to low thousands per resource, not a graph database." Attributed to `pg:78`.]
- The whole array is read, rewritten and persisted on each `add`, `supersede` and `remove`. `re:213-221`, `re:227-232`, `re:236-239`. That is why the size claim holds. [ref]
- `add`, `supersede` and `remove` are read-modify-writes of the resource's state through `updateState`; concurrent writers are handled by that call, not by the edge API. `re:213`, `re:258-267` (`pruneDangling` uses `updateStateWith`). [ref: C-08 / `reference/concurrency`]
- If the live state has no `edges` array, building the edge API throws: `createResourceEdgeApi: resource state has no `edges` array`. A resource declared through `defineResource` or `defineResourceCollection` always has one. `re:188-192`. [ref]

## 6. What this does not do (Reference rows or one flat sentence)

- No existence check on endpoints, no dedupe, no cascade on removing a node: see correction 4. [page]
- Not a graph database. No query language, no weighted paths (the `confidence` is data, not used by traversals; `tr` never reads it), no cross-resource traversal. `tr:44-210` (no use of `confidence`), `pg:78`. [page, one sentence]
- `confidence` is used by exactly one thing in the edge API: `maxEdges` culling order. `re:155-171`. [ref]
- Traversal returns edges and, for `egoGraph`, node ids. It does not return the records the ids name. `re:99-106`. [page, one clause]

## 7. Who else uses it (the link at the end)

- Memory relations stores typed edges between the people, companies and topics an agent learns about, on the semantic resource's edge graph, with supersede-then-add for changed facts. `mr:10`, `mr:34-38`, `packages/memory/src/memory-system-blocks.ts:255-260`. [page: one sentence and link `../memory/relations`; the page's `catalog` link is in the sitemap's Links only as `reference/resources`, so the memory link is optional]
- The knowledge-base example maps markdown links between concept files onto edges on a collection that declares `edges: true`. `kb/concepts.ts:9-10`, `kb/concepts.ts:49-56`, `kb/okf/import.ts:61-67`. [ref or cut]
- Links: `reference/resources` (the sitemap's one link); `./search-a-collection.md` and `../concepts/resources.md` are reasonable "see also" neighbours. The existing page also points at Collections for "the other way to hold many related instances" (`pg:82`); `apps/docs/docs/resources/collections.md:574` points back at Edges. [page]

## What the page must not carry

- Design history and the first consumer's story: `pg:80` "the first framework consumer of this primitive" is diff narrative; keep only the link.
- "Edges are opt-in. A resource that doesn't declare them behaves exactly as before" (`pg:10`): "as before" is a before-state. Say "a resource without `edges` has no `.edges`."
- The reasoning for superseding rather than deleting beyond what a reader can observe: the old edge stays, and a read with `at` before `validUntil` still returns it.
- Ticker examples from `pg` (`ticker:nvda`, `country:taiwan`): not this app. Replace with the support desk's names.
- How `maxEdges` culling is implemented (the two phases, the protected id): the observable rule is one sentence.

## Words and shape

- Recipe: one task, task-shaped title, numbered steps (declare an edge, add one, follow it), the finished code, 500 words of prose. Three code blocks, each titled with a path. The existing page is about 640 words of prose before cutting, so the cut is from `pg:76-82` ("When to reach for this") and the edge-shape table's last rows.
- "Edge" is introduced in the opening in plain words ("a typed link from one thing to another") before the API name. "Node" is defined where first used. "Supersede" is explained in the step where it appears: end an edge without deleting it.
- `glossary.mjs` was not read for this sheet; the caller's pass 4 checks retired terms.

## After revise round 1

- The page now carries four titled blocks (the resource, `linkDuplicate`, `findRelated`, `unlinkDuplicate`) in the support-desk app. All four were type-checked together under the kitchen-sink tsconfig (scratch folder removed); `edges!` is taken once per block, as correction 1 requires.
- `nodeRef` lowercases the key (`ed:16-19`), so `nodeRef("ticker","NVDA")` and `ticker:nvda` are the same node. The earlier ticker example was consistent. The new page builds every id with `nodeRef` and says it lowercases.
- `shortestPath` returns `null` when no chain is found within `depth` (default 2, clamped to 6), and `[]` when `from === to` (`tr:16`, `tr:82-86`, `tr:156-192`). The page states the default and the `null` case, and tells the reader to pass a larger `depth`. The clamp and the `[]` case are R-08.
- Moved to R-08 (`reference/resources`), linked and not stated beyond one clause: edge storage in the resource's own state; the `edges` option's defaults and the `maxEdges` cull order beyond one sentence; the state-shape injection and the `z.object` requirement; the `createdAt` field and the edge-shape detail; read/write timing detail; the full operations table (`supersede` no-op on an absent id, `all` taking only `{ at }`, `pruneDangling` count); traversal option defaults and the depth clamp; sizing guidance beyond "hundreds to low thousands".
- Cut, not moved: breadth-first and in-memory description, "first consumer", "as before".
- Links: `../catalog/memory/relations.md`, `./collections.md`, `../reference/resources.md`. The R-08 and collections pages do not exist yet in the revamp tree.

## After revise round 2

- Verified `supersede` then `all({ at: now })`: `activeAt` keeps an edge only while `validUntil > at` (`tr:30-42`), and `supersede` stamps `validUntil` at or before any later `at`, so the ended edge is excluded even within the same millisecond. The example's count is correct.
- Verified `shortestPath` and `egoGraph` share one default depth of 2 (`tr:82-86`); the explicit `depth: 2` on `egoGraph` restates the default.
- `maxEdges` cull is a deletion from the stored array, on the `add` that crosses the cap: ended edges first, oldest first, then lowest confidence (`re:117-174`, `re:213-220`).
- The `confidence`/`validFrom`/`source` fields are optional `add` inputs and also stored on the edge (`re:81-89`, `re:202-212`).
- `nodeRef("ticket","T-4821")` is `ticket:t-4821`, so a hand-written `ticket:T-4821` is a different node (`ed:16-19`).
