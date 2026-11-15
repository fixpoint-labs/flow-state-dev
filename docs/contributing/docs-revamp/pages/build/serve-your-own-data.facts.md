# Facts for Serve data your app already owns (B-37, recipe)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests, `goals/`, one example. No spec, no `docs/internal/`, no `CLAUDE.md`. Paths are from the repo root. The page plan's `Sources` line names `resources/projected-collections`; that is the existing page, which is allowed.

Abbreviations:

- `proj` = `apps/docs/docs/resources/projected-collections.md` (the page this recipe keeps)
- `col` = `apps/docs/docs/resources/collections.md`
- `ca` = `apps/docs/docs/resources/client-access.md`
- `pc` = `packages/core/src/types/projected-resource-collection.ts`
- `rt` = `packages/core/src/tools/resource-tools.ts`
- `rst` = `packages/core/src/tools/resource-search-tools.ts`
- `rct` = `packages/core/src/tools/resource-content-tools.ts`
- `reg` = `packages/engine/src/context/resource-registry.ts`
- `cec` = `packages/engine/src/context/createExecutionContext.ts`
- `pr` = `packages/engine/src/resources/projected-ref.ts`
- `ri` = `packages/engine/src/resources/internal.ts`
- `rr` = `packages/engine/src/routes/resource-routes.ts`
- `ru` = `packages/engine/src/routes/route-utils.ts`
- `vr` = `packages/engine/src/context/view-reads.ts`
- `etest` = `packages/engine/test/projected-resource-collection.test.ts`
- `rtest` = `packages/engine/test/projected-resource-routes.test.ts`
- `ctest` = `packages/core/test/projected-resource-collection.test.ts`
- `ul` = `packages/react/src/hooks/useResourceCollectionList.ts`
- `urc` = `packages/react/src/hooks/useResourceCollection.ts`
- `ucr` = `packages/react/src/hooks/useCollectionResource.ts`
- `resp` = `docs/contributing/docs-revamp/pages/concepts/resources.md` (drafted C-08; cited for names only)
- `viewp` = `docs/contributing/docs-revamp/pages/concepts/views.md` (drafted C-09; cited for names only)

Legend: **[page]** the page states it. **[ref]** belongs on `reference/resources`; the page links, does not state it. **[verify]** not confirmed against running code; keep off the page or soften. **[contradiction]** two sources disagree; the ruling is given. **[ran]** I ran it against the source in this checkout (throwaway test, removed afterwards). **[test]** pinned by a committed test. **[source]** read from source, not run. **[answers Qn]** the sitemap question it answers.

The sitemap's two questions are **Q1: Where is the data stored?** and **Q2: What happens on each read?**

## Read this first: corrections and things the page cannot say

