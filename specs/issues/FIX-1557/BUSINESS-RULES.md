# FIX-1557 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The cases, written as rules. They bind the example under `examples/guides/index-time-facets/`,
which is the recipe apps copy, and the docs that teach it. The *proved by* column is the check
the plan runs (V-n in [PLAN.md](PLAN.md#checks)). The epic's rules (ER-n,
[epic](../../epics/FIX-1553/BUSINESS-RULES.md)) bind here too; ER-6 and leg (e) of ER-15 are the
ones this issue owns.

## Writing

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | A document's body is written inside a flow turn (an action, a tool, an agent's content write) | The app's evaluator is asked its questions once, about that body. Its answers are stored as the document's `facets`, keyed by question id | V1 · VG |
| BR-2 | Facets are stored | Each is FSD's answer as the evaluator returned it: the choice, score or probability, plus `confidence` and `probabilities` only when the model gave them. Nothing added, nothing removed ([D3](DECISIONS.md#d3), ER-3) | V1 · V4 |
| BR-3 | A body is rewritten | The old facets are cleared before the new classification starts, in the blocking part of the reaction ([D2](DECISIONS.md#d2)) | V3 |
| BR-4 | The evaluator fails or is refused while classifying | The write turn still succeeds. The document has no facets. The failure is in the trace, not the user's stream | V3 |
| BR-5 | The body is written again before the first classification finishes, at any point in it: while the model runs, or between the check that the body is current and the facet write | Only answers about the current body are stored. A classification of a superseded body is discarded, and no interleaving of the two writes brings its answers back after the newer write cleared them. ([D2](DECISIONS.md#d2)) | V5 · V9 |
| BR-6 | Storing facets writes the document's state | No classification runs because of it: a state write never fires the content reaction | V6 |
| BR-7 | A document is created with state but no body | Nothing is classified until a body is written | V1 |

## Searching

| # | When | Then | Proved by |
|---|---|---|---|
| BR-8 | A search names one or more facet values | It returns the documents whose stored answers match every named value. It makes no model call: no evaluator or generator runs, and no tokens are spent | V2 · VG |
| BR-9 | A document has no facets (never classified, failed, or cleared) | No facet search returns it, whatever it asks | V2 · V3 |
| BR-10 | A search also sets a minimum confidence | A match also needs a stored `confidence` at or above it. An answer with no confidence fails that condition ([D3](DECISIONS.md#d3), the ER-4 rule applied to search) | V4 |
| BR-11 | A search sets no minimum | Matches on the answer alone. Answers with and without confidence are treated alike | V4 |
| BR-12 | An agent needs the search | It gets the same search as a handler tool, taking the facet values as typed options. Still no model call | V2 |
| BR-13 | The collection is projected (app-backed) | The same facet values go to the collection's `filter` query rather than a full list. The docs show it; the example does not build one | Docs review |

## Reindexing

| # | When | Then | Proved by |
|---|---|---|---|
| BR-14 | The reindex action runs | Every document with no facets and a body is classified, one evaluator call each. Documents that have facets are skipped | V7 |
| BR-15 | The reindex action runs with `force` (the questions changed) | Every document with a body is cleared and reclassified | V7 |
| BR-16 | A body changes outside a flow turn (a client-side content edit, which fires no reaction) | Its old facets stay until reindex. The example grants no client content edits for this reason, and the docs say so | Docs review · V8 |

## The fence

| # | When | Then | Proved by |
|---|---|---|---|
| BR-17 | The example is built | Its flow takes the evaluator block as a parameter and never builds one inside. The model is named once, at the app edge. It imports only published FSD packages: no lab, no kitchen-sink, no `utility.intentClassifier`, no generator classifier ([D1](DECISIONS.md#d1), ER-9, ER-11) | V8 |
| BR-18 | Any shipped package is inspected | Unchanged by this issue. No new export, option or dependency ([D1](DECISIONS.md#d1)) | V8 |

## Failure taxonomy

A classification failure is never a write failure. It leaves the document without facets,
which a facet search treats as "no match", never as a guess. Nothing retries, and nothing falls
back to another classifier or to classifying the search. Reindex is how a document recovers.

## Acceptance criteria this issue owns

- **ER-6.** Facets are evaluator answers stored on a resource when its content is written
  (BR-1, BR-2). A facet search makes no model call (BR-8).
- **ER-15, leg (e).** On a real evaluation model (ER-13), a facet written at index time is found
  by a search that makes no model call (VG). This issue replaces the placeholder
  `fail('e', 'not yet wired — owned by FIX-1557')` in FIX-1556's assembled goal with that check.
- **The Linear issue's desired outcome.** Classify at index time with the shipped `evaluator`;
  persist typed answers as facets on the resource; deterministic search over them; no second
  classifier, Decisions client or System One package; query-time classify an escape hatch only
  (BR-1, BR-8, BR-17, [DOCS.md](DOCS.md)).
