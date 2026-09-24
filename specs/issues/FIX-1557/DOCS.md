# FIX-1557 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

The epic's ownership table gives this issue "index-time facets on the resources pages"
([epic DOCS](../../epics/FIX-1553/DOCS.md#ownership)). No new page: facets are one more way to
find a resource, so they go on the page that already lists the others and names the question
they answer. The evaluator itself is FIX-1554's `### Evaluator` section, linked, not repeated.
Snippets are cut from `examples/guides/index-time-facets/` once built; names follow FIX-1554's
shipped exports.

## UPDATE · `apps/docs/docs/resources/searching.md` · opening paragraph

Replace the paragraph's last two sentences with:

> It does not cover "find the concept whose body mentions `useEffect`" or "which concepts are
> about hooks". The first is a text search, covered below. The second is a question about
> meaning, and the cheapest way to answer it is to ask once, when the content is written, and
> keep the answer. That's [facets](#find-by-facets).

## UPDATE · `apps/docs/docs/resources/searching.md` · new `## Find by facets` before "Choosing a tool"

> ## Find by facets
>
> Some searches aren't about words. "Open billing tickets" should find the ticket that says
> "I was charged twice", which never uses either word. A model can answer that, but asking it on
> every search is slow and costs a call per lookup.
>
> Facets move the question to write time. When a document's body is written, an
> [evaluator](/docs/fundamentals/blocks#evaluator) answers a few fixed questions about it (which
> topic, what status) and the answers are stored on the document. Searching is then a filter
> over stored answers. No model runs.
>
> Three pieces, all of them things you already have: a `facets` field on the collection's state,
> a [reactive block](/docs/resources/reactive-blocks) on `contentUpdated` that fills it, and a
> search that reads it.
>
> ```ts
> const ticketFacets = { topic: choice("What is it about?", { billing: "…", outage: "…", other: "…" }),
>                        status: choice("Is it resolved?", { open: "…", closed: "…" }) };
>
> export function ticketsFlow(triage: EvaluatorDefinition<typeof ticketFacets>) {
>   const tickets = defineResourceCollection({
>     pattern: "tickets/*",
>     scope: "user",
>     stateSchema: z.object({
>       title: z.string(),
>       facets: facetsSchema.nullable().default(null),
>       indexedAs: z.string().nullable().default(null),
>     }),
>     reactTo: { contentUpdated: indexFacets(triage) },
>   });
>   // … actions: write, search, reindex
> }
> ```
>
> The flow takes the evaluator as a parameter. Build it where you configure the app, so the
> model is named in one place:
>
> ```ts
> const triage = evaluator({ name: "ticket-facets", model: "typesafe-ai/jev", questions: ticketFacets });
> ```
>
> `indexFacets` is about twenty lines, and the [companion example](https://github.com/fixpoint-labs/flow-state-dev/tree/main/examples/guides/index-time-facets)
> has it in full. Copy it rather than rewriting it, because it gets three things right:
>
> - **It clears the old facets first.** The body is already saved when the reaction runs. If
>   classifying the new body fails, a document keeping its old answers would match searches for
>   text it no longer contains. With no facets, it matches nothing, which is honest.
> - **It classifies on a side chain.** A failed or refused model call shows up in the trace
>   and doesn't fail the save. The side chain finishes before the turn ends, so the next turn's
>   search sees the new facets.
> - **It stores only answers about the current body.** Each write stamps the document with a
>   fresh token, and the answers are stored with `updateState`, which checks that token and
>   writes in one step. If the body is written again while the first classification is running,
>   the first answers are thrown away. Reading the body and then calling `patchState` looks the
>   same and isn't: a second write can land between the two.
>
> Storing the facets is a state write, so it doesn't fire `contentUpdated` again. No loop.
>
> ### Searching facets
>
> ```ts
> const hits = (await ctx.resources.tickets.list()).filter(
>   (t) => t.state.facets?.topic.choice === "billing" && t.state.facets?.status.choice === "open",
> );
> ```
>
> The example wraps this in a `search` handler you can hand an agent as a tool. On a
> [projected collection](/docs/resources/projected-collections), pass the values in the
> `filter` of your list query instead, so your own database does the filtering.
>
> Answers are stored exactly as the model gave them. Jev also reports how sure it was; the
> popular providers' evaluation models don't. A plain search matches on the answer alone. When
> you only want answers the model was sure of, add a minimum confidence, and remember that an
> answer with no confidence fails that check. On a model that never reports confidence, a
> minimum finds nothing.
>
> ### Reindexing
>
> Documents get facets when their body is written inside a flow turn. Three cases need a
> reindex, which the example ships as an action: documents that existed before you added facets,
> documents whose classification failed, and every document after you change the questions
> (`force: true`). Content edited straight from a client doesn't run reactions, so the example
> doesn't allow client content edits on this collection. If yours does, reindex after them.
>
> If your text lives in state rather than the body, bind `created` and `stateUpdated` instead,
> with a `when` that checks the text fields changed. That check also keeps the facet write from
> re-triggering the reaction.
>
> ### Classifying the search instead
>
> You can run the same evaluator on a search string to turn "anything about refunds that's still
> open?" into facet values. That's a model call on every search, so keep it for the case where
> the caller can't pick values from a list. It isn't the default, and nothing in the example
> does it.

## UPDATE · `apps/docs/docs/resources/searching.md` · "Choosing a tool", new last bullet

> - **Facets** when the question is about meaning (topic, status, kind) and you can decide the
>   questions ahead of time. The model runs once per write, not per search.

## UPDATE · `apps/docs/docs/resources/reactive-blocks.md` · end of "Reacting to content changes"

> Classifying a document's body into stored answers you can filter on is one such reaction.
> See [Find by facets](/docs/resources/searching#find-by-facets).

## CREATE · `examples/guides/index-time-facets/README.md`

> # Index-time facets
>
> Runnable companion code for [Find by facets](https://flow-state.dev/docs/resources/searching#find-by-facets).
> A ticket collection classifies each ticket's body once, when it's written, and searches the
> stored answers with no model call.
>
> ```bash
> pnpm test                     # mock evaluation model, no API key
> pnpm fsdev run index-time-facets write  -i '{"key":"t1","title":"Charged twice","body":"I was charged twice for March."}'
> pnpm fsdev run index-time-facets search -i '{"topic":"billing"}'
> ```
>
> The model is set in `fsdev.config.ts`. It uses Jev through Vercel's AI Gateway when
> `AI_GATEWAY_API_KEY` is set, and `openai.evaluationModel("gpt-5.4-mini")` otherwise. The
> in-memory store lasts one process, so run `write` and `search` against a persistent store,
> or use the tests to see both turns.

## Ownership and voice

This issue publishes all of the above. FIX-1554 owns the evaluator reference it links; FIX-1556's
guide does not mention facets. No README of a published package changes. Voice rules most at risk
here: em-dashes in the three-rule list, and "This…" openers in the reindexing paragraph. No
internal issue numbers in the published pages.