C1. **"Read it from a page" has no live-update story.** Nothing tells the framework when the app's own data changes: the projected handle has no mutators and emits no `resource_change` (`reg:1381-1500`), `reactTo` is accepted on the config but the doc comment says change-awareness is not built (`pc:116-122`), and a view's recorded reads are heard on framework notices only (`vr:1-24`). So a screen over a projected collection shows what the app returned when it asked, and asks again only on a new query or a new mount. The existing page's "A live screen stays current by re-running its list or state query" (`proj:131`) is true only in that sense. See facts 30, 31 and 37 and C2. **[page: say so in one sentence in step 3, flat.]** [answers Q2]
C2. **`useResourceCollectionList`'s `refetch()` does not ask the app again.** **[ran]** After mount (one request), I added a row to the stub server and called `refetch()`; no second request was sent and the list still showed the old rows. The hook asks through `useResourceCollection`'s `list`, which holds each page by its query until that hook's own cache is cleared (`urc:104-118`, `urc:281-310`); the list hook's `refetch` only re-runs its effect (`ul:154-162`). A different `limit` or `topicPrefix` (new cache key, `urc:110-118`) or a fresh mount re-asks **[ran]**: changing `limit` from 20 to 21 sent a second request, and a new hook instance sent a third. `useCollectionResource(...).refetch()` for one record does ask again **[ran]**: two requests, the second returned the new value (`ucr:76`, `urc:312-321`, `get` is uncached). `useResourceCollection(...).refetch()` clears that instance's page cache, and the next `list()` re-asks **[ran]**. **[page: do not tell the reader to call the list hook's `refetch` to see new app data. Either leave the refresh sentence at "asks again on a new mount or a new query", or have the caller decide whether this is a framework bug to fix before the page ships. Flagged to the caller.]**
C3. **`readResourceContentTool` cannot read a projected record, though the existing page says it can.** `proj:106` says "An agent that already has a record's URI reads it with `readResourceContentTool`." **[ran]** With a projected collection declared `llmReadable: true`, `searchResources` returned `{ uri: "user/positions/AAPL", score: 1, snippet: "AAPL 3" }`, then `readResourceContentTool` with that uri threw `Readable resource not found for uri: user/positions/AAPL`, and its no-argument form returned `{ uris: [] }`. Cause (source): the tool resolves the ref and then gates on `ref.config?.llmReadable` (`rct:42-45`, `rt:254-256`); a projected instance ref carries no `config` (`pr:33-57`, `pc:194-206`). `globResources` also returned `{ uris: [] }`, as documented (`rt:69-85`). **[contradiction: the existing page vs the code. The code wins.]** The recipe's steps do not involve a model, so the page can leave the agent out. If it mentions the model at all, it says only that `searchResources` finds records (fact 24) and links to B-34, and does not say a record can then be read by uri. Flagged to the caller as a probable code defect, not a docs question.
C4. **The existing table row "org-scoped collection, session has no org: the read is refused (`organization`); `read` is not called" is true on the HTTP routes only.** The route test expects the item-state handler to reject with a message matching `organization` and the hook not called (`rtest:230-282`, `ri:95-117`). In a block there is always an org (an app with no sign-in resolves to the default org), and the read goes through **[ran]** with `orgId` set to the default org id. Do not carry that row onto the page. **[ref]**
C5. **The existing page's example is one scenario (`positions`, a brokerage portfolio), the revamp's is the support desk.** The recipe should use an `orders` collection over the support app's own orders table (names under "The recipe's one scenario"). The old page's `portfolio` accessor and `db.positions` stub are not on the revamp's layout. **[page]**
C6. **Cut:** the "Migration" section (`proj:142-144`), the "Limits" bullets that repeat what the sections already say (`proj:133-140`), and the "Definition-time failures" list (it is a reference list; the page keeps at most the wildcard-only rule as one clause).
C7. **A bare-string `contentTemplate` is a file path, not template text.** **[ran]** `contentTemplate: "<system>{{ state.ticker }}</system>"` made `createExecutionContext` throw `Failed to load contentTemplate for resource "portfolio" (path: .../<system>{{ state.ticker }}</system>): ... ENOENT` (`reg:608-630`: bare strings resolve from the working directory). `pc:166` types the field `ResourceTemplate | string | AnchoredPath`, so a string compiles. Inline template text goes through `parseResourceTemplate(...)` (`proj:34-36`, `etest:132-139`). **[page: if the page shows a template, it uses `parseResourceTemplate`. The recipe can leave the template out entirely: nothing in its steps needs it.]**

## The recipe's one scenario

The revamp's app is a support desk (`resp:46-47`: `draftReply` is the block that drafts each reply; `ticketNotes` is a stored collection). This recipe's data is the one thing the support app already owns and the framework does not: the customer's **orders**, in the app's own database. Names the page may use (all are the page's own choices, none exist yet): `orders` (the collection), `src/flows/support/resources/orders.ts`, `lookUpOrder` (a handler block, `src/flows/support/blocks/look-up-order.ts`), `src/lib/db.ts` exporting `db` (the app's data access, one clause to say what it is), `src/app/orders-panel.tsx` (the page). C-08's "Next" links to this recipe as "a read-only view of data the app already owns" (`resp:177`, verify the wording when C-08 is final).

**Type-check [ran].** In a scratch app under `apps/kitchen-sink`, these compile against the workspace packages with the repo's strict `tsc` (module bundler, JSX react-jsx): `defineProjectedResourceCollection` with `pattern: "orders/*"`, `scope: "user"`, a `stateSchema`, `read`, `search` (returning `{ hits: rows.map((r) => ({ key: r.id, state: r })), nextCursor: rows.nextCursor }`), `llmReadable: true`, `client: { state: { read: true }, expose: [...] }`; a `handler` declaring `resources: { orders }` and calling `ctx.resources.orders.getOptional(id)`, `.list({ search, limit })`, `order.state.status`, `order.readContent()`; a React component using `useSession(sessionId)` and `useResourceCollectionList<ClientDataOf<typeof orders>>(session, "orders", { limit: 20 })`, destructuring `items`, `hasMore`, `loadMore`, `isLoading`, `error`, `refetch`. One correction: `items[i].clientData` is typed `TClient | undefined` (`packages/client/src/types/index.ts:387-391`), so a page example writes `item.clientData?.status`, not `item.clientData.status`. (`proj` has no React example at all.) The scratch folder was deleted.

