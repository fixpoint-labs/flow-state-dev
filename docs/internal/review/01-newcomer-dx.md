# Newcomer DX Review: flow-state.dev Public Documentation

**Reviewer perspective:** Senior engineer, never seen the framework before, reading the docs in the order the sidebar presents them. Goal: ship a streaming chat thing in an hour.

**Sources:** `apps/docs/docs/intro.md`, `apps/docs/docs/getting-started/*`, `apps/docs/docs/fundamentals/*`, `apps/docs/docs/sequencers/*`, `apps/docs/docs/streaming/*`, `apps/docs/docs/resources/*`, `apps/docs/docs/patterns/*`, `apps/docs/docs/client/*`. Sidebar order from `apps/docs/sidebars.ts`.

---

## 1. Time-to-Hello-World

To finish the Quick Start (`apps/docs/docs/getting-started/quick-start.md`) — a chat app that streams — a developer must hold the following concepts in working memory, in encounter order. I count by what the page assumes the reader can read without losing the plot.

1. **Block** — the universal unit of work. Introduced as "everything is a block" with no concrete definition before the code.
2. **The four block kinds** (`handler`, `generator`, `sequencer`, `router`) — encountered as imports on line 25 of quick-start before any are explained.
3. **`generator`** — config object with `name`, `model`, `prompt`, `inputSchema`, `history`, `user`. The `user` field is a function — not labeled as "the user-message extractor". Newcomer asks: what is `user`? Why a function?
4. **`handler`** — needs `inputSchema`, `outputSchema`, `sessionStateSchema`, `execute(input, ctx)`.
5. **`ctx`** — the block context. Introduced silently. `ctx.session.incState({ messageCount: 1 })` — the reader has to infer that `session` is a scope, that `incState` is one of five atomic operations, that this is CAS-guarded. None of that is on the page.
6. **`sessionStateSchema`** vs **state schema declared at the flow level** — both appear in the same file (the handler declares `sessionStateSchema`, then the flow declares `session.stateSchema`). The two-place declaration is unexplained on the page. The reader has to navigate to `state-and-scopes.md` to learn this is "state bubbling."
7. **`sequencer`** — chained DSL. `.then()` is the only method shown in the snippet, but the imports include `handler` and `sequencer` simultaneously, suggesting a fluent API; no explanation of why `name` and `inputSchema` go on the sequencer too.
8. **`defineFlow`** — top-level wrapper with `kind`, `requireUser`, `actions`, `session`. Five new sub-concepts in one config object.
9. **`actions`** map — each action has `inputSchema`, `block`, `userMessage`. `userMessage` is shown but not explained on the page.
10. **FlowType vs FlowInstance** — `defineFlow(...)` returns a factory; calling it with `{ id: "default" }` returns the instance you actually export. The Quick Start writes `export default chatFlow({ id: "default" })` with zero motivation.
11. **`createFlowRegistry`** — server-side registry.
12. **`createFlowApiRouter`** — Next.js-shaped catch-all router.
13. **SSE streaming with sequence-number resume** — mentioned, magical.
14. **`FlowProvider`** — React context provider; takes `flowKind`, `userId`.
15. **`useFlow`** with `autoCreateSession: true`.
16. **`useSession(flow.activeSessionId)`** — exposes `items`, `isStreaming`, `sendAction`.
17. **`item`** — the unit of stream output. `ItemRenderer` renders one. The reader has no idea what an item is until they reach the Streaming section.
18. **Zod schemas** (peer-dep assumption) — required throughout.
19. **Model presets** (`"preset/fast"`) — string literal with magic. Not explained until much later.

That's **roughly 19 concepts** before the chat app runs, and several of them (item, scope, agentType, transient) are **referenced but not defined**. A "first hour" reader who pastes the snippet and runs `pnpm dev` will likely get something working — but if anything misbehaves they cannot reason about why.

For comparison: the Vercel AI SDK quick start gets a streaming chat UI working with **two concepts** — `streamText` and `useChat`. Mastra: agent + tool. flow-state.dev's quick start front-loads almost the entire mental model.

---

## 2. Conceptual Entanglement

The docs continually introduce concept A while assuming concept B is already understood.

**Quick Start references "items" before the Items section.** `quick-start.md:119`: `{session.items.map((item) => (<ItemRenderer key={item.id} item={item} />))}`. The reader has no idea what an item is. Items aren't explained until the Streaming section — fifth in the sidebar.

