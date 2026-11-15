# Fact sheet: Memory relations (K-37, `catalog/memory/relations`)

Sources cited: the existing page (`pages/catalog/memory/relations.md`, `apps/docs/docs/memory/relations.md`, same text),
`apps/docs/docs/resources/edges.md`, `packages/memory/README.md`, the exported surface and its doc comments in
`packages/memory/src/` and `packages/core/src/graph/`, and the tests in `packages/memory/test/`. Paths below are
relative to `packages/memory/` unless they start with `apps/`, `docs/` or `packages/core/`.

No approved-spec names are used; every surface here is built.

## A. Corrections to the existing page (code wins)

| # | Existing page says | Code says | Evidence |
| --- | --- | --- | --- |
| A1 | "Endpoints are canonicalized to known subjects so the same entity doesn't fork into 'NVDA' and 'Nvidia'." | Canonicalization is trim + lowercase only. "NVDA" and "nvda" become one node; "NVDA" and "Nvidia" do not. No alias resolution exists. | `src/internal/helpers.ts:11-16`; `src/memory-system-blocks.ts:244-248` |
| A2 | Recall "pulls in nearby facts and edges from the graph". | Graph expansion adds edges only, never facts. Up to 10 edges, depth 2, and only when the query names an endpoint. | `src/tools/strategies/graph-expand.ts:25-31,41-47,92-103`; `src/tools/strategies/llm-filter-strategy.ts:283-295` |
| A3 | "a relevant fact two hops away surfaces even when its wording doesn't match the query." | What surfaces is an edge (rendered `<from> <type> <to>`), found by name match of an endpoint against the query, within 2 hops. | `src/tools/strategies/graph-expand.ts:41-47`; `src/tools/types.ts:60-70` |
| A4 | `maxEdges` is "a cap" (no behavior stated). | Over the cap, superseded (closed) edges are dropped first, oldest first; then active edges by lowest confidence, ties oldest first. The edge just added is never dropped. | `packages/core/src/graph/resource-edges.ts:67-112`; `test/relations.spec.ts` ("caps the active edge set at maxEdges") |
| A5 | Handler helpers listed as `ctx.cap.memory.connections / relate / egoGraph`. | Correct names. `connections` is exactly 1 hop and takes no `depth`. | `src/memory-capability.ts:290-305`; `test/tools/connect-tool.test.ts` ("connections returns ONLY the direct (1-hop) neighbour edges") |

## B. What it is and when it is worth it

- B1. Relations are typed, directed links between subjects, stored with semantic memory. Opt-in, default off. Off means no `edges` field on the semantic state, no edge extraction, no extra prompt text, no `memory/connect` tool. `src/memory-system.ts:243-247,290-295`; `test/relations.spec.ts` ("DISABLED (regression)", "semantic resource carries no edges field when relations is omitted").
- B2. Facts are statements about one subject (`SemanticFact` has `subject`, `content`, `confidence`, `category`). A relation connects two subjects. `src/semantic-memory.ts:9,23-27`; `src/memory-system-blocks.ts:141-152`.
- B3. The fact category `relationship` exists already ("connections to other named entities — spouse, pet, employer") and is a fact, not an edge. Relations add traversal: path between two entities, everything around one. `src/semantic-memory.ts:9`; `src/tools/connect-tool.ts:10-16`.
- B4. The edge graph is the core primitive `edges` on a resource; memory relations are its consumer. Concept link to `apps/docs/docs/resources/edges.md`.

## C. Turning it on

- C1. Set `semantic.relations` on `system()` (or `createMemoryCapability()`): `true` for defaults, or `{ vocabulary?, maxEdges?, createImplicitEntities? }`. `src/memory-system.ts:251-295`; `test/capabilities.test.ts:785-795` (createMemoryCapability with `semantic: { relations: true }`).
- C2. Requires semantic, which requires episodic. Setting `semantic` without `episodic` throws `"Semantic memory requires episodic memory to be configured"`. `relations` cannot be set without `semantic`. `src/memory-capability.ts:155-157,174-177`.
- C3. Defaults: `vocabulary` unset (free-text types), `maxEdges` unset (no cap), `createImplicitEntities: false`. `src/internal/config.ts:100-114`.
- C4. `import { system } from "@flow-state-dev/memory"` is the import used in the example; `RelationsConfig` is exported from the package root. `src/index.ts:226`.
- C5. Turning relations on installs the `memory/connect` tool in the capability's default-on preset set: defaults become `['digest', 'working', 'recall', 'connect']`. `cap.preset` `connect` is an empty no-op when relations is off. `src/memory-capability.ts:361-376`; `test/capabilities.test.ts:778-803`.
- C6. `mem.tool.connect()` returns the connect block; present only when relations is on. `src/memory-system.ts:654-660,909-911`.