## Step 1: Declare a read-only collection over your data

7. **What it is.** A read-only view of data the app already owns. The framework keeps no copy; each read calls a function the app supplies. `pc:2-23`, `proj:9`. **[page: the opening sentence, in plain words.]** [answers Q1]
8. **`defineProjectedResourceCollection` is exported from `@flow-state-dev/core`.** `packages/core/src/index.ts:86`. Takes a config object and returns a collection that goes in a block's or flow's `resources` map like any other collection. `pc:281-362`, `ctest:59-69` (flows through declared-resource merge as a collection). **[page]**
9. **Required fields: `pattern`, `scope`, `stateSchema`, `read`, `search`.** `pc:142-163`. The definer throws if `read` or `search` is missing (`pc:310-314`, tests `ctest:71-117`). **[page: name the five; the throw is [ref]]**
10. **`pattern` is wildcard-only.** `"orders/*"` (one segment) or `"orders/**"` (nested). A parameterized pattern such as `orders/[id]` throws at definition, naming the problem and saying to put the discriminator in a wildcard segment. `pc:143-148`, `pc:293-302`, `ctest:72-81`. `proj:89`, `proj:136`. **[page: one clause. The message wording is [ref].]**
11. **`scope` is `session`, `user` or `org`.** Any other value throws at definition (`pc:304-308`, `ctest:82-85`). `scope` decides which id the hook receives as `ctx.scopeId` (fact 18). **[page: one clause. Which scope for orders: `user`.]** [answers Q2]
12. **`stateSchema` is the shape of one record.** Every record the app returns is parsed through it, and a record that does not fit is rejected (facts 16, 17). Defaults in the schema apply to what the app returns: **[ran]** a `read` returning `{ ticker: "A" }` against a schema with `shares: z.number().default(7)` gave state `{"ticker":"A","shares":7}`. **[page: one sentence; the default is optional.]**
13. **A key must match the pattern.** `get("AAPL/history")` against `positions/*` throws `does not match` and the app's `read` is never called; `getOptional` returns `undefined`. `reg:1448-1455`, `reg:1467-1471`, `etest:92-102` **[test]**. **[page: one clause, tied to the pattern.]**
14. **A collection has no `count`, no `maxInstances`, no eviction, no `prefetchMode`, and cannot be written.** "Read-only, lazy, and unbounded are structural, not flags." `pc:136-141`. Writes: `proj:129`; tests fact 26. **[page: one sentence in the opening or the limits clause.]** [answers Q1]
15. **Registered like any collection.** Declared in a block's `resources` map under any accessor name; the key is the name on `ctx.resources`. `proj:56-67`, `etest:44-60`. The accessor name, not the pattern, is what the client uses as the `ref` (fact 33). **[page]**

## Step 2: The read function

16. **`read({ key, ctx })` returns the record for one key, or `null` if the app has none.** `pc:154-155`, `proj:15`. A `read` that returns `undefined` is treated the same as `null` **[ran]** (`getOptional` returned `undefined`; `pc:392-397`). **[page: the signature and the `null` rule.]** [answers Q2]
17. **What comes back from `get`, `getOptional`, and a bad record** (each pinned by a test):

   | Call | Result | Source |
   | --- | --- | --- |
   | `get`, app has it | a read-only ref | `etest:63-75` |
   | `get`, `read` returns `null` | throws, message contains `not found` | `etest:109-112`, `reg:1459-1464` |
   | `getOptional`, `read` returns `null` | `undefined` | `etest:104-107`, `reg:1467-1473` |
   | `read` returns a record that fails `stateSchema` | throws, message contains `stateSchema` | `etest:114-118`, `pc:398-402` |
   | key outside the pattern | throws `does not match`; `read` not called (`getOptional`: `undefined`) | `etest:92-102` |

   **[page: the first four rows are what a reader needs for step 2; the table is under six rows. The rest is [ref].]** [answers Q2]