**Generator `agentType` is silently optional in quick-start, but mandatory-feeling in `blocks.md`.** `blocks.md:67-72` has a table about where items "flow" — *Client UI, LLM History, DevTool* — and warns *"Set agentType explicitly on every generator that should stream."* But the quick-start generator has no `agentType`. So either the quick-start is broken or this rule is not actually a rule. Untangling that requires reading `streaming/items.md`.

**`flows.md` sends you to `actions.md`, `state-and-scopes.md`, and `Items` to understand its own example.** The example at `flows.md:16-50` declares `clientData`, `resources`, `userMessage`, lifecycle hooks, `requireUser` — none of which has been introduced. The fundamental assumption is: read all of fundamentals before any of it makes sense.

**`state-and-scopes.md` introduces five distinct scopes, then a sixth (sequencer scope) "different from the others"** at line 782. This is jarring. Now there are six conceptual scopes plus `targets` plus `getTarget`. The page itself signposts: *"Sequencer scope is orthogonal to this hierarchy"* — which is a polite way of saying "we couldn't find a clean model so we made an exception."

**Resources are introduced three times with three slightly different mental models.** In `intro.md:109` they're "a content body and structured metadata alongside it." In `state-and-scopes.md:167` they're "hybrid memory and filesystem." In `resources/overview.md:6` they're "files your AI can work with." The third mental model contradicts the first: resources are *not* general filesystems — they're scoped, schema-typed records.

**`capabilities.md` reverses every prior recommendation.** The Quick Start tells you to declare resources/state/tools per block. Capabilities then say: *"It works, but it doesn't scale cleanly... Drift is silent."* So the very pattern the Quick Start models is implicitly criticized in `fundamentals/capabilities.md:8-10`. A new developer is left wondering: when do I use the per-block style? When the capability style? The page eventually hedges with "Start concrete... Extract a capability when..." but the damage to the reader's confidence in the basic pattern is done.

**Overloaded vocabulary.**

- **"Action"** — used both for the flow's named entry-point (`actions: { chat: { ... } }`) and casually for "an action execution" (a request). Confusing when reading lifecycle hooks: `onCompleted: async (result, ctx)` — is that the *action* or a *request*?
- **"State"** — sometimes means scope state, sometimes resource state (resources have a `stateSchema` field), sometimes sequencer state. All five share the same operation names (`patchState`, `incState`).
- **"Block"** — kind (handler/generator/sequencer/router), instance, builder, and "anything callable" all share the word. The DSL uses `inner.connectInput(...)` which produces another block — but is it the same block or a new one?
- **"Context"** — at least three meanings: the runtime `ctx` arg; the `context` slot in a generator (prompt-building inputs); the context formatter functions. `apps/docs/docs/fundamentals/capabilities.md:109` casually mentions "preset context entries" without distinguishing which kind of context.
- **"Scope"** — request/session/user/org are scopes; sequencer is also a scope; capabilities have `presets` that *appear* to also be a kind of scope-of-config.

**Underspecified:**

- `requireUser: true` in quick-start. Why is this not the default given that `state-and-scopes.md:558-572` says `userId` is *always required*? A reader can't tell whether this flag is load-bearing.
- `model: "preset/fast"`. Where does this string come from? What other strings work? This isn't explained until `server/custom-model-resolver.md` deep in the sidebar.
- `agentType` defaults — `intro.md` doesn't mention it; `blocks.md:67` says "unset = no auto-emission". So a generator with no `agentType` produces nothing visible? Then how does the quick-start chat work? (Answer: `useFlow` and `ItemRenderer` somehow surface output even without a primary agent type — but that's contradicted by `blocks.md:67-72`. There is a real bug in the docs here, or the quick-start is relying on undocumented defaults.)

---

## 3. Cognitive Load — Walking the Quick Start

Stalling points, in order:

**At line 31 of quick-start (`generator(...)`):** I see `model: "preset/fast"`. Stall. What model is this? What if I want GPT-4? How do I add an API key? Nothing on the page.

**At line 36 (`history: true`):** This is doing something magical — assembling conversation history into the prompt. From where? The page says "the framework handles prompt assembly." For a senior engineer, this is the moment of suspicion: a black box that injects state into my LLM calls.