## D. What gets stored (four questions per stored part)

Stored part 1: **edges** (the typed links).

- Edge fields: `id` (assigned), `from`, `to`, `type`, `confidence` (0 to 1), `validFrom`, `validUntil` (`null` = still true), `source` (episode ids), `createdAt`. `apps/docs/docs/resources/edges.md` "The edge shape"; `test/relations.spec.ts` seeded edges.
- **Who owns it:** the semantic memory resource (`semanticMemory`). Edges are an `edges: Edge[]` field inside that resource's own state, with no new storage key. `src/semantic-memory.ts:68-81`; `packages/core/src/graph/resource-edges.ts:1-12`. The consolidation step writes them; nothing in a flow's own code needs to.
- **Who can see it:** whoever can see the semantic resource, which is the user for scope `user` and the whole org for scope `org`. Semantic scope defaults to the episodic scope, else `user`. `src/memory-capability.ts:171-177` (semanticConfig scope); `src/internal/config.ts:174-179`; `src/semantic-memory.ts:68-81` (`scope: 'user' | 'org'`). The model sees them only through `memory/connect` and recall. Handlers see them through `ctx.cap.memory.connections / relate / egoGraph`. `src/memory-capability.ts:290-318`.
- **Where it is stored:** inside the semantic resource's state, so it lives wherever the app's store keeps resource state (in memory by default, SQLite/Postgres when configured). `packages/core/src/graph/resource-edges.ts:1-12`. Isolation across flows follows the semantic tier's `flowIsolation` setting. `src/memory-system.ts:272-277`.
- **How many exist:** one per active relationship per pair and type; a duplicate `new` for the same from, to, type counts as a reinforce, so one active edge. Superseded edges stay as history until a cap or the janitor removes them. Unbounded unless `maxEdges` is set. `test/relations.spec.ts` ("dedups a duplicate new edge into a reinforcement"); `src/memory-system-blocks.ts:299-311`; `src/internal/config.ts:112`.

Stored part 2: **the relation vocabulary** (config, not stored data).

- **Who owns it:** the app developer, in `semantic.relations.vocabulary` on `system()`. The extraction model does not set it. `src/memory-system.ts:251-259`.
- **Who can see it:** the model, as part of the consolidation prompt ("Use ONLY these relation types…"). `src/memory-system-blocks.ts:1070-1074`.
- **Where it is stored:** in config only. It is not forwarded to the core edge slot, so there is no throw path; memory drops and warns instead. `test/relations.spec.ts` ("does NOT forward vocabulary to the core edge slot").
- **How many:** as many strings as the developer lists.

## E. How edges get written