18. **`ctx` is the trusted context, derived by the server.** Fields: `scope`, `scopeId` (the resolved session id, user id or org id for the collection's scope), `userId` (the server-derived owner), `orgId?`, `tenantId?` and `signal?`. It also carries the flow's name as `flowKind`. `pc:89-110`, `cec:2926-2937`. The same fields reach the hook from a client request (`ri:95-117`) and from a block. In a block run for user `u1`, `read` saw `userId: "u1"`, `scope: "user"` and `scopeId: "u1"` (`etest:141-153` **[test]**). Its `flowKind` matched the flow's name, and the route test sees the same `userId`, `scope` and `flowKind` for a client request (`rtest:108-121` **[test]**). **[page: the table is too long for the recipe; name `ctx.userId` and `ctx.orgId` and the one rule.]** [answers Q2]
19. **The hook must scope its own query with `ctx`.** The framework does not filter what the app returns by user; it passes the caller's identity and the app's query is responsible for using it. `proj:52` ("Use both in every query, or a user sees in one organization what they saved in another"), `pc:89-95` ("so the hook can safely scope its own query to the same owner/tenant namespace the framework uses"). **[page: one sentence, and it is the main thing the `read` step has to say. Use `ctx.userId` and `ctx.orgId` in the `where`.]** [answers Q2]
20. **A user-scoped collection belongs to a user inside one organization.** `proj:52`: "A user-scoped collection belongs to a user inside one organization, the same as the user data the framework stores." **[verify: `proj:52` states the framework's own user-data model; the hook receives both ids and nothing in the framework checks that the app's query uses them. State the rule for the hook (fact 19), not the framework-side keying.]**
21. **Do not use caller input to scope the query.** The context fields are derived from the loaded session, not from the request body (`ri:84-117`, `pc:89-95`). The key is the one caller-supplied value. **[page: fold into the sentence of fact 19, one clause.]**
22. **`read` is called with the bare key.** A caller who writes `get("/AAPL")` reaches `read` as `"AAPL"`, the same key the HTTP route gives it. `reg:1410-1413`, `etest:77-90` **[test]**. **[ref]**
23. **`read` runs once per key per request, and a `list` fills the same memory.** **[ran]** Two sequential `get("A")` in one request called `read` once; `list()` then `get("B")` for a key `list` returned called `read` zero more times and `get("B").state` was the listed state; a second request (second execution context) called `read` again. Source: a per-request map, `reg:1392-1394`, `reg:1405-1420`, and `list` fills it (`reg:1483-1486`); concurrent reads of the same key share one call (`etest:120-130` **[test]**). The map is never persisted and never shared across requests (`reg:1392-1394`). **[page: one sentence for Q2. "Within one request a key is read once, and the next request asks the app again."]** [answers Q2]
24. **The model's search tool calls `search`, not `read`.** `searchResources` over a projected collection that is `llmReadable` gave `{ results: [{ uri, score, snippet }] }` **[ran]**; `search` receives `{ search: <query>, prefix?, limit, cursor? }` (`rst:238-256`); rank is the hook's order (score is `items.length - index`, `rst:248-253`); `globResources` and `grepResourceContent` skip projected collections (`rt:69-85`, `pc:156-162`, `rst:` tests at `packages/core/test/resource-search-tools.test.ts:448-600`). A collection with no `llmReadable: true` is skipped (`packages/core/test/resource-search-tools.test.ts:492`). **[ref, or a link to B-34 `search-a-collection`; see C3 for what not to say.]**

## `search`: the second function the definer demands

25. **`search({ query, ctx })` returns `{ hits, nextCursor? }`.** `query` is `{ search?, prefix?, filter?, limit?, cursor? }`; each hit is `{ key, state }`; hits keep the order the app returns them; `nextCursor` is passed back as `query.cursor` for the next page and omitted on the last page. `pc:43-87`, `pc:156-163`. **[page: the recipe must say the definer requires it, with one clause on what it returns, because step 1 cannot compile without it. The query fields beyond `search`, `limit` and `cursor` are [ref].]**
26. **A hit that fails `stateSchema` is dropped and logged; the rest of the page is returned.** A bad record in a `read` throws instead. `pc:426-450`, `etest:192-203` **[test]**. **[page: one clause, because it differs from `read`; the log text is not quoted.]**

## Step 3: Read it from a page

The page here is a React component. Facts are for the session-addressed hooks, which is what the existing docs and tests use for projected collections (user scope is read through the session's snapshot like any other).

27. **Opt the collection into the client with `client`.** A browser sees nothing unless `client` is set. `client: { state: { read: true } }` opens the list and per-record state routes (without it both answer `403` `State read not permitted`, `rr:531`, `rr:655`); `client: { content: { read: true } }` opens the rendered content route (`403` `Content read not permitted` without it, `rr:221`). `ca:213-220`. **[page: the `state.read` clause. Pair it with `expose` so the browser gets only the fields the page needs (`ca:222-234`, "Pair `state.read` with a projection").]** [answers Q2]
28. **Projection works as on any collection.** With no `expose`/`exclude`/`data`, the browser gets each record's full state (`rtest:83-95`, `rtest:184-213` **[test]**). `expose: [...]` sends only those fields; `ClientDataOf<typeof orders>` types them (`ctest:137-151`, type-level **[test]**; my scratch compile **[ran]**). **[page: `expose` in the example, one clause; the three shapes are [ref] (`ca`).]**
29. **`useResourceCollectionList(session, ref, { limit?, topicPrefix? })`** returns `{ items, hasMore, isLoading, error, refetch, loadMore }`. Each item is `{ topic, clientData?, fetchContent() }`. `ul:64-80`, `urc:` list options `urc:40-46`. `ref` is the accessor name from `resources: { orders }`. `useSession(sessionId)` returns the `session` it takes (`packages/react/src/hooks/useSession.ts:611-614`). Both are exported from `@flow-state-dev/react` (`packages/react/src/index.ts:11`, `:56-58`). **[page]**
30. **`items` start empty and `hasMore` is false until the first page lands.** A projected collection's snapshot entry is `{ prefetched: [] }` with no `count`; the framework never lists the app's rows into the session snapshot. `ru:450-459`, `rtest:137-164` **[test]**. So there is no first-paint list, no total, and no "N orders" without the app's own count. **[page: one sentence; "no count" is the one a reader will look for.]**
31. **Each page is one request that reaches `search`.** `GET /sessions/:id/resources/:ref?limit=&cursor=&topicPrefix=` runs the app's `search` with `{ limit, cursor, prefix: topicPrefix }`, and returns `{ items: [{ topic, storageKey, clientData }], nextCursor? }`; the cursor is the app's own, passed through verbatim. With no `limit`, the route asks for 50; the maximum is 200; anything outside 1 to 200 is `400`. `rr:470-471`, `rr:539-542`, `rr:544-567`, `rtest:184-228` **[test]**. `loadMore` sends the previous `nextCursor` and appends (`ul:111-152`, `ul:186-194`); `hasMore` is true while a cursor remains (`ul:178-184`). **[page: the `limit` and cursor behaviour in one sentence; numbers (50, 200) are [ref].]** [answers Q2]
32. **One record is one request that reaches `read`.** `GET /sessions/:id/resources/:ref/:topic` returns `{ topic, storageKey, clientData }` for a record, `200` with a `null` body when the app has none, `404`-free by design (`rr:636-700`, `rtest:97-106` **[test]**). `useCollectionResource(session, ref, topic)` returns `{ item, isLoading, error, refetch }`, `item` is `null` when the record is absent (`ucr:23-35`). **[page: one sentence; it is how a detail view works.]** [answers Q2]
33. **Rendered content is a third request, only if the page asks.** `item.fetchContent()` calls `GET .../:topic/content`, which renders `contentTemplate` against what `read` returned (`rr:191-247`, `rtest:123-135` **[test]**, `urc:144-160`). A projected record has no stored content; with no template `readContent()` is `null` (`pr:40-56`, **[ran]**: `readContent()` returned `null`). **[page: only if the example uses a template; otherwise one clause or nothing.]**
34. **Each of those requests asks the app.** The framework answers from the hook, not from stored rows, and adds no cache across requests (`proj:135`, `reg:1392-1394`). **[page: Q2's headline sentence.]** [answers Q2]
35. **The page's own caching is per hook instance and per query.** `useResourceCollection` holds each page for its query until it is invalidated; the list hook does not invalidate on `refetch()` (C2); a snapshot count that moves or a `resource_change` touching the collection invalidates it, and a projected collection has neither (C1, fact 30). **[ran]** (C2). **[page: do not state the mechanism; state the consequence in one sentence, once the caller decides fact 2.]**
36. **A client write is refused.** `POST`, `PATCH`, `DELETE` on the collection return `403` with an error naming `read-only projected collection`. `rr:300-304`, `rr:420-423`, `rr:845-848`, `rtest:284-297` **[test, for POST]**. `client.content.create`, `update` or `delete` set to `true` throws when the collection is defined (`pc:322-336`, `ctest:86-97`). **[page: one clause. Which route a write would have taken is [ref].]**
37. **A view can compute over it, and is not told when the app changes.** A view's block can read `ctx.resources.orders` like any block, and its read is recorded by accessor (`cec:3465-3487`, `vr:1-24`); the view is heard on framework notices for that accessor's path, and the framework publishes none for the app's own writes. **[source, not run: no view test over a projected collection exists in this checkout.]** **[verify]** Keep the sentence off the page unless a view test confirms it; the page's C-09 link can say only "a view computes an answer on each ask" without claiming it refreshes. [answers Q2]
38. **The scope routes can also read it.** `GET /resources/:scope/:key/entries` and `.../entries/:entry` read a user or org projected collection with no session, through the same hooks (`packages/engine/src/routes/scope-routes.ts:105-199`). The React `useResource(def)` hook reads that way, but its collection result also exposes `set`, `update` and `delete` (`packages/react/src/hooks/useResource.ts:50-56`), which a projected collection refuses. **[ref, or leave out: the recipe's step 3 uses the session-addressed hooks.]**

## What the page cannot rely on (leave off, or put in `reference/resources`)

39. `reactTo` on a projected collection (`created`, `stateUpdated`, `deleted`) is accepted at definition; `contentUpdated` is rejected (`pc:116-130`, `pc:346-352`, `ctest:104-109`). Nothing in the engine reports an app change into it, and the doc comment says change-awareness is not built (`pc:116-122`). **[ref; do not state on the page.]**
40. A collection-level `contentTemplateRef` (another resource's content as the template) is allowed; both a `contentTemplate` and a `contentTemplateRef` throw (`pc:316-320`, `ctest:111-116`). **[ref]**
41. A snapshot (`/state`) lists the collection as `{ prefetched: [] }`, with no `count`, under its scope (`rtest:151-164` **[test]**). **[ref; the page says it in fact 30]**
42. `ProjectedResourceCollectionRef` has `pattern`, `scope`, `projected: true`, `config`, `get`, `getOptional`, `list`; `ProjectedResourceRef` has `path`, `scope`, `uri`, `state`, `readContent()`, `readContentRaw()`. `pc:194-240`, `etest:155-163` **[test]**. **[ref; the page says "read-only, no `create` or `delete`" in one clause]**

## The four questions, for each stored part

The recipe stores nothing in the framework. The two parts it touches are the app's records and the per-request memory.

### A record (an order) in the app's own store

| Question | Answer | Source |
| --- | --- | --- |
| Who owns it | The app. The framework has no copy and no write path to it. | `pc:5-9`, `proj:9`, `rr:300-304` |
| Who can see it | Whoever the app's `read` and `search` hand it to: the framework passes the request's `userId`, `orgId`, `tenantId` and `scopeId` and does no row filtering of its own, so the app's query must use them. A block that declares the collection can read it. The browser can only if `client` is set (`state.read` for the list and record routes; `content.read` for rendered content). A model reaches it only if `llmReadable: true`, and then only through `searchResources`. | `pc:89-110`, `proj:52`, `rr:531`, `rr:655`, `rr:221`, `rt:69-85`, C3 |
| Where it is stored | In the app's database or API, wherever `read` and `search` go. Not in the framework's stores and not in the session snapshot (which lists the collection as `{ prefetched: [] }` with no `count`). | `pc:5-9`, `ru:450-459`, `rtest:137-164` |
| How many exist | As many as the app has. No `maxInstances`, no eviction, no `count()`; the framework never enumerates them. A page of results is at most 200 rows from the client routes and whatever `limit` the block passes. | `pc:136-141`, `pc:217-219`, `rr:470-471` |

### What the framework keeps for a read, for the request only

| Question | Answer | Source |
| --- | --- | --- |
| Who owns it | The one request (execution context) that made the read. | `reg:1392-1394` |
| Who can see it | The blocks of that request that read the same collection; nothing else. | `reg:1405-1420` |
| Where it is stored | In memory for the length of the request, as a map from record key to the validated state. Never written to a store. | `reg:1392-1394`, **[ran]** fact 23 |
| How many exist | One entry per key the request read or listed. Gone when the request ends; the next request calls `read` again. | fact 23 |

## Links

- C-08 (`../concepts/resources.md`): what a collection is, scopes, `client` and `llmReadable` in one line each (`resp:120-124`, `resp:177`). The recipe says "a collection the framework does not store" and links there.
- C-09 (`../concepts/views.md`): what a screen reads (`viewp:7-21`). Link only; do not claim a view over projected data refreshes (fact 37).
- `reference/resources` (`../reference/resources.md`): definition-time failures, the context type, limits, the routes and their status codes, the `ref` types.
- B-34 `./search-a-collection.md`: the model's search over an `llmReadable` collection.
- B-35 and B-36 (`./react-to-a-change.md`, `./link-records.md`): neighbours, not needed.

## Open questions and corrections for pass 3

- **Caller decision (C2):** `useResourceCollectionList().refetch()` does not re-ask the app. If the framework is fixed first, the page can say "call `refetch`". If not, the page says only what is true: a new mount or a different `limit` or `topicPrefix` asks again, and `useCollectionResource(...).refetch()` re-reads one record.
- **Caller decision (C3):** `readResourceContentTool` refuses a projected record's uri. The page leaves the model out of the recipe's steps and does not repeat the old page's claim.
- **Drop from the old page:** Migration, the Limits list, the definition-time failure list, the agent paragraph (`proj:106`), the "Writes stay on the app" aside about dispatching an action (it points at an inbound-transports page the revamp may not keep; check the sitemap before restoring it).
- **`[verify]` left:** fact 20 (user-scope keying wording) and fact 37 (a view over projected data). Keep both off the page.
- **Words to avoid** per `docs/contributing/glossary.mjs`: "user", not "person"; "block" for a handler. Not rechecked against the glossary file here.

## Revise round 1: what the page now states, and what moved to `reference/resources#projected-collections`

The page is four numbered steps (declare, read in a block, search and page, show on a page) on the `orders` scenario. It states facts 7-9, 11, 12, 16, 19, 21, 23, 25, 26, 27, 28, 29, 30, 34 and 36, plus fact 10's wildcard rule as one clause. Page-only choices: `db` is named as the app's own data layer imported from `src/lib/db`; the list/`get` examples use `getOptional`, `get` and `list` from facts 16/17 and 25.

Moved to Reference rows (the page links, does not state): the definition fields table, scope and ownership keying, `contentTemplate` / `contentTemplateRef` and `client` options, the collection operations row, the `ProjectedResourceRef` fields, the full results table (including the org-scoped refusal, C4), the HTTP rows (item-state `200` with `null`, `403` `read-only projected collection`, status codes, the 50/200 limits), the definition-time refusals, the full `search` query contract, the access-by-caller table, the snapshot row, the `ProjectedResourceContext` fields, the write-surface row and the limits rows. The Migration section is cut from the page; its rename table goes to the Upgrading page (R-40).

Dropped from the page per C2 and C3: no claim that `refetch()` re-asks the app, and no claim that `readResourceContentTool` reads a projected record. The page says only that a new mount or a different `limit` asks again (C2, fact 35), and sends the model to B-34.

## Revise round 2

- `ctx.orgId` is typed optional (`pc:96-101`). A block read always carries one (`cec:2933`, default org when the app has no sign-in, C4). A browser read builds `orgId` from `session.orgId`, which can be absent (`ri:95-117`). The page says so in step 1, after the sentence on putting `ctx.orgId` in every query. **[source]**
- Step 4 names the hook's second argument as the `resources` key (fact 15, fact 29), says `items` is empty until the first page (fact 30), and says a re-render with the same query shows the earlier answer while a remount or a new `limit` asks again (C2, fact 35 **[ran]**).

## Revise round 3

- Step 1's `read` and `search` return nothing when `ctx.orgId` is absent, so the example does what the sentence says. The prose opens with the browser case, then says a block read always has an organization (`cec:2933`, C4). **[source]**
- Checked: the client list item's `topic` is the bare key `search` returned (`rr:544-567`, `rtest:204`), so `item.topic` is right in step 4.
- The "session's own state carries no orders" clause is cut; fact 30 stays on the sheet for the Reference.
