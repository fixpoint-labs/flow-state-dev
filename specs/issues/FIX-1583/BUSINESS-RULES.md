# FIX-1583 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The cases, written as rules. They bind `defineFacetedCollection` and the example built on it.
*Proved by* names the check in [PLAN.md](PLAN.md#checks). Writing, searching and reindexing
carry FIX-1557's rules over unchanged ([its rules](../FIX-1557/BUSINESS-RULES.md), cited per
row); what is new is that the utility enforces them, and the build-time refusals. The epic's
rules (ER-n, [epic](../../epics/FIX-1553/BUSINESS-RULES.md)) bind here too.

## Building

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | The `evaluator` option is not an evaluator block | Refused when built, with core's shared evaluator-slot message | VB |
| BR-2 | The evaluator's questions are computed per call | Refused when built: the facets and the search options need a fixed question set. The message says to build the evaluator with a fixed questions object | VB |
| BR-3 | The app's config binds `reactTo.contentUpdated` | Refused when built, naming the utility as its owner. `created`, `stateUpdated` and `deleted` bindings pass through unchanged | VB · V10 |
| BR-4 | The app's config grants `client.content.create` or `client.content.update` | Refused when built: a client body edit runs no reaction, so facets would go stale unseen ([D3](DECISIONS.md#d3)). Client reads and deletes are allowed | VB |
| BR-5 | The app's `stateSchema` is not an object, or already declares `facets` or `indexedAs` | Refused when built. The message says the utility adds both, so an app moving off the recipe deletes them from its schema | VB |
| BR-6 | A question id is `minConfidence` | Refused when built: it would collide with the search option | VB |
| BR-26 | The `pattern` is parameterized (for example `[topic]/observations`) | Refused when built: a content change carries such a row's full path, and a string key can't address it. The message names wildcard patterns as the supported shape | VB |
| BR-27 | The evaluator declares resources, directly or through static capabilities | They are carried into the returned `resources`, beside the collection, so registering `resources` on the flow registers them however the search and reindex are mounted. An accessor that collides with `name` is refused when built | VB · V13 |
| BR-28 | The evaluator declares something that can't be carried to the flow: a `flowConfigSchema`, or a lazy single resource (the flow refuses lazy singles at flow level) | Refused when built, naming the declaration. The reaction never runs without what its evaluator declared | VB |
| BR-7 | The utility is built | It names, resolves and builds no model, and calls nothing at build time ([epic D3](../../epics/FIX-1553/DECISIONS.md#d3), ER-11) | V8 |

## Writing

| # | When | Then | Proved by |
|---|---|---|---|
| BR-8 | A body is written inside a flow turn (an action, a tool, an agent's content write) | The evaluator is asked its questions once, with the body as its input. The answers are stored as `facets` exactly as returned, keyed by question id: no confidence added, none dropped (was 1557 BR-1, BR-2) | V1 |
| BR-9 | A body is rewritten | The old facets are cleared and a fresh `indexedAs` token stamped in one state write, before the body is read (was 1557 BR-3) | V3 |
| BR-10 | The evaluator fails or is refused | The write turn still succeeds, the row has no facets, the failure is in the trace. Nothing retries (ER-9) (was 1557 BR-4) | V3 |
| BR-11 | The body is written again before a classification lands, at any point in it | Only answers about the current body are stored: the store runs through `updateState` and keeps them only if the token is still this write's (was 1557 BR-5) | V5 · V9 |
| BR-12 | Facets are stored | No classification runs because of it (was 1557 BR-6) | V6 |
| BR-13 | A row is created with no body, or its body is empty | Nothing is classified (was 1557 BR-7) | V1 |
| BR-14 | The collection is not registered under the accessor the utility was given | The first body write fails, and the error names `resources` and the accessor. The save doesn't quietly skip indexing | V11 |

## Searching

| # | When | Then | Proved by |
|---|---|---|---|
| BR-15 | A search names one or more choice values | It returns the keys of rows whose stored answers match every named value, and makes no model call (was 1557 BR-8) | V2 · VG |
| BR-16 | A row has no facets: never classified, failed, cleared, or stored before the field existed | No facet search returns it (was 1557 BR-9; missing and `null` alike, BP-030) | V2 · V7 |
| BR-17 | A search sets `minConfidence` | A named value also needs a stored `confidence` at or above it; an answer without one fails (was 1557 BR-10) | V4 |
| BR-18 | A search sets no minimum | Matches on the answer alone (was 1557 BR-11) | V4 |
| BR-19 | The search block is offered to an agent as a tool | The agent sees one optional option per choice question, its values the question's option keys, plus `minConfidence`. Still no model call (was 1557 BR-12) | V2 · VT |
| BR-20 | A question is boolean or score | Its answer is stored and readable on the row; the search has no option for it | V1 · VT |

## Reindexing

| # | When | Then | Proved by |
|---|---|---|---|
| BR-21 | Reindex runs | Every row without facets and with a body goes through the same clear, classify and store-if-current path as a write. Rows with facets are skipped (was 1557 BR-14) | V7 |
| BR-22 | Reindex runs with `force` | Every row with a body is cleared and reclassified (was 1557 BR-15) | V7 |

## Moving off the recipe

| # | When | Then | Proved by |
|---|---|---|---|
| BR-23 | An app built on the recipe swaps its collection for the utility, same pattern and scope | Stored facets and tokens are read as they are. Searches return what they returned before, with no reindex ([D2](DECISIONS.md#d2)) | V12 |

## The fence

| # | When | Then | Proved by |
|---|---|---|---|
| BR-24 | Core's resource definers are inspected | `reactTo` accepts what it accepts today; no lazy form ([D1](DECISIONS.md#d1)) | V8 |
| BR-25 | The utility's imports are inspected | Core only. No new dependency, no lab, no `intentClassifier`, no generator (ER-9, ER-11) | V8 |

## Failure taxonomy

A classification failure is never a write failure: the row has no facets, and a facet search
treats that as no match. Nothing retries or falls back. Reindex is how a row recovers. A
*wiring* failure is different: a misconfigured definer is refused when built (BR-1 to BR-6, BR-26 to BR-28), and
a collection registered under the wrong accessor fails its first write (BR-14). Both are loud,
because they will never fix themselves.

## Acceptance criteria this issue owns

- **The Linear issue's outcome.** An app enables facet indexing, searches with an optional
  `minConfidence` and no model call, and reindexes rows without facets, by configuration and
  without authoring the reaction, the conditional store or the token (BR-8 to BR-22).
- **ER-6, carried.** Facets are evaluator answers stored when content is written; a facet search
  makes no model call (BR-8, BR-15).
- **ER-15, leg (e), still green.** The existing goal passes on a real evaluation model with the
  example on the utility (VG).