- E1. During consolidation (the pass that distills episodes into facts), the same generator call also returns `edges`. No second model call. Output schema is `{ facts, edges }` when relations is on, facts only when off. `src/memory-system-blocks.ts:174-183,1196`.
- E2. Consolidation runs after a number of new episodes (default 5), on eviction of persistent working entries (default true), and no more often than `minInterval`. This is the semantic tier's existing schedule; relations add nothing to it. `src/memory-system.ts:279-285`; `src/internal/config.ts` (`DEFAULT_CONSOLIDATION_CONFIG`).
- E3. A proposed edge has `from`, `to`, `type`, `confidence`, `sourceEpisodeIds` and an `action` of `new`, `reinforce` or `supersede`. `src/memory-system-blocks.ts:153-161`.
- E4. Prompt rules the model is given: only emit an edge when both endpoints are real named entities and the relation is stable; use active-voice verb phrases ("married to", "works at", "owns"); return an empty array if none apply. `src/memory-system-blocks.ts:1052-1068`.
- E5. Endpoint rule: `from` and `to` are trimmed and lowercased. An endpoint must equal the subject of a stored fact. Otherwise the edge is dropped with a console warning. With `createImplicitEntities: true` the endpoint is kept as a new node instead. `src/memory-system-blocks.ts:244-250,286-292`; `test/relations.spec.ts` ("drops an edge with an unknown endpoint by default", "mints an unknown endpoint when createImplicitEntities is true").
- E6. Vocabulary rule: when set, an edge whose (trimmed) `type` is not in the list is dropped with a console warning. Comparison is exact, not lowercased. When unset, any text is kept. `src/memory-system-blocks.ts:294-297`; `test/relations.spec.ts` ("drops an out-of-vocab edge type…", "keeps a free-text edge type…").
- E7. Provenance: each edge's `source` holds the episode ids it was derived from. `test/relations.spec.ts` ("persists a new edge between known subjects with provenance").
- E8. Reinforce: an edge that is seen again is replaced by a copy with confidence raised by 0.05 (capped at 1) and the episode ids merged. `src/memory-system-blocks.ts:236-262`; `test/relations.spec.ts` ("reinforce with a valid targetEdgeId…", 0.7 becomes 0.75).
- E9. Supersede: when a relationship changes, the old active edge with the same `from` and `type` is closed (gets a `validUntil`) and the new one added. It is not deleted. The model is never shown edge ids, so matching is by from and type. `src/memory-system-blocks.ts:326-345`; `test/relations.spec.ts` ("supersede sets validUntil…", "supersede with an empty targetEdgeId closes the active from+type match").
- E10. A bad edge (unknown endpoint, off-vocabulary, missing target) logs a warning and is skipped; it does not fail consolidation. `src/memory-system-blocks.ts:222-224,289,295,318,349`; `test/relations.spec.ts` ("reinforce with a not-found targetEdgeId warns and does not crash").
- E11. Writing edges does not change any fact's subject or content. `test/relations.spec.ts` ("does not rewrite any fact subject when extracting edges").
- E12. A consolidation batch with edges but no facts applies the edges and does not count as a consolidation. `test/relations.spec.ts` ("edges-only batch applies edges…").

## F. Reading connections

- F1. **`memory/connect` tool.** Input: `from` (required), `to` (optional), `depth` (integer 1 to 6, default 2). `from` alone returns every edge within `depth` hops of `from`. `from` and `to` return the shortest path between them. `src/tools/connect-tool.ts:34-50,60-69,125-136`.
- F2. Names are trimmed and lowercased before lookup, so `"User"` finds `user`. `src/tools/connect-tool.ts:123,128`; `test/tools/connect-tool.test.ts` ("with from+to…", `from: 'User'`).
- F3. Result: the same envelope the recall tool uses: `{ results, query, strategy: 'graph', totalMatched, truncatedTo }`. Each result has `content` as `"<from> <type> <to>"` (for example `user married to moni`), `source: 'relation'`, a `score`, and `metadata: { from, to, relationType, confidence }`. `query` is `"<from> -> <to>"` or `"<from>"`. `src/tools/connect-tool.ts:72-96`; `src/tools/types.ts:60-70`; `test/tools/connect-tool.test.ts`.
- F4. Unreachable `to` within `depth`: empty `results`, `totalMatched: 0`, no error. `test/tools/connect-tool.test.ts` ("returns empty results (not an error) when `to` is unreachable").
- F5. Failure shape: `{ error, query, strategy: 'graph' }`, returned and not thrown. With relations off the error reads "The relations graph is not enabled for this memory. Enable the relations tier to use connect." `src/tools/connect-tool.ts:110-121,137-143`; `test/tools/connect-tool.test.ts` ("returns an error envelope when relations are disabled").
- F6. Traversal (`memory/connect`, `connections`, `relate`, `egoGraph`) walks only edges active now (no `validUntil` in the past) unless `opts.at` is given, and follows edges in both directions by default. Superseded edges are therefore invisible to the connect tool but stay stored. Depth is clamped to 6. `packages/core/src/graph/traverse.ts:15-25,30-52,62-66`. Note: graph-expanded recall (F7) reads `edgeApi.all()` with no `at`, so it can surface superseded edges; the page should not promise otherwise. `src/tools/strategies/llm-filter-strategy.ts:287`.
- F7. **Graph-expanded recall.** When the agent calls `memory/recall`, if relations is on and any edge exists, edges whose endpoint is named in the query are added as candidates (ego graph, depth 2, at most 10 edges, skipping ones already in the set). The literal subject `user` never triggers expansion. A name must match a whole word of the query, at least 2 characters; multi-word names match as a phrase. `src/tools/strategies/graph-expand.ts:25-31,41-47,80-103`; `src/tools/strategies/llm-filter-strategy.ts:283-295`; `test/tools/graph-expand.test.ts`.
- F8. With relations off, recall's candidate set is unchanged. `test/tools/graph-expand.test.ts` (header: "byte-identical candidate set").
- F9. **Capability helpers** for handlers, on `ctx.cap.memory`:
  - `connections(entity, opts?)` returns the direct (1-hop) edges, `Edge[]`. `[]` when off.
  - `relate(from, to, opts?)` returns the shortest-path `Edge[]`, or `null` when unreachable or off.
  - `egoGraph(entity, opts?)` returns `{ nodes, edges }`. `{ nodes: [], edges: [] }` when off.
  - Names are canonicalized (trim, lowercase). `opts` is `TraversalOpts`: `depth` (default 2, max 6), `direction` (`out`, `in`, `both`; default `both`), `relationTypes`, `at`.
  `src/memory-capability.ts:290-318`; `packages/core/src/graph/traverse.ts:15-25`; `test/tools/connect-tool.test.ts` ("memory capability relation helpers").

