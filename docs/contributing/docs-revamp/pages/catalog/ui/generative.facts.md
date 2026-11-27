# Fact sheet: Generative UI (K-41, `catalog/ui/generative`)

Sources cited: the existing page `apps/docs/docs/ui/generative.md` (EP), `packages/ui` source and
tests, `packages/react` source, `packages/contracts` source, `packages/ui/README.md`,
`apps/docs/docs/streaming/emitting-items.md` (existing user doc). Paths below are relative to the
repo root. No spec, changeset or internal doc is cited.

## What it is

1. The pack is two shapes, `info-card` and `link-card`. Each is a Zod schema, a React renderer and an
   `emit*` tool block. EP:7-13; `packages/ui/src/generative/tools.ts:23-26`,
   `packages/ui/src/generative/renderers.ts:26-29`.
2. The same Zod object is the tool's `inputSchema` and the renderer's data contract.
   `packages/ui/src/generative/info-card/schema.ts:1-4`; `info-card/tool.ts:25`; renderer reads
   `item.value as InfoCardData`, a type-only import: `info-card/renderer.tsx:9-13`.
3. The model picks the shape by calling the tool: the generator "picks the rendering shape".
   EP:15. Tool `description` is what the model sees, `USE FOR` / `DO NOT USE FOR` template:
   `info-card/tool.ts:12-16`; `link-card/tool.ts:11-15`; test asserts both phrases:
   `packages/ui/test/generative/info-card.test.ts:19-20`.

## The two things that travel together (question 1)

4. One shape is a tool and a renderer, linked by one string, the shape's name, which is the emitted item's `dataType` (`"info-card"`).
   Tool side: `GenerativeTool.name` "matches the renderer's `name`" `tool-types.ts:25`; renderer side:
   `GenerativeRenderer.name` "matches the tool's `name`" `renderer-types.ts:13-14`.
5. Tool block names differ from shape names: block `emitInfoCard` emits a data item with `dataType` `info-card`;
   block `emitLinkCard` emits `link-card`. `info-card/tool.ts:23,27`; `link-card/tool.ts:22,26`;
   `packages/ui/test/generative/aggregator.test.ts:10-13`.
