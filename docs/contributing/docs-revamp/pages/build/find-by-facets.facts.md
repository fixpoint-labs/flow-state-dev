# Facts for Find records by facets (recipe, split from B-34)

Split from `search-a-collection.md` in revise round 1. It has no sitemap id yet; the caller assigns one. Sources are limited to what a fact sheet may cite: the existing page `apps/docs/docs/resources/searching.md` (`srch`), the exported surface `packages/core/src/types/faceted-collection.ts` (`fc`), and one example, `examples/guides/index-time-facets/` (`ex`: `src/facets.ts`, `src/flow.ts`, `test/`). Facts 1 to 9 of `search-a-collection.facts.md` are in the "Facets" section there (its facts 48 to 52); this sheet restates what the page needs.

Legend: **[page]** the page states it. **[ref]** belongs on `reference/resources`; the page links. **[ran]** compiled against the source in this checkout. **[source]** read from source.

1. **What facets are.** An evaluator answers fixed questions about a document's body when the body is written; the answers are stored on the document; a search filters stored answers and runs no model (`srch:84-88`, `fc:165-183`). **[page]**
2. **`defineFacetedCollection` returns `{ collection, search, reindex, resources }`** (`fc:165-183`, `:396-416`). **[page]**
3. **It reads the questions off the evaluator, so they are a fixed object, not a function.** The evaluator's input is the body, a string (`srch:136`, `fc:233-309`). **[page]**
4. **The collection adds `facets` and `indexedAs` to state.** `stateSchema` must be a `z.object()` without those names (`fc:6-10`, `:108-111`, `:233-309`). **[page: do not add them]**; the full refusal list is **[ref]**.
5. **Choice questions are the searchable ones.** The search takes one optional value per choice question; yes/no and scale answers are stored on `facets` (`fc:85-90`, `:345-359`, `srch:180`). **[page]**
6. **`minConfidence`** is an extra search field in [0, 1]; an answer with no confidence fails it (`fc:85-90`, `srch:178`). **[ref]**
7. **A document with no facets never matches** (`fc:367-390`). **[page]**
8. **Search output is `{ keys: string[] }`** (`fc:345-359`). **[page]**
9. **`tickets.search` can be given to an agent as a tool; the agent sees each question's options as the allowed values** (`srch:174`). **[page]**
10. **Every body write inside a flow turn classifies**, whether from an action, a tool or an agent (`srch:158`, `fc:12-22`). **[page]**
11. **Classification runs on a side chain; its failure does not fail the save; nothing retries** (`srch:161-164`, `fc:12-22`). **[page]** The old facets are cleared before indexing, so a failed classification leaves no facets (`srch:160`). **[ref]**
12. **Facets always describe the current body**: answers from an earlier write are discarded when the body is rewritten during classification (`srch:162`). **[page: the guarantee only]**; the per-store scope of it is **[ref]**.
13. **Pass `tickets.resources` to `defineFlow`, and do not add another entry under the collection's `name`**; a missing or replaced entry fails the first body write, with the body already saved (`srch:138-140`, `ex: src/flow.ts`). **[page: the instruction]**; the failure is **[ref]**.
14. **`reindex` takes `{ force?: boolean }` and returns `{ reindexed, failed }`** (`fc:92-101`, `srch:186`). It covers documents written before facets, and documents whose classification failed; `force` reclassifies every document. Failed documents keep no facets and are not retried. **[page]**
15. **Clients may read and delete documents in a faceted collection, but not create or edit bodies** (`fc:280-287`, `srch:188`). **[ref]**
16. **Projected collections** take facet values in the `filter` of the list query; `defineFacetedCollection` does not build them (`srch:182`). **[ref]**
17. **Type-check [ran].** Under a `strict` tsconfig, an evaluator built with `questions: ticketQuestions` from an inferred object literal is not assignable to the evaluator slot (`config.onCompleted` output types differ). Typing the questions as `EvaluatorQuestions` (exported from `@flow-state-dev/core`) compiles. The example package compiles because its tsconfig sets `strict: false`. **[page: one sentence]** The example's own `TicketEvaluator` annotation type was tried and did not fix it.
18. **Model name `typesafe-ai/jev`** is the evaluation model the existing page uses (`srch:133`, `srch:176`). **[page]**
19. **Dropped from the old page**: classifying the search string with the same evaluator, the text-in-state alternative, and the migration note for existing facet fields. The migration note goes to R-40 for the current release only.