**At line 37 (`user: (input) => input.message`):** I now have `prompt` and `user` in the same config. Are these both prompts? Why is one a string and one a function? `blocks.md:56` later clarifies there are *four prompt slots: system prompt, context entries, conversation history, and user message*. None of this is on the quick-start page.

**At line 47 (`await ctx.session.incState({ messageCount: 1 });`):** Where did `ctx` come from? What is `session`? Is this synchronous or async-fire-and-forget? The promise suggests durable storage. Is it persisted? Where? — Yes, the framework persists it. To what backend? `server/setup.md` later mentions a SQLite store. None of that is on the quick-start.

**At line 49 (`return input;`):** This is **literally a violation of the project's own best-practice BP-014** ("Handlers must never return input as output"; see `CLAUDE.md`). The quick-start contradicts the rules the codebase enforces internally. A reader following best practices later will look back at this snippet as bad example code.

**At lines 53-55:** `sequencer(...).then(chatGen).then(counter)`. The reader infers that the generator's output is fed to the counter as input. But the generator's output type isn't declared in the snippet. What is `counter` going to receive? `blocks.md:155-160` says generators emit messages plus `block_output` if `outputSchema` is set. The quick-start has no `outputSchema`, so the type is... `string`? Inferred from where? This is the moment a careful reader realizes the type system is doing a lot of inference and they don't know its rules.

**At lines 58-71 (`defineFlow`):** Five new keys (`kind`, `requireUser`, `actions`, `session`, `inputSchema` redeclared on the action). The `userMessage: (input) => input.message` field is duplicated in spirit with the generator's `user: (input) => input.message`. Why both? `actions.md:38` later explains they do different things — the action's `userMessage` emits a user-role item before execution; the generator's `user` extracts the user message for the prompt. They are not the same. But you cannot infer this from the quick-start.

**At line 86 (`createFlowRegistry()` and `createFlowApiRouter`):** Magic. A reader has to take on faith that one route handler serves a complete REST API. This is fine for a tutorial — but the reader doesn't know what URLs work, what a `requestId` is, what state the server holds. `actions.md:64-67` shows the URL shapes much later.

**At line 113 (`useFlow({ autoCreateSession: true })`):** The reader has to assume the React package uses `fetch`, knows about session creation endpoints, handles SSE reconnect, etc. Convenient — but if I want to put this behind authentication, redirect through my own gateway, or use a non-Next.js framework, I have no idea what `useFlow` actually does under the hood. This is exactly the "opacity" that `intro.md:10` claims to reject.

**Leaky abstraction:** `intro.md:8-12` makes the case that other frameworks become opaque under pressure. The quick-start then proceeds to hide *more* magic than the typical Vercel AI SDK example — three layers of abstraction (block → flow → React hook), each with implicit defaults, in a five-minute tutorial. The promise and the surface delivery don't match.

---

## 4. Vocabulary Bloat

Concepts the docs require the user to internalize:

| Concept | Essential? | Could collapse into… |
|---|---|---|
| Block | Yes | — |
| Handler | Yes | — |
| Generator | Yes | — |
| Sequencer | Yes | — |
| Router | Maybe | could be a sequencer method (`.branch()` already exists) |
| Flow | Yes | — |
| Action | Yes | could be an HTTP route definition |
| FlowType vs FlowInstance | **No** | invented ceremony; one-arity factory is rarely needed |
| Request scope | Yes | — |
| Session scope | Yes | — |
| User scope | Yes | — |
| Project/Org scope | Yes | — |
| Sequencer scope | **Maybe** | "request" already serves this purpose for most cases |
| Target / `targetStateSchemas` / `getTarget` | **No** | leaks topology into block code; could be a connector |
| `ctx.parent` / `parentInputSchema` | **No** | overlapping with targets |
| Item | Yes | — |
| Item type (14 of them) | Partially | many are internal observability — hide from public docs |
| Content (vs item) | Yes | — |
| `agentType` (primary/sub/trace/unset) | Maybe | could be a single boolean `visible` or a `to: "user" | "trace"` |
| `agentName` | **No** | duplicates `name` for an unclear payoff |
| Resource | Yes | — |
| Resource collection | Yes | — |
| `defineResource` | Yes | — |
| Client data | Yes (security boundary) | could be called "projection" — `clientData` reads as "data on the client" but it's a server-side function |
| Capability | **Maybe** | a syntactic sugar over `uses` arrays; teaches a fifth primitive |
| `ctx.cap.<name>` | Tied to capability — | — |
| Preset (on capability) | **No** | sub-concept of capability; presets-of-presets is too many levels |
| Utility block | Maybe | really just "blocks we already wrote for you" |
| Composable pattern | Maybe | really just "sequencers we already wrote for you" |
| Connector | Yes | — |
| `connectInput` / `connectOutput` (block-level) | **Maybe** | duplicates sequencer-level connectors |
| State bubbling | Yes (mechanism) | — |
| Resource bubbling | Yes | — |
| Lifecycle hooks (action and request) | Yes | — |
| Sequencer DSL methods (15+) | **Bloated** | `then`, `parallel`, `forEach`, `doUntil`, `loopBack`, `work`, `waitForWork`, `branch`, `rescue`, `tap`, `tapIf`, `thenIf`, `thenAll`, `thenAny`, `race`, `exitIf`, `workIf`, `forEachBackground`, `map`, `connectInput`, `connectOutput`, inline factories — most users won't need 80% of these |
| Tools (= blocks-as-tools) | Yes | — |
| Provider tools / `providerTools` | Yes | — |
| `agentType: "trace"` (devtool only) | **No** | observability concern bleeding into block config |
| `transient` | Maybe | — |
| Scope identity | Maybe | — |
| Skills | **Probably no** | not yet examined; smells like another abstraction layer |
| Voice | **Probably no** | a `voice.md` page in fundamentals is suspicious |