## G. Cost

- G1. Extra model work: the consolidation prompt carries a relations section and the model returns an `edges` array. One call, longer prompt and output. Nothing is added to the per-turn path. `src/memory-system-blocks.ts:1153,1196`.
- G2. Recall does extra in-process work (a scan of stored edges for named endpoints) and may return up to 10 more candidates; no extra model call. `src/tools/strategies/graph-expand.ts:25,66-103`. (The llm-filter then ranks the larger set; that is existing recall behavior.)
- G3. More state per owner: every edge is stored in the semantic resource state, so each load of that resource carries them. `packages/core/src/graph/resource-edges.ts:1-12`. `maxEdges` bounds it.
- G4. Traversal is in memory, breadth-first. The existing docs size it at hundreds to low thousands of edges per resource and say it is not a graph database. `apps/docs/docs/resources/edges.md` "When to reach for this". Depth is hard-capped at 6 whatever the caller passes. `packages/core/src/graph/traverse.ts:15-16`.
- G5. Turning relations off costs nothing: no field, no prompt text, no tool. `test/relations.spec.ts` ("DISABLED").

## H. Who sets the vocabulary

- H1. Left unset, the extraction model chooses each `type` as free text in active voice, so two runs can write `works at` and `employed by` for one relationship. The README and the existing page give this reasoning; the code shows only that free text is accepted. `test/relations.spec.ts` ("keeps a free-text edge type when no vocabulary is set").
- H2. Set, the developer's list is put in the prompt and enforced on write: an off-list type is dropped, with a warning. `src/memory-system-blocks.ts:1070-1074,294-297`.
- H3. Type strings are matched exactly; the list should use the spelling the model will emit (README example: `'married to'`, `'works at'`, `'owns'`). The existing page's example uses `drives`, `depends_on`, `exposed_to`, `located_in` (underscores). Either works; the page should pick one style. `packages/memory/README.md:118-125`.
- H4. The model cannot add to the list at runtime; changing it means changing config. Existing edges with other types are not removed. (No code path removes edges on a vocabulary change; `pruneDangling` is the only cleanup.) `src/janitor-blocks.ts:117-123`.

## I. Cleanup

- I1. The hygiene janitor removes dangling edges: after culling facts, any edge whose endpoint is no longer the subject of a stored fact is removed. `src/janitor-blocks.ts:100-123`; `test/relations.spec.ts` ("janitor prunes edges whose endpoint subject was culled").
- I2. That prune is skipped when `createImplicitEntities: true`, since such edges legitimately point at non-subjects. `src/janitor-blocks.ts:117`; `test/relations.spec.ts` ("janitor does NOT prune non-fact-subject edges when createImplicitEntities is true").
- I3. Edge confidence does not decay in the janitor: the janitor's decay pass is over facts (`cullByEffectiveConfidence(semRef, …)`); nothing in it touches edges. `src/janitor-blocks.ts:90-98`. Link to the Hygiene page for the janitor itself.

## J. Limits a reader would otherwise assume away

- J1. Only edges between subjects memory already has a fact about (unless `createImplicitEntities`). A name appearing in conversation but never consolidated into a fact has no node. E5.
- J2. No alias merging: "NVDA" and "Nvidia" are two nodes unless the model uses one subject string for both. A1.
- J3. Recall expansion is name-matching on the query, not semantic. A name the query spells differently does not pull edges. F7.
- J4. In-memory graph; not for millions of edges. G4.
- J5. `connections` is 1 hop only; use `egoGraph` for more. A5.
- J6. Superseded edges stay as history (with `validUntil`) until `maxEdges` evicts them. E9, A4.

