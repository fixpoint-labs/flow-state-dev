# FIX-1583 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

Facets already have a home: "Find by facets" on the resources searching page, owned by FIX-1557
under the epic's [ownership table](../../epics/FIX-1553/DOCS.md#ownership). This issue changes
what that section teaches (use the definer, [D2](DECISIONS.md#d2)) and points the collections
page at it. `defineFacetedCollection` is a collection definer, not a utility block, so it is not
added to the utility-blocks reference ([D1](DECISIONS.md#d1)). No new page and no sidebar change. The
section's opening two paragraphs ("Some searches aren't about words…", "Facets move the question
to write time…"), "Classifying the search instead" and the "Choosing a tool" bullet are
unchanged and not repeated here. Snippets are cut from the example once it's built (its
`excerpts.test.ts` checks them). At implement time, run the prose through `docs-writer` then
`docs-editor` against shipped behaviour.

## UPDATE · `apps/docs/docs/resources/searching.md` · "Find by facets", from "The pattern uses…" through the end of "Searching facets"

Replace that span with:

> `defineFacetedCollection` defines a collection that does this for you. You bring the
> fields you'd store anyway and an evaluator that asks your questions. It returns the
> collection, a search block and a reindex block.
>
> ```ts
> import { choice, defineFacetedCollection, evaluator } from "@flow-state-dev/core";
>
> export const ticketQuestions = {
>   topic: choice("What is this support ticket about?", TOPICS), // billing | outage | other
>   status: choice("Is the customer's problem still open?", STATUSES), // open | closed
> };
>
> const triage = evaluator({ name: "ticket-facets", model: "typesafe-ai/jev", questions: ticketQuestions });
>
> const tickets = defineFacetedCollection({
>   name: "tickets",
>   pattern: "tickets/*",
>   scope: "user",
>   stateSchema: z.object({ title: z.string() }),
>   evaluator: triage,
> });
>
> const flow = defineFlow({
>   kind: "support",
>   resources: tickets.resources,
>   actions: {
>     write: { block: writeTicket }, // any block that calls writeContent on a ticket
>     search: { block: tickets.search },
>     reindex: { block: tickets.reindex },
>   },
> });
> ```
>
> Build the evaluator where you configure the app, so the model is named in one place. The
> definer never picks a model. It reads the questions off the evaluator, so they have to be a
> fixed object rather than a function.
>
> `name` is the key the collection is registered under. Pass `tickets.resources` to the flow so
> it is always registered under that key, even when the search is only ever used as an agent's
> tool. `tickets.resources` also carries anything your evaluator declares, so it is available
> when the evaluator runs.
>
> A few shapes are refused when the collection is defined, each with the reason: a key pattern
> with parameters such as `[topic]/observations` (use a wildcard pattern like `tickets/*`), an
> evaluator whose questions are a function, and an evaluator that needs flow config.
>
> ### What it does on every write
>
> Any body write inside a flow turn indexes the same way: an action, a tool, an agent writing
> content. The collection keeps two fields beside yours. `facets` holds the answers, keyed by
> question id, and `indexedAs` records which write they belong to.
>
> - **It clears the old facets first.** The body is saved before indexing starts. If classifying
>   the new body fails, the document has no facets and matches no facet search, instead of
>   matching on answers about text it no longer contains.
> - **It classifies in the background.** The evaluator runs on a
>   [side chain](/docs/sequencers/composing-blocks#sidechain--fire-and-forget-background-tasks),
>   so a failed or refused model call shows in the trace and doesn't fail the save. It finishes
>   before the turn ends, so the next turn's search sees the new facets.
> - **It only stores answers about the current body.** If the body is written again while the
>   first classification is still running, the first answers are thrown away. The check and the
>   write commit together on the memory, SQLite and Postgres stores. The filesystem store locks
>   each record within one process only.
>
> Nothing retries. A document whose classification failed stays without facets until you
> reindex it.
>
> Storing facets is a state write, so it doesn't start another classification.
>
> ### Searching facets
>
> `tickets.search` takes one optional value per choice question and returns the matching keys.
> It filters stored answers and runs no model:
>
> ```ts
> // { "topic": "billing", "status": "open" } → { "keys": ["t1", "t7"] }
> ```
>
> Hand the same block to an agent as a tool. The agent sees each question's options as the
> allowed values.
>
> Answers are stored exactly as the model gave them. [Jev](/docs/fundamentals/models#evaluation-models),
> an evaluation model you reach through Vercel's AI Gateway, also reports how sure it was. Most
> evaluation models don't. A plain search matches on the answer alone.
>
> When you only want answers the model was sure of, add `minConfidence`:
> `{ "topic": "billing", "minConfidence": 0.8 }`. An answer with no confidence fails that check,
> so on a model that never reports confidence, a search with a minimum finds nothing.
>
> The search offers options for choice questions only. Answers to yes/no and scale questions are
> stored on each document's `facets`, where your own code can read them.
>
> On a [projected collection](/docs/resources/projected-collections), where your own database
> holds the rows, pass facet values in the `filter` of your list query instead. The definer
> doesn't build projected collections.

## UPDATE · `apps/docs/docs/resources/searching.md` · "### Reindexing"

Replace the section with:

> ### Reindexing
>
> Documents get facets when their body is written inside a flow turn. `tickets.reindex` covers
> the rest: documents that existed before you added facets, documents whose classification
> failed, and, with `{ "force": true }`, every document after you change the questions. It
> returns the keys it reindexed.
>
> A faceted collection doesn't allow clients to create or edit bodies directly. Those edits run
> outside a flow turn, so nothing would reclassify them. Write bodies through an action instead.
>
> If you already store facets with a hand-written reaction, switching keeps them. Delete
> `facets` and `indexedAs` from your `stateSchema` (the definer adds both), replace the
> collection definition with `defineFacetedCollection`, and existing documents are found as
> before, with no reindex.
>
> If your text lives in state rather than the body, the definer doesn't fit. Bind `created` and
> `stateUpdated` yourself, with a `when` that checks the text fields changed; the
> [definer's source](https://github.com/fixpoint-labs/flow-state-dev/tree/main/packages/core/src/types/faceted-collection.ts)
> shows the three rules to keep.

## UPDATE · `apps/docs/docs/resources/collections.md` · "See also"

Add after the searching line:

> To classify each instance's body once when it's written and search the answers without a
> model call, define the collection with `defineFacetedCollection`. See
> [Find by facets](./searching#find-by-facets).

## UPDATE · `packages/core/README.md` · resource definers

Add after the `defineResourceCollection(config)` bullet:

> - `defineFacetedCollection(config)` — Defines a resource collection whose bodies are
>   classified once on write by the evaluator you pass, storing its answers as `facets`. Returns
>   `{ collection, search, reindex, resources }`: a search over stored answers with optional
>   `minConfidence` and no model call, and a reindex for rows without facets (`force` for all).
>   `resources` also carries the evaluator's declared resources. Refuses, when built, client body
>   edits, a second `contentUpdated` binding, parameterized key patterns, and an evaluator with
>   computed questions or a `flowConfigSchema`.

## UPDATE · `examples/guides/index-time-facets/README.md`

Replace the description of `src/index-facets.ts` and the copy instructions with one line: "The
collection, its indexing and its search come from `defineFacetedCollection`; `src/flow.ts`
shows the whole setup." Commands are unchanged.

## Voice notes for the writer

- The page is published docs: no issue or PR numbers, and no "the recipe used to".
- Introduce "facet" and "evaluator" in plain words on first use (the section already does).
- Watch em-dashes and three-item escalating lists in the rules list; the draft keeps them flat.