**Net assessment:** The framework has roughly **40 named concepts** the user must navigate. Vercel AI SDK has ~6. Mastra ~10. Inngest ~12 for the equivalent surface. LangChain has more, and is widely criticized for it. flow-state.dev is in LangChain territory for vocabulary. The "four primitives" framing is true but misleading — it's four primitives plus 36 supporting concepts.

**Concepts that feel invented to justify the framework rather than to serve a real need:**

1. **FlowType vs FlowInstance** — I have not seen a use of multiple instances of one flow type in any of the examples. The doc says "lets you create multiple instances if needed" — when?
2. **Sequencer scope** — Almost everything you can do with sequencer state, you could do by passing data through the type chain. The DSL even has typed outputs already. This is a workaround for the fact that nested deep blocks can't easily talk to a parent's typed payload.
3. **`targetStateSchemas` plus `ctx.parent` plus `ctx.getTarget`** — three overlapping ways to do the same thing: read a parent's state. Pick one.
4. **Capability presets** — solves a real problem (drift) but introduces "sub-namespaces of bundles of bundles." The default-array-of-preset-names structure is hard to explain.
5. **`agentName` distinct from `name`** — exists for a single use case (parallel-shared-identity workers). This belongs in the patterns layer, not in the block primitive.

---

## 5. Comparison to Alternatives

**Vercel AI SDK.** The SDK is laser-focused: streaming, tool loops, structured output, provider abstraction. It has no opinion on state, no opinion on session management, no opinion on how to compose multi-step work. flow-state.dev's value-add over the SDK: composable state, durable sessions, resumable streams, the sequencer DSL, server endpoints. Genuine value: composition + durable session + resume. The framework's own internals use the AI SDK as the generator backend, which is the right call.

Where it adds **ceremony, not value**, vs. the SDK: declaring `inputSchema` *and* `outputSchema` on every block when you're just chaining one generator and one handler. The AI SDK lets you write `streamText({ ... })`, hand a `result.toDataStreamResponse()` to Next.js, done. flow-state.dev requires you to think about block kinds, action wrappers, registries, and routers for a one-step chat.

**Mastra.** Mastra built around `Agent`, `Tool`, `Workflow`. Three concepts. They aim at the same agent + tool + multi-step problem space. Mastra's workflow API is also block-like but with fewer chainable methods. flow-state.dev's sequencer DSL is more expressive (background work, side chains, named loops, conditional taps), and that expressiveness is a real differentiator if you actually need it. Most users will not on day one. **Mastra wins on time-to-first-thing.** flow-state.dev wins on long-tail flexibility.

**Inngest.** Inngest is a durable execution platform: function steps, retries, sleeps, fan-out. It's ergonomically tight because it's purpose-built for long-running workflows with external triggers. flow-state.dev *isn't* a durable execution platform — sessions are persistent but block execution itself is in-process. The overlap is the workflow/composition surface. Inngest's `step.run`, `step.invoke`, `step.parallel` are clearer than flow-state.dev's `.then`, `.parallel`, `.work`. The conceptual cost of `work + waitForWork + workIf + forEachBackground` is high.