6. What the tool does when the model calls it: `ctx.emit.data(name, input, { key })`, then
   returns `{ rendered: true, kind: "info-card", id }` (link card: `{ rendered: true, kind:
   "link-card", url }`). `info-card/tool.ts:26-29`; `link-card/tool.ts:25-28`; test
   `info-card.test.ts:23-46`. The return value is what the model sees as the tool result (the
   handler's return); not otherwise verified.
7. The emitted item is a data item: type `data`, with `dataType` (the name), `value` and optional `key`.
   `packages/contracts/src/items/types.ts:506-523`.
8. On the page, `FlowProvider`'s `renderers.data` map is looked up by `item.dataType`; the
   matching React component is rendered with `{ item }`. `packages/react/src/registry/block-renderers.ts:53-58,83-85`;
   `packages/react/src/components/ItemRenderer.ts:244-261`.
9. A data item with no registered renderer renders nothing; it never reaches the JSON dev fallback.
   `ItemRenderer.ts:263-267`. A renderer entry set to `false` also renders nothing.
   `ItemRenderer.ts:253-256`; `block-renderers.ts:58`.

## Set it up (question: the starter pack on a generator, the renderers on a page)

10. Imports: `generativeTools` from `@flow-state-dev/ui/generative/tools`; `generativeRenderers` from
    `@flow-state-dev/ui/generative/renderers`. `packages/ui/package.json:5-14`.
11. `generativeTools()` returns `BlockDefinition[]`, one handler block per shape, spread into a
    generator's `tools`. `tools.ts:28-42`; test `aggregator.test.ts:6-14`. Page example:
    `tools: generativeTools()` (the page example no longer adds an app tool of its own; EP:44-53 had `webSearch`).
12. `generativeRenderers()` returns `Record<string, ComponentType<{ item: DataItem }>>`, passed
    as `renderers={{ data: generativeRenderers() }}`. `renderers.ts:10-12,31-49`; test
    `aggregator.test.ts:29-34`.
13. `FlowProvider` props used in the existing example: `flowKind`, `userId`, `renderers`. EP:60-66.
    (Prop names are copied from the existing page; the page example is not type-checked here. Verify
    against `packages/react` when drafting.)
14. The generator in EP sets `itemVisibility: { client: true, history: true }`. EP:50. Not verified
    against the generator type in this pass. Flag: confirm before the page states it, or leave the
    line out of the example.
15. The default renderers use plain Tailwind classes, no shadcn dependency.
    `info-card/renderer.tsx:4-8`; EP:116.

## Pick a tighter set (question 2)

16. `generativeTools.pick(...names)` and `generativeRenderers.pick(...names)` take shape names
    (`"info-card"`, `"link-card"`), not block names. `tools.ts:40-41`; `renderers.ts:47-48`.
17. Unknown names are ignored, no error. Tests: `aggregator.test.ts:22-26,41-45`.
18. The two surfaces are picked separately, nothing links them; a name picked on the tool side with
    no renderer draws nothing (fact 9). Follows from `tools.ts` and `renderers.ts`
    each filtering its own list.
19. Fewer tools means better selection on smaller models. `tools.ts:13-14` (doc comment), EP:73.
    A claim about model behaviour; the only source is the doc comment.
20. The pack contains exactly two tools today; `generativeTools()` has length 2. `aggregator.test.ts:8`.
    Tool descriptions refer to `emitDualColumn` and `emitMetricGrid`, which do not exist in the pack
    (`info-card/tool.ts:15`; `link-card/tool.ts:14`; only two entries in `tools.ts:23-26`). A page
    must not name them as available.
    `renderers.ts:16-18` lists map-view, itinerary, dual-column, metric-grid, choice-list as
    future shapes. Not a page fact.

## The shapes

21. `info-card` data: `id` (string, min 1), `title` (min 1), `subtitle?`, `imageUrl?` (URL),
    `facts` (array of `{ label, value }`, each min 1, **max 8**), `footer?`.
    `info-card/schema.ts:7-34`. Note `facts` is required (may be empty): not marked optional.
22. More than 8 facts is rejected by `inputSchema` validation; the tool run throws.
    Test `info-card.test.ts:64-78`.
23. `link-card` data: `url` (absolute URL), `title` (min 1), `description?`, `siteName?`, `imageUrl?`
    (URL), `favicon?` (URL). `link-card/schema.ts:7-28`.
24. Default keys: info card by `id`; link card by `url`. `info-card/tool.ts:21`; `link-card/tool.ts:20`;
    test `info-card.test.ts:23-46`.
25. A `.describe()` string on a schema field is part of what the model reads. `info-card/schema.ts:8-33`
    (strings written as model instructions, e.g. "Skip when no image is genuinely useful"). EP:149
    says `.describe()` strings flow into the tool schema; no test in `packages/ui` asserts it.

## Re-emitting with the same key

26. Emitting a data item with the same `key` replaces the earlier one on the client; the live
    stream sees each state; the persisted record keeps one entry per `(requestId, key)`, `value`
    replaced, not merged. `packages/contracts/src/items/types.ts:510-522`;
    `packages/core/src/types/block.ts:518-521`.
27. `ctx.emit.data(dataType, value, options?)` options: `key`, `itemVisibility`, `agentName`,
    `transient`. Default is persisted (`transient: false`). `packages/core/src/types/block.ts:143-155,508-527`.
28. `keyFrom` option on a tool factory replaces the default key:
    `emitInfoCardTool({ keyFrom: (i) => \`card:${i.title}\` })`. `tool-types.ts:15-21`; test
    `info-card.test.ts:48-62`. `keyFrom` is the only option on a pack tool factory (the interface
    says "keep this minimal"). `tool-types.ts:12-14`.
29. `emitInfoCardTool`, `emitLinkCardTool`, `InfoCardSchema`, `LinkCardSchema`, `InfoCardData`,
    `LinkCardData`, `GenerativeTool`, `GenerativeToolOptions` are exported from the tools entry
    `tools.ts:44-48`. `InfoCardRenderer`, `LinkCardRenderer`, `GenerativeRenderer` from the renderers
    entry `renderers.ts:51-53`; `RendererRegistry` type `renderers.ts:32`.

## Your own shapes (question 3: where your own renderer goes)

30. Your renderer is a React component that takes `{ item }` (a `DataItem`) and reads `item.value`.
    `renderer-types.ts:15-20`; `info-card/renderer.tsx:12-13`.
31. It goes in `renderers.data` on `FlowProvider`, under the shape's name, which must equal the
    first argument your tool passes to `ctx.emit.data`. `block-renderers.ts:53-58,83-85`.
32. Overriding a pack renderer: spread `generativeRenderers()` and set the entry:
    `data: { ...generativeRenderers(), "info-card": InfoCardRenderer }`. `renderers.ts:31-49` (EP's
    example omits `flowKind`/`userId`/children; the page should show a full element).
33. `fsdev ui add info-card` (and `link-card`) copies a renderer into the app at
    `components/flow-state/generative/info-card.tsx`, which the user then owns. `packages/ui/registry.json:626-638,641-651`;
    `packages/ui/README.md:5,13`. The page's import alias `@/components/flow-state/generative/info-card`
    matches that target (alias `@/` is the app's own tsconfig, not verified).
34. The copied file defines its own local `InfoCardData` interface and imports `DataItem` from
    `@flow-state-dev/core/items`; it does not import the schema.
    `packages/ui/registry/components/generative/info-card.tsx:12-24`.
35. Your own tool: a `handler` block whose `inputSchema` is a Zod object and whose `execute` calls
    `ctx.emit.data(name, input, { key })`. Pattern copied from `info-card/tool.ts:22-30`
    (`handler` from `@flow-state-dev/core`, `BlockDefinition` type from
    `@flow-state-dev/core/types`). Pass it in a generator's `tools` with the pack's tools:
    `tools: [...generativeTools(), myTool]` (same shape as fact 11). A custom tool is not
    registered anywhere else; the pair is linked only by the name (fact 4).
36. The pack's renderer surface must stay free of value imports of `@flow-state-dev/core` and `zod`;
    a test walks the module graph. Applies to the pack's own files, not to a user's renderer.
    `packages/ui/test/generative/renderer-surface.test.ts:75-105`. Reference-row material (the
    server/browser split and why): the reader's takeaway is "import tools on the server, renderers in
    the browser" (EP:19-24).
37. `packages/ui` declares `react ^19` as a peer dependency. `packages/ui/package.json:28-30`.

## Stored parts: the four questions

The page's one stored part is the emitted data item.

| Question | Answer | Source |
| --- | --- | --- |
| Who owns it | The run (request) that emitted it: the item carries `requestId`; keyed items are unique per `(requestId, key)` | `contracts/src/items/types.ts:29-57,512-522` |
| Who can see it | Whoever can read the session's items. With no `itemVisibility` on the emit, a data item reaches the client and not model history; an enclosing generator's visibility is not inherited | `core/src/types/block.ts:143-155,514-516` |
| Where stored | The session's item log, as a persisted item (default `transient: false`); a `transient: true` emit is streamed only and not replayed on reload. Which store holds it is the app's store choice (not this page) | `contracts/src/items/types.ts:37-44`; `block.ts:153-154` |
| How many | One per emit without a key; one per `(requestId, key)` with a key, latest `value` wins. A turn can hold many cards: an info card per `id`, a link card per `url` | `contracts/src/items/types.ts:512-522`; facts 24, 26 |

The renderers store nothing. The copied registry renderer is a file in the user's app (fact 33),
owned by the user, one copy per `fsdev ui add`.

## Figure: From tool call to component

F1. Model's call: the model calls `emitInfoCard` with input matching `InfoCardSchema` (fact 3, 6).
F2. `EMITS`: the handler runs `ctx.emit.data("info-card", input, { key: input.id })` (fact 6).
F3. The item: `type: "data"`, `dataType: "info-card"`, `value`, `key` (fact 7).
F4. `RENDERS`: `renderers.data["info-card"]` receives `{ item }` (fact 8).
F5. Dashed outline on the run: the tool call and the emit happen within one run (the item's
    `requestId`, fact in stored-parts table). The item itself persists (default not transient).
    Hatching, per the figure standard, would mark the persisted item; the planned marks only
    list the dashed outline, so decide in the figure brief.

## Not on the page (cut, or Reference)

- Existing "Migration" blockquote about `generativeUI` (EP:36): diff narrative; cut. Not a fact.
- Existing "browser-light / guard test" paragraph (EP:24): mechanism; the usable guarantee is fact 36.
- "A tool can be a sequencer" and "`.sideChain()` re-emits with the same key" (EP:38, 145): no test or
  example in `packages/ui` or elsewhere cited here exercises this. Unverified: do not state until
  checked against core's sequencer and side-chain docs and tests.
- "Phase 1 ships two shapes. More are on the way." (EP:87): the second sentence is a promise; cut.
  The first is diff narrative ("Phase 1"); say "the pack has two shapes".
- Tool description template block (EP:94-100): the template is observed in the source (facts 3);
  for a user writing their own tool it is advice, not behaviour. Keep to one sentence if used.
- Authoring-guidance bullet that `.describe()` text could be "hijacked by malicious user input"
  (EP:149): a security opinion with no test; leave out or verify.

## Stale or contradictory items found in sources

- `packages/ui/registry.json:630,644` descriptions say "from @flow-state-dev/ui/generative"; the
  real import paths are `.../generative/tools` and `.../generative/renderers` (`package.json:5-14`).
  The registry text is the one at fault. Not a page fact.
- Tool descriptions name `emitDualColumn` and `emitMetricGrid`, tools that do not exist (fact 20).
  A model reading them is told to prefer tools it does not have.
- EP uses `generator({...})` with `prompt: TRIP_CONCIERGE_PROMPT` and `webSearch`, both undeclared.
  A draft needs declared or imported names, and file titles per the example rules (the app's layout
  puts a generator in `src/flows/<flow>/blocks/<block>.ts`).
- EP's `FlowProvider` examples carry `ChatUI` and `userId` free; the draft needs a component with
  `userId` as a parameter.

## Revise round 1 (pass 8)

- Key scope: keys dedupe within one request only; the same `id`/`url` in another request is a
  separate card; keyless items are always shown. `packages/react/src/components/ItemRenderer*`
  / `ItemsRenderer.ts:103-105`; `contracts/src/items/types.ts:498-508`. Page now says so.
- The page keeps "a tool can be a sequencer" and "a side chain re-emits the same key" as capability
  statements; fact 26 covers the re-emit replacing data. Sequencer and `.sideChain()` use inside a
  tool is not exercised by a `packages/ui` test (still unverified there).
- The page's generator example uses `model`, `itemVisibility`, `prompt`, `tools`, the same fields
  as `apps/kitchen-sink/flows/rich-text-component/generators.ts:39-47`; `FlowProvider` takes
  `flowKind`, `userId`, `renderers`, `children` (`packages/react/src/context/FlowContext.ts:21-45`).
- Schema fields, tool-description template, `pick` details and the item shape moved to the
  Reference page (`../reference/ui-components.md`); the Migration note is cut.

## Revise round 2 (pass 8)

- Page example uses `tools: generativeTools()` only, so it type-checks without an app-owned `webSearch`. `fsdev ui add info-card` writes `components/flow-state/generative/info-card.tsx` exporting `InfoCardRenderer` (fact 33; `packages/ui/registry/components/generative/info-card.tsx`); the override example's import depends on that file.
- `.pick("link-card")` used on both sides so the example shows a narrowed set (pack has two shapes, fact 20).

## Revise round 3 (pass 8)

- Page now states: more than 8 facts throws and emits no card (facts 21, 22); a repeat call with the same key replaces, not merges, leaving one card (facts 24, 26); `keyFrom` on `emitInfoCardTool` changes the key (fact 28; `info-card.test.ts:48-62`). Example uses `emitInfoCardTool` from the tools entry (fact 29). The only test for this is `info-card.test.ts:64-78` (throws).
