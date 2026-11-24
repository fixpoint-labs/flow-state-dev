# Facts for Search a collection (B-34, recipe)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests, `goals/`, one example. No spec, no `docs/internal/`, no `CLAUDE.md`. Paths are from the repo root.

Abbreviations:

- `srch` = `apps/docs/docs/resources/searching.md` (the page this recipe keeps)
- `col` = `apps/docs/docs/resources/collections.md`
- `ov` = `apps/docs/docs/resources/overview.md`
- `proj` = `apps/docs/docs/resources/projected-collections.md`
- `sas` = `apps/docs/docs/fundamentals/state-and-scopes.md`
- `rst` = `packages/core/src/tools/resource-search-tools.ts`
- `rt` = `packages/core/src/tools/resource-tools.ts`
- `rc` = `packages/core/src/types/resource-collection.ts`
- `rstest` = `packages/core/test/resource-search-tools.test.ts`
- `opf` = `packages/engine/test/owner-private-fence.test.ts`
- `uck` = `packages/engine/test/user-cell-keys.test.ts`
- `rv` = `packages/engine/test/resource-visibility.test.ts`
- `kb` = `examples/knowledge-base/src/` (`capability.ts`, `concepts.ts`, `flow.ts`)
- `resp` = `docs/contributing/docs-revamp/pages/concepts/resources.md` (the drafted C-08 page, cited for the example's names only)

Legend: **[page]** the page states it. **[ref]** belongs on `reference/resources`; the page links, does not state it. **[verify]** not confirmed against running code; keep off the page or soften. **[contradiction]** two sources disagree; the ruling is given. **[answers Qn]** the sitemap question it answers. **[ran]** I ran it against the source in this checkout (throwaway test, removed). **[test]** pinned by a test. **[source]** read from source, not run.

The sitemap's two questions are **Q1: What is searched?** and **Q2: Whose records come back?**

## Read this first: things the page cannot say, and corrections

1. **There is no per-field "searchable" marker, so step 1 "mark fields searchable" cannot be taken literally.** The unit that opts in is a whole collection (or a single resource), with `llmReadable: true`, and what is searched is the content body, not state fields. `llmReadable` is declared once on the collection and "applies to every instance" (`rc:139-146`). Grep and search read `ref.readContent()` and nothing else (`rst:169`, `rst:248`, `rst:270`); no code path in `rst` reads `ref.state`. **[contradiction: the sitemap step wording vs the code. The code wins. The page's step 1 is "mark the collection `llmReadable`", and says that a state field is found only if the body renders it.]** [answers Q1]
2. **A state field is searchable only when the body renders it.** Search and grep match the rendered text, the same string `readContentTool` returns (`rst:18-20`, `srch:74`). A body that is a template over state (`render`, `contentTemplate`) is found by what it renders to, not by its template source (`rstest:225-244`, **[test]**: `Alice` is found, `state\.name` is not). Templates are `ov:265-281`, `rc:132-137`. **[page: one sentence, with `ticketNotes` having its `author` in state and not in the body, so "who wrote it" is not searchable unless the body says so.]** [answers Q1]
3. **The existing page's example generator is incomplete.** `srch:20-27` builds `librarian` with `tools: [...]` and no `resources`. The search tools read the registry on `ctx.resources` (`rt:40-54`, `rst:132`, `:165`, `:222`), which holds only resources the flow or the block declares (`ov:376`, `ov:331`; example with `resources: { notes }` beside `tools` at `col:456-470`). A collection declared nowhere is not searched, and nothing errors. **[page: the generator example declares `resources: { notes: ticketNotes }`.]**
4. **The existing page opens on "facets".** `srch:7` and `srch:80-190` spend more than half the page on `defineFacetedCollection`. The sitemap entry's steps are the text tools only, and no other page in the sitemap or the reference mentions facets (searched `SITEMAP/*.md` for "facet": no hit; `reference/resources.md` draft: no hit). **[resolved in revise round 1: facets moved to their own recipe, `./find-by-facets.md`, with its own sheet `find-by-facets.facts.md`. This page states none of them and links to that page once in its opening and once in "Choosing a tool". The section "Facets (off this page's steps)" below is kept as the source for that sheet.]**
5. **Migration notes to cut.** `srch:` "Moving an existing collection over" (`srch:190-192`) is a migration note for a prior shape of the facets feature. Cut, per the sitemap.
6. **`grep`'s pattern is a regex; invalid regex falls back to literal.** The existing page says so in two places (`srch:59`, `srch:78`). Say it once, or leave it to Reference. **[ref]**

## The recipe's one scenario

The page uses the revamp's support desk (`user-docs.md` "Code examples"). The drafted C-08 page defines `ticketNotes`: `defineResourceCollection({ pattern: "ticketNotes/**", scope: "session", stateSchema: z.object({ author: z.string(), pinned: z.boolean().default(false) }) })` in `src/flows/support/resources/ticket-notes.ts` (`resp:60-70`), written by `addNote`, which does `ctx.resources.notes.create(input.key, { author })` then `note.writeContent(input.text)` (`resp:80-94`), and `draftReply`, a generator (`resp:42-58`). C-08's "Next" links to this page as "finds notes by path and by content" (`resp:177`). **[names only; the page adds `llmReadable: true` to `ticketNotes`.]**

Existing worked example for comparison: `kb/concepts.ts` declares `conceptCollection` with `pattern: "concepts/**", scope: "user", llmReadable: true, llmWritable: true`; `kb/capability.ts` installs `[nav.globResources, nav.grepResourceContent, nav.searchResources, readContent]` as a generator's tools and `kb/flow.ts` mounts `kb.nav.searchResources` as the `searchConcepts` action. **[example for shape only]**

## Step 1: Mark the collection searchable (`llmReadable`)

7. **`llmReadable` is a collection-wide flag, default `false`.** "Collection-wide — applies to every instance ... Default `false`: a collection that doesn't opt in stays invisible to those tools." `rc:139-146`, `col:446-453`, `ov:289`. **[page]**
8. **It gates search, grep, glob and the content-read tool together.** One gate, `isLlmReadable(ref)` = `ref.config?.llmReadable === true` (`rt:254-256`); glob, grep and search all enumerate through `collectReadableResources` (`rst:132`, `:165`, `:222`). A collection that did not opt in is skipped before it is listed, so it is never loaded to find out (`rt:289-296`; test `rstest:102-119`, `:168-189`, **[test]**). Glob is gated too, though it reads no content, because a path is a disclosure (`rst:7-16`, `srch:48`). **[page: one sentence]**
9. **A static resource opts in the same way.** `defineResource({ ..., llmReadable: true })` (`ov:289`, `rv:49-58` uses it with `llmWritable`); one that did not opt in is left out (`rstest:121-125`, **[test]**). **[page: a clause, only if the page mentions single resources. It need not.]**
10. **`llmWritable` is independent.** The write tool gates on `llmWritable` alone (`rc:147-152`, `col:453`). Search needs only `llmReadable`. **[ref]**
11. **Searching reads content only; it does not return state.** Results are `{ uri, score, snippet }` or `{ uri, line, snippet }` or `uris` (`rst:120-130`, `:153-161`, `:202-211`), none carries state. A `secret` field of the collection is therefore never in a search result through its state. The model's separate state read, `readResource`, omits `secret` fields (`rt:154-168`, `rc:140-143`). **[ref: `secret` belongs on `reference/resources`; the page needs no sentence.]**
12. **Config doc and example type-check with the field.** The `ticketNotes` definition above plus `llmReadable: true` is a valid `ResourceCollectionConfig` (`rc:146`). **[page]**

## Step 2: Query from a block

The three blocks come from one call: `const { globResources, grepResourceContent, searchResources } = resourceSearchTools();` imported from `@flow-state-dev/core` (`rst:115-296`, `packages/core/src/index.ts:231`). Each is a handler block, so it is mounted anywhere a block goes. **[page]**

13. **Mount a search block as a flow action.** `defineFlow({ actions: { search: { block: searchResources } } })`. Both the engine test and the knowledge-base example do this (`rv:96-103` mounts `glob` and `grep` with `inputSchema: z.object({}).passthrough()` / `z.object({ pattern: z.string() }).passthrough()`; `kb/flow.ts` `searchConcepts: { block: kb.nav.searchResources }`). The mounted block must still have the collection declared on the flow (via `resources` on the flow, or on a block the flow contains). **[page]** Whether to give the action an explicit `inputSchema`: the examples that mount without one (`kb/flow.ts`) work, the engine test supplies one. **[verify: not run end to end here; the page may show the action with no `inputSchema` only after `fsdev run` confirms the call shape. The block's own input schema is the validation either way, `packages/core/src/blocks/internal/build-block.ts:152-166`.]**
14. **Use it as a step in a sequencer.** `.step(connector, searchResources)`, where the connector builds the block's input. Type-checked **[ran]** against `packages/core/src`: `sequencer({ name, inputSchema: z.object({ text: z.string() }) }).step((i: { text: string }) => ({ query: i.text }), searchResources)` compiles, and so does the version that passes `prefix: null, limit: 5, cursor: null` too. So `{ query }` alone is a valid input; the defaults fill the rest. Rule: a handler does not call another block, so composing is a sequencer step, not a call from inside `execute` (`user-docs.md` page tests and the block docs; not restated on the page). **[page]**
15. **`searchResources` input and output.** Input `{ query: string, prefix: string | null = null, limit: number = 10, cursor: string | null = null }`. Output `{ results: { uri, score, snippet }[], nextCursor?: string }` (`rst:188-211`). **[page: the table row for the one tool the recipe uses; the other two inputs are [ref] or one line each.]**
16. **`globResources` input and output.** Input `{ pattern: string | null = null, limit: number = 100 }`; output `{ uris: string[] }`. A null pattern returns every readable resource uri, sorted (`rst:116-138`, `rstest:91-97`, **[test]**). **[ref]** (the existing page gives the three pattern examples at `srch:36-44`; the page may keep `concepts/**` as `ticketNotes/**` in one line.)
17. **`grepResourceContent` input and output.** Input `{ pattern: string, prefix: string | null = null, maxResults: number = 50 }`; output `{ matches: { uri, line, snippet }[] }`, `line` 1-based (`rst:140-182`, `rstest:142-154`, **[test]**). **[ref]**
18. **How `searchResources` ranks.** The query is lower-cased and split on non-word characters into terms; each resource's score is the total count of every term's occurrences in its lower-cased content; a score of 0 drops the resource; results sort by score descending, then by uri (`rst:213-216`, `:267-280`; `rstest:318-335`, `:337-354`, **[test]**). Ties break by uri (`rst:280`). A query with no usable terms returns `{ results: [] }` (`rst:217`, `rstest:370-377`, **[test]**). **[page: "most occurrences first, ties by uri" in a clause.]**
19. **Matching is by substring, not by whole word.** **[ran]** A search for `use` matched a note reading "The user asked about refunds" with score 1. Terms count occurrences with `indexOf` (`rst:77-87`, `:275`). The existing page says "exact word and substring matching" (`srch:15`). **[page: say substring, with the one example.]** 
20. **Terms split on ASCII non-word characters.** **[ran]** A search for `café` found a note reading "café menu"; the split is `/\W+/` (`rst:215`), which treats the accented letter as a separator, so the term searched is `caf`. **[verify the wording: state as "search matches fragments; accented letters split a term" only if the caller wants a limit sentence; otherwise [ref].]**
21. **Snippet.** The first content line containing any term, else the head of the content, trimmed and cut to 200 characters plus an ellipsis (`rst:36-37`, `:52-55`, `:89-96`; `rstest:356-368`, **[test]**). **[page: one clause; the 200 is [ref].]**
22. **Each result carries a scope-qualified uri, not a bare path.** `uri` is `${scope}/${path}`, for example `session/ticketNotes/T-1042` (`rst:21-23`, `ov:388-404`, `srch:34`). The `prefix` argument and glob patterns match the within-scope path, so a caller writes `ticketNotes/**`, not `session/ticketNotes/**` (`rst:23-26`, `rstest:55-56`, **[test]**). **[page]**
23. **`prefix` matches on a path boundary.** `prefix: "ticketNotes"` matches `ticketNotes` and `ticketNotes/T-1042`, never `ticketNotesX` (`rst:39-50`, `rstest:208-223`, **[test]**). **[ref]**
24. **A result feeds straight into a read.** `readResourceContentTool()` accepts the uri (`srch:34`, `ov:293`, `col:477`, `examples/knowledge-base/README.md:65`). **[page: one sentence, and it is why the generator in step 3 gets both tools.]**
25. **Default sizes.** Search returns at most 10 (`rst:195`), grep 50 (`rst:151`), glob 100 (`rst:126`). **[page: search's 10 in the table, the others [ref].]**
26. **Search reads the whole collection on every call.** The store-backed branch enumerates every readable instance with `list()` and reads each body (`rt:289-296`, `rst:222`, `:268-279`). The file header says so: "these tools enumerate the collections they search, so they suit bounded, curated content" (`rst:25-27`). `srch:76` says the same. **[page: one limit sentence, "good for a bounded set, not a large corpus". Lexical only, no meaning or synonyms (`rst:27`, `srch:15`).]** [answers Q1]
27. **Not sandboxed against bad regexes.** `grepResourceContent` runs a regular expression line by line over trusted content and does not guard against catastrophic patterns (`rst:57-68`, `srch:78`). **[ref, or one clause in the Limits paragraph if the page names grep's regex.]**
28. **A projected collection is searched through its own `search` hook.** `searchResources` sends `{ search, prefix?, limit, cursor? }` to the collection's `list`, which calls the app's `search` hook; ranking is the hook's order (score is `count - index`) (`rst:238-256`, `proj:106`, `proj:138`). `globResources` and `grepResourceContent` skip projected collections (`rt:74-85` excludes them from store-backed enumeration; `proj:106`). **[page: one sentence and a link to `reference/resources` or the projected-collections page. [ref] for the cursor rule: `nextCursor` comes back only when one projected collection is the only searchable source (`rst:231`, `proj:139`).]**
29. **Mixed store-backed and projected results share one page of at most `limit`.** (`rst:282-291`). **[ref]**

## Step 3: Give search to a model

30. **The three blocks go in a generator's `tools`.** `tools: [search.globResources, search.grepResourceContent, search.searchResources]` (`srch:17-28`; `kb/capability.ts` search preset: `[nav.globResources, nav.grepResourceContent, nav.searchResources, readContent]`). The collection is declared on the same generator, `resources: { notes }`, as in `col:456-470` (same shape with `readResourceContentTool()` and `writeResourceContentTool()`). **[page; example must declare the collection, see fact 3.]**
31. **Tool names the model sees.** `globResources`, `grepResourceContent`, `searchResources` are the block names (`rst:117`, `:141`, `:185`); each block's `description` is what the model reads (`rst:118-119`, `:142-143`, `:186-187`), and the input schema's `.describe(...)` text is the argument hint (`rst:125`, `:145`, `:189`). **[page: no need to quote them.]**
32. **The model needs `readResourceContentTool()` to read a whole body.** A hit carries a 200-character snippet; the full text comes from reading the uri (`kb/capability.ts` comment: "`readResourceContent` lets the model fetch a full concept body by uri when the snippet isn't enough"; `rst:36-37`). **[page: add it to `tools` in the example.]**
33. **A flow can narrow what the model reaches on a turn.** `resourceVisibility` is a function returning `"visible"`, `"read-only"` or `"hidden"` per resource; a hidden resource is not listed, searched, read or written and answers like one that does not exist (`ov:295`, `rt:24-54`, `rv:1-26`, `:78-113`, **[test]**). With no rule, every `llmReadable` resource the flow declares is reached (`rt:37-38`). **[ref: the page may say "a flow can narrow this per turn" with a link.]** [answers Q1]
34. **The model's calls are recorded as tool calls like any block's.** **[verify]** Not needed on the page.

## The four questions, for each stored part

The recipe stores nothing itself. The stored parts it touches are the collection's instances (the notes) and, for the facets section only, `facets` and `indexedAs`. The search tools are stateless handler blocks.

### A collection instance (a note), as seen by search

| Question | Answer | Source |
| --- | --- | --- |
| Who owns it | The scope the collection declares: `session`, `user` or `org`. A session-scoped note belongs to one session, a user-scoped note to one user inside one organization, an org-scoped note to the organization. | `rc:96-99`, `ov:378-386`, `sas:491` |
| Who can see it | Blocks that declare the collection, in the scope the run resolves to; the model only if `llmReadable`, and then through the search tools; the browser only if `client` is set. | `rc:139-146`, `rt:40-54`, `ov:289-295` |
| Where it is stored | The scope's resource store, one record per instance, keyed by scope then path (`session/ticketNotes/T-1042`). | `ov:388-404`, `col:389` |
| How many exist | As many as are created. Unbounded unless `maxInstances` is set. Search reads all of them each call. | `rc:115-116`, `col:273-281`, `rst:25-27` |

### Q2: Whose records come back

35. **Search returns only the records of the scope identity the run resolves to.** The tools enumerate `ctx.resources`, the run's registry, and call `list()` on each readable collection (`rt:289-296`). A session-scoped collection lists the current session's instances. A user-scoped collection lists the current user's, inside the current organization. An org-scoped collection lists the organization's. **[source; page: state this as the guarantee.]** [answers Q2]
36. **A user's data is keyed by user and organization.** One user has a different cell in each organization: `alice:~org:acme` is not `alice:~org:globex` (`uck:34-52`, **[test]**; `sas:491`: "Alice in Acme and Alice in Globex have two user records, and two copies of every user-scoped resource"). So a user-scoped search in one organization never returns what the same user saved in another. [answers Q2]
37. **Org scope is shared by everyone in the organization**, so an org-scoped collection's search returns the same records to every user of that organization (`sas:493`, `ov:386`). [answers Q2]
38. **An owner-private collection returns each user only their own rows.** `ownerPrivate: { param }` collections serve a row only to the user its owner segment names: lists and counts leave other users' rows out (`col:229`, `rc:76-83`). Search enumerates through `list()`, so it follows. Test of the list behaviour: bob's list is `[]` and count `0` for alice's row, alice's is her rows (`opf:262-279`, `opf:431-441`, **[test]**). A collection using `ownerPrivate` and `llmReadable` together is built in `packages/engine/test/resource-tools-path-matching.test.ts:53-59`. **[verify: no test runs `searchResources` itself against an owner-private collection; the sentence is derived from `rt:293` (`list()`) plus the fence tests above. The page may state "an owner-private collection's search returns only the caller's rows" only after one `fsdev run` check, or soften it to "follows the collection's own visibility".]** [answers Q2]
39. **Owner-writes collections return everyone's rows to everyone the scope serves.** `ownerWrites` rows are readable by all in the scope, writable only by their owner (`rc:84-93`, `col:244-267`). **[ref]**
40. **A projected collection returns whatever its `search` hook returns for the caller.** The hook receives `ctx.userId`, `ctx.orgId`, `scopeId`, derived from the request; the app scopes its own query with them, and "a user sees in one organization what they saved in another" if it does not (`proj:52`, `proj:113-119`). **[page: one sentence and a link; this is the one place a search can return the wrong user's data, and the app's hook owns it.]** [answers Q2]
41. **The caller is server-derived, not the model's.** Search takes no user id argument: the inputs are `query`, `prefix`, `limit`, `cursor` (`rst:188-201`). The model cannot ask for another user's notes by passing an id. **[page: one sentence.]** [answers Q2]
42. **A flow that sets no `resourceVisibility` lets every turn's model reach every `llmReadable` resource the flow declares**, so per-worker narrowing is the app's rule: `goals/workforce-workers/a-worker-reaches-the-documents-its-file-names/fixtures/flows.ts` builds the desk flow with and without the rule (`withoutRule` is the control). **[ref]**

## What it won't do (for the one Limits paragraph, or `reference/resources`)

43. Not meaning-aware: no synonyms, no embeddings (`rst:26-27`, `srch:15`, `srch:76`). For meaning use memory or a retrieval layer (`srch:15`, link `/docs/memory/overview`; check the target exists in the revamp's sitemap before linking).
44. Not state: state fields are not searched (fact 1).
45. Not an unbounded corpus: every call reads every readable body (fact 26).
46. Not for a collection that did not opt in: it answers as a collection nothing registers; nothing errors (`rt:289-296`, `rv:78-113`).
47. Not an update: nothing written by the tools. All three are reads (`rst:116-295`).

## Facets (off this page's steps; the caller decides whether any page takes them)

`defineFacetedCollection` is exported from `@flow-state-dev/core` (`packages/core/src/index.ts:73`) and documented at length on `srch:80-190` and in the example `examples/guides/index-time-facets/` (`src/facets.ts`, `src/flow.ts`, `test/facets.test.ts`). Facts the existing page states and the code confirms:

48. It returns `{ collection, search, reindex, resources }`; `search` filters stored answers and runs no model (`packages/core/src/types/faceted-collection.ts:165-183`, `:396-416`).
49. It adds two fields to state, `facets` and `indexedAs` (`faceted-collection.ts:6-10`, `:108-111`).
50. Search input is one optional value per choice question plus `minConfidence` in [0, 1]; output `{ keys: string[] }` (`faceted-collection.ts:85-90`, `:345-359`). A row with no facets never matches (`:367-390`).
51. Every body write inside a flow turn reclassifies on a side chain; failure does not fail the write; nothing retries (`faceted-collection.ts:12-22`). `reindex` takes `{ force?: boolean }` and returns `{ reindexed, failed }` (`:92-101`).
52. Throws at definition on a parameterized pattern, `writable: false`, a client body create or update, an own `contentUpdated`, and the other cases at `faceted-collection.ts:233-309`.

**Four questions for `facets`:** owner = the collection's scope (same as the note); seen by = blocks that declare the collection and the browser if `client` exposes it (`client.content.create` and `.update` are refused, `:280-287`); stored = in the note's own state beside the app's fields (`:106-111`); count = one per note.

## Links

- C-08 (`../concepts/resources.md`): where a collection is defined and what `llmReadable` means on one line (`resp:120-124`).
- `reference/resources` (`../reference/resources.md`): scopes, `maxInstances`, owner-private, `secret`, the other tools' inputs.
- `./link-records.md`, `./react-to-a-change.md`: neighbours, not needed.

## Open questions and corrections for pass 3

- **Contradiction, ruled.** The sitemap says "mark fields searchable"; the code has no field-level mark (fact 1). Page title and step 1 say "mark the collection searchable".
- **Page incomplete in the existing source.** The `librarian` example omits `resources` (fact 3).
- **Facets** now have a page (fact 4, resolved): `find-by-facets.md`. It has no sitemap id yet.
- **Two claims left [verify]:** the action mounted without `inputSchema` (fact 13) and search over an owner-private collection (fact 38). Run `fsdev run` on the example before the page states either; otherwise soften.
- **Words to avoid** per `docs/contributing/glossary.mjs` terms: say "user", not "person"; "block", not "tool block" outside the model's tool list. Not rechecked against the glossary file here.

## Revise round 1: what the page states, and what it links instead

The page states facts 1, 2, 3, 7, 8, 12, 13, 15 (its example calls only), 18, 19, 22 (the uri carries the scope), 24, 26, 30, 32, 35, 37 and 40 to 41. It states facts 28 and 40 only as "your own `search` hook decides which rows come back", linking `./serve-your-own-data.md`. It does not state 38 (owner-private, **[verify]**).

Moved to `reference/resources` (R-08) and linked from the page: which search tool reaches a projected collection (28); result identity, `pattern` and `prefix` matching the within-scope path (22, 23); `globResources` options (16); the `llmReadable` gate applying to glob, grep and search, and collections skipped before they are read (8); `grepResourceContent` options, output and the regex fallback (17); `searchResources` options, output, `limit` default 10 and `cursor` (15, 25, 29); what the text tools match, rendered content (2); the grep limit, an unsandboxed pattern (27).

The three example calls on the page are illustrative shapes, not run output: the `uri`, `score` and `snippet` values are made up for the example. The shapes match facts 15 to 17. The unscoped `prefix: "ticketNotes"` and `pattern: "ticketNotes/T-10*"` follow fact 22.

Type-check **[ran]**: every `ts` block on this page and on `find-by-facets.md` compiles under `apps/kitchen-sink`'s `strict` tsconfig, written at its titled path.

## Revise round 3

The page now has a "Limits" section and states, besides the earlier facts: 26 (every call reads every body, a small curated set, named in the opening and in Limits), 43 (no meaning or synonyms, "charged twice" vs "duplicate payment" as the example), 28 (a projected collection is reached by search only, in the hook's order; glob and grep skip it) and 40 (the hook receives `userId` and `orgId` and scopes its own query, or a user sees in one organization what they saved in another). New statement from fact 26: an edited note is searched by its new text on the next call, because each call reads the current bodies (no index; `rt:289-296`, `rst:222`, `:268-279`). **[source]** not run.

## Revise round 2

Fact 3 and 30 sharpened: a flow-level declaration makes the collection searchable from a generator's tools (the registry holds what the flow declares, `ov:295`, `ov:360-364`); a block's declaration bubbles into the flow (`ov:360`). The page says so in step 2, step 3 and the closing line. **[source]** not run end to end.