**LangChain.** Vocabulary bloat to the point where the runtime itself was rewritten (LCEL, then LangGraph). flow-state.dev is on a similar trajectory: a clean primitive set (the four blocks) plus an accreting layer of helpers, presets, capabilities, utility blocks, patterns, skills, voices. The cautionary tale is real — once the layer-stack gets above three deep, users can't tell which one to use.

**Where flow-state.dev is uniquely valuable:** the items model + SSE-with-resume + clientData projection is genuinely novel and well-designed. The state-bubbling-from-blocks pattern (each block declares its slice; flow merges) is the most elegant idea in the framework. The four-primitives framing is correct in spirit; the issue is that the surrounding scaffolding has grown to overwhelm it.

---

## 6. Top 10 Worst Friction Points

1. **Quick-start violates project's own best-practices.** `getting-started/quick-start.md:46-50`:
   > ```
   > execute: async (input, ctx) => {
   >   await ctx.session.incState({ messageCount: 1 });
   >   return input;
   > },
   > ```
   `CLAUDE.md` declares **BP-014: Handlers must never return input as output**. The first handler a new developer sees does exactly this. Either the rule is wrong or the example is wrong. Either way, it is the worst possible first impression.

2. **`agentType` contradiction between quick-start and `blocks.md`.** `blocks.md:72`:
   > "Set `agentType` explicitly on every generator that should stream. There is no position-inferred default — each generator's identity is visible in its own config."
   The quick-start generator has no `agentType`. By the rule, it shouldn't stream. But the example claims to produce a streaming chat. This is a real documentation bug; the new developer will hit it as soon as they alter the example.

3. **`intro.md` contains a dead heading and unfinished sentence.** `intro.md:14-18`:
   > "## Four primitives
   > Every piece of logic in a flow-state.dev application is one of exactly four block kinds:
   > ## What it looks like"
   The "Four primitives" heading has no content under it. Section breaks are immediately followed by the next heading. This is the literal first page of the docs.

4. **No visible model configuration in quick-start.** `quick-start.md:34`: `model: "preset/fast"`. The reader cannot run the code without a provider key, but the docs do not say where to set one. The model resolver setup (`server/custom-model-resolver.md`) is buried 11 sections later in the sidebar. The first-hour developer will see "model not found" and not know why.

5. **`flows.md` example uses every concept simultaneously.** `flows.md:16-50` includes `requireUser`, `actions`, `session.stateSchema`, `session.resources`, `session.clientData`, `user.stateSchema`, lifecycle hooks. None defined yet. The page is supposed to be the introduction to flows. It is a reference page disguised as an intro.

6. **`state-and-scopes.md` is 1077 lines.** A single doc page covering scopes, operations, target state, sequencer state, scope identity, journal, metadata, items, resource scoping. It is the longest doc in the project. This is a structural failure: the page does not let you stop reading at "I understand the basics." There is no clean break between fundamental and advanced.

7. **`capabilities.md` opens by criticizing the previous lessons.** `fundamentals/capabilities.md:8-10`:
   > "Blocks declare their dependencies individually... It works, but it doesn't scale cleanly... Drift is silent."
   A new developer who just learned per-block declarations is now told the pattern doesn't scale. The fix introduces capabilities, which introduce presets, which introduce parameterized capabilities. The sidebar puts capabilities *before* utility blocks and patterns, so the reader meets the most abstract layer before the concrete ones.

8. **Sequencer DSL with 22 methods.** `sequencers/overview.md:62-83` lists 22 methods (`then`, `thenIf`, `map`, `parallel`, `thenAll`, `thenAny`, `race`, `exitIf`, `forEach`, `forEachBackground`, `doUntil`, `doWhile`, `loopBack`, `work`, `background`, `workIf`, `waitForWork`, `tap`, `tapIf`, `rescue`, `branch`, inline factories). The page presents them all. There is no "you only need three of these for 90% of cases" guidance.

9. **`utility-blocks.md` redirects to a different page.** `apps/docs/docs/fundamentals/utility-blocks.md:7-9` opens with:
   > "This reference has moved to the **Patterns section**. The content below is kept for continuity..."
   A new developer reading the sidebar in order trips on a deprecated page. If the content moved, the page should be deleted from the sidebar.