## K. Example material for the page (one scenario)

The research-agent scenario the existing page uses is a trading lab with NVDA, a supplier, Taiwan. Facts in tests use `user`, `moni`, `acme`, `stripe`. The page's "Facts and connections" figure (three subjects and the links) can use `nvda`, `tsmc`, `taiwan` with `depends_on` and `located_in`, matching `apps/docs/docs/resources/edges.md` "Adding and traversing" (`nvda depends_on tsmc`, `tsmc located_in taiwan`, path from nvda to taiwan is those two edges). For the figure to be true for memory, each of the three needs a stored fact (E5).

Runnable snippets that type-check against the exported surface:

- `system({ model: "openai/gpt-6-luna", episodic: true, semantic: { relations: { vocabulary: [...] } } })`. `working` is required by `MemorySystemConfig` (pass `true`); the example sets it. `test/relations.spec.ts` "system() wiring" calls `system` with `working: true, episodic: true, semantic: { relations: true }`; `README.md:105-110`.
- `generator({ uses: [mem] })` installs `memory/recall` and, with relations on, `memory/connect`. `test/capabilities.test.ts:785-795`.
- In a handler: `ctx.cap.memory.relate("nvda", "taiwan")` returns edges or `null`. `src/memory-capability.ts:300-305`.

## L. Notes for pass 5

- L1. E2 defaults (5 episodes, on eviction true) come from the README and the type docs; the constant `DEFAULT_CONSOLIDATION_CONFIG` is in `src/memory-system.ts`. The page should link to the semantic tier's page for the schedule rather than state numbers.
- L2. The existing page writes `married_to`; tests and the prompt use `married to` (space). Use the spaced form.

## M. Page revision notes (revise round 1)

- M1. The page states the recall expansion as edges only, up to 10, depth 2 (F7). It does not say facts are pulled in.
- M2. The page says case and spacing variants merge and different names do not (A1, J2). It does not claim alias resolution.
- M3. The page says superseded edges stay stored, connection tools skip them (F6), and `maxEdges` culls closed edges first (A4). It does not promise history is kept without limit. Recall expansion may still surface a closed edge (F6); the page does not promise otherwise.
- M4. Cost: one consolidation call (E1, G1), a longer prompt and output. The page keeps only the when-to-reach-for-it line. "No second round-trip" is cut as mechanism.
- M5. Moved to the memory reference (R-37), page links and does not state: option list and defaults (C1, C3); edge record fields (D); endpoint rules incl. janitor prune only when `createImplicitEntities` is false (E5, I1, I2); superseded-edge culling order (A4); handler helper signatures (F9); limits and cost (G, J).
- M6. Example sets `working: true` because `MemorySystemConfig.working` is required by the type; the K section note that `working` is optional is wrong for the type. Code wins.

## N. Page revision notes (revise round 2)

- N1. Cost section (G1 to G5): no extra model call, longer consolidation prompt and output, recall scan with up to 10 candidates, edges stored unbounded unless `maxEdges`, in-memory traversal sized for hundreds to low thousands, off costs nothing.
- N2. Vocabulary section (D part 2, E6, H1 to H4): developer sets it, model cannot change it; unset gives free text; set is enforced, off-list dropped with a console warning, exact match; existing edges kept. Example vocabulary and prose use the spaced form (L2, H3).
- N3. Supersede walkthrough (E9, F4, F6, J6, A4, I1): closed edge not deleted; connect from nvda to taiwan returns empty results with `totalMatched: 0`; closed edge stays until `maxEdges` evicts it or the janitor prunes it as dangling (an endpoint's fact removed); graph-expanded recall may still surface it.
- N5 (revise round 3). The page states endpoint handling in two parts: trim + lowercase only, no alias merging, so "Nvidia" does not join "nvda" (A1, J2); and an unknown endpoint (for example `nvda depends on samsung` with no Samsung fact) is dropped with a console warning, consolidation continues, and `createImplicitEntities: true` keeps it as a new node (E5, E10). The page no longer says "spacing" is normalised; only trim and lowercase are (A1).
- N4. Relations off and `memory/connect` called: returns, not throws, the error envelope (F5), with the message quoted.