10. **`useSession` in quick-start hands you `session.items` without explaining items.** `quick-start.md:119`:
    > `{session.items.map((item) => (<ItemRenderer key={item.id} item={item} />))}`
    The `streaming/overview.md:118-135` table lists 14 item types. The reader following the quick-start has no signal of which they'll see, what shape they have, or how `ItemRenderer` decides what to render. The component is given as a black box. This is the cleanest example of the abstraction the docs explicitly promised they wouldn't build.

---

## 7. Top 10 Simplification Opportunities (impact-to-effort)

1. **Cut the `outputSchema`/`inputSchema` requirement on toy handlers.** Let the sequencer infer types. Two pieces of ceremony per block, gone. Massive impact on quick-start density. (Low-effort if the type system can already handle it; the test is whether the sequencer's chained inference works without explicit schemas.)

2. **Delete the FlowType vs FlowInstance distinction.** `defineFlow({ ... })` should return the registerable thing directly. The `({ id: "default" })` factory call serves no documented use case. (Trivial code change; meaningful docs simplification.)

3. **Make "items" the first concept the user meets.** Move `streaming/overview.md` ahead of fundamentals. The chat app's mental model is "messages stream and accumulate." Lead with that, then introduce the blocks that produce them.

4. **Replace `agentType` with a boolean `visible: true` and a `trace: true` for observability.** The current four-state taxonomy (primary/sub/trace/unset) is overengineered for what is, in practice, "does this stream to the user, does this go in history." Most users will never need `sub` vs `primary` in their first month. (Higher-effort because it touches identity propagation, but high docs payoff.)

5. **Collapse `targetStateSchemas`, `ctx.parent`, and `ctx.getTarget`** into a single mechanism. Pick `ctx.targets.<name>` (typed) and delete the others. The current three-API surface is a textbook case of a feature that should never have shipped in three flavors.

6. **Hide capabilities from the fundamentals sidebar.** They are an optimization for shared config across many blocks. Move the page to a "Patterns" or "Architecture" section. The fundamentals path should be: blocks → flows → state → items → done.

7. **Trim the sequencer DSL to a published "core seven."** `then`, `parallel`, `forEach`, `branch`, `work`, `tap`, `rescue`. Deprecate or move to "Advanced": `loopBack`, `doUntil`, `doWhile`, `thenAny`, `race`, `exitIf`, `workIf`, `forEachBackground`, `tapIf`, `thenIf`, `tapIf` — most of these are conditionals that could be replaced with `.then((x) => cond ? x : ...)` in user code.

8. **Delete `utility-blocks.md` from `fundamentals/`.** It's marked as moved. Leaving it in the sidebar is misleading. Effort: one line removed from `sidebars.ts` and the file deleted.

9. **One-paragraph "what is a model preset" callout in quick-start.** Unblocks the "I can't actually run this" problem in five lines of text. Link to the model resolver page. Add the literal `OPENAI_API_KEY` env var instruction. This is the cheapest, highest-impact change in the whole docset.

10. **Rewrite `state-and-scopes.md` as four pages.** Scopes overview (300 lines max), state operations, resources, advanced (targets/sequencer-state). Currently the single 1077-line page actively suppresses learning because the table of contents alone is too long.

---

## Verdict

A smart engineer who follows the quick-start verbatim will get a streaming chat working in their first hour — provided they already have a model provider configured and don't read too carefully. The framework's bones are sound: the four-primitive framing is honest, the items + SSE + clientData design is genuinely good, the state-bubbling pattern is elegant. There is a real, high-quality system underneath this documentation.

But the docs themselves are pulling against the framework. The same engineer, asked an hour later "what does `agentType` do, and why doesn't your example need it?" or "what's the difference between `userMessage` on the action and `user` on the generator?" or "when should I use a capability vs declare resources per block?" will not be able to answer from the docs — and will have read three thousand lines trying. The framework markets four primitives and then ships forty supporting concepts. The first impression promises clarity ("nothing is a black box") and then delivers `useFlow({ autoCreateSession: true })` followed by a generator with no `agentType` that somehow streams. The gap between the pitch and the surface that touches the user is the central problem. Until the docs aggressively prune vocabulary, defer advanced concepts, and stop using the quick-start as a kitchen-sink demo, the framework will read to a senior engineer as another LangChain — capable, but not worth the cost of internalizing. The *fix* is mostly editorial; the underlying framework deserves a far better introduction than it currently has.
