# Facts for Add to an existing app (S-5, start)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests, `goals/`, and one example. No spec, changeset, `docs/internal/` file or commit message is cited. The page plan's Sources line names `getting-started/existing-project` and `guides/nextjs-setup`; both are existing user docs and are cited below. Nothing here was run; behaviour is cited to tests and doc comments.

Paths are from the repo root. Abbreviations:

- `eng` = `packages/engine/src`, `engT` = `packages/engine/test`
- `core` = `packages/core/src`, `coreT` = `packages/core/test`
- `react` = `packages/react/src`
- `cli` = `packages/client/src`
- `nextP` = `packages/next` (`nextP/src/createNextHandler.ts`, `nextP/test/createNextHandler.test.ts`)
- `node` = `packages/node/src`
- `hc` = `examples/hello-chat` (the one example that uses these pieces end to end)
- `ep` = `apps/docs/docs/getting-started/existing-project.md`
- `ns` = `apps/docs/guides/nextjs-setup.md`
- `cfg` = `apps/docs/docs/cli/configuration.md`
- `clientDoc` = `apps/docs/docs/configuration/client.md`
- `models` = `apps/docs/docs/getting-started/setting-up-models.md`
- `ha` = `apps/docs/docs/server/host-adapters.md`
- `vercelDoc` = `apps/docs/guides/deploying-to-vercel.md`

Legend: **[page]** the page states it. **[ref]** it belongs on a Reference page; the page links, does not state it. **[old wrong]** an existing page says it and the code says otherwise; do not copy. **[flag]** a contradiction or gap in the sitemap entry for the caller to settle.

The page's cast: one flow `support` with one action `reply` (the cast of the Concepts pages), added to an app that already has a Next.js App Router layout. The code does not name them; they are the page's choice. The page's four answers are in section 9.

## 1. The reader and the setup

- Host: Next.js App Router, 15 or later; or a plain Node project. `ep:11`, `ep:88`; `ns:14`; `nextP/package.json` peer dependency `"next": ">=15.0.0"`; `nextP/src/createNextHandler.ts:2-12` (awaits Next 15's async `params`). [page]
- Node 22 or later. `ns:15`; `packages/next/package.json` and `packages/node/package.json` `engines.node: ">=22"`. [page] [flag] `ep:87` says 22.18 for the CLI's TypeScript config loading ("native type stripping"); `ns:15` and the packages say 22. The page needs `fsdev.config.ts` only if it shows `fsdev run` (section 8). If it does, say 22.18; otherwise say 22.
- There is no `fsdev init`. `ep:11`. [flag] A coding-assistant install path (`install-fsd` skill) is on `ep:13-23`. The sitemap sends the integrator to the by-hand path; this sheet covers only the by-hand path. Whether to mention the assistant is the caller's call.
- Pages Router is not supported by `@flow-state-dev/next` (the adapter is App Router route handlers). `ep:19` ("a Pages Router app" is a stop condition); `nextP/src/createNextHandler.ts:1-10`. [page, one clause]

## 2. Install the packages

- The runtime set for a Next.js app: `@flow-state-dev/core`, `@flow-state-dev/engine`, `@flow-state-dev/next`, `@flow-state-dev/react`, `zod`, and the `@ai-sdk/*` package for the model provider. `ns:25`, `ns:33`; `ep:94`; `hc/package.json` dependencies list `@ai-sdk/openai`, `core`, `react`, `engine`, `next`, `zod`, `client`. [page]
- `@flow-state-dev/react` depends on `@flow-state-dev/client`, so installing `react` installs `client`; listing both is optional. `packages/react/package.json` `dependencies` (`@flow-state-dev/client`, `contracts`, `core`); `ns:28`. [page: one clause, or leave `client` out of the command]
- `@flow-state-dev/next` depends on `@flow-state-dev/engine`. `packages/next/package.json` `dependencies`. [ref]
- `zod` is a dependency of `@flow-state-dev/core` (`^3.25.76`), and the example lists it too because its flows import `z` directly. `packages/core/package.json` `dependencies`; `hc/package.json`. [old wrong] `ns:28` calls `zod` a "peer dependency". The page installs it because its own code imports it; it does not call it a peer.
- The provider package is needed for the model strings to resolve. Provider table: OpenAI `@ai-sdk/openai` + `OPENAI_API_KEY`; Anthropic `@ai-sdk/anthropic` + `ANTHROPIC_API_KEY`; Google `@ai-sdk/google` + `GOOGLE_GENERATIVE_AI_API_KEY`. `models:13-19`; `core/models/providerDetection.ts:8-12` (`PROVIDER_ENV_VARS`); `core/models/createModelResolver.ts:125-129` (`PROVIDER_PACKAGES`). [page: one provider, OpenAI, and the other two in one clause; the table is `models`]
- With `models` omitted, `createFlowState` detects providers from those environment variables; no `models` config is needed to use `"openai/gpt-6-luna"` once `OPENAI_API_KEY` is set and `@ai-sdk/openai` is installed. `hc/fsdev.config.ts:7-11` (file comment); `eng/flowstate/types.ts:154-156` (`models` doc: "Auto-wires AI Gateway via `AI_GATEWAY_API_KEY`"); `core/models/providerDetection.ts:46-52`. [page]
- The key goes in `.env.local`, never committed. `ns:205`; `ep:253`. [page, one clause]
- `fsdev` CLI is a dev dependency: `@flow-state-dev/fsdev`. `ep:96`; `ns:40`. [page only if section 8 is kept]
- pnpm 10 builds a native module (`better-sqlite3`) only when allowed; `ns:40-43` says to add `--allow-build=better-sqlite3` to the dev install of `fsdev`. [flag] The page installs no store package, so this applies only if `@flow-state-dev/fsdev` is installed. `ns:43` ("The CLI's default store is SQLite") describes `fsdev`'s no-config store; this page's config names no store. Leave it out unless the page installs `fsdev`.

## 3. Write one flow

- A flow is declared with `defineFlow({ kind, actions })`, which returns a factory; calling it gives the flow instance that is registered. `core/flow/defineFlow.ts:1623`; `hc/src/flows/hello-chat/flow.ts:78-95` (`const helloChatFlow = defineFlow({...}); const flow = helloChatFlow(); export default flow;`); `engT`/`nextP/test/createNextHandler.test.ts:60-67` (`defineFlow({...})()`). [page]
- `kind` is the flow's name, and `flow.id` is its `kind` unless the instance was given another id. `eng/flowstate/types.ts:119-123`. [page: `kind: "support"`]
- `actions` is a map from action name to an entry. An entry is a block, or `{ block, userMessage, ... }` when it sets more. `core/types/flow.ts:293` (doc); `hc/src/flows/hello-chat/flow.ts:81-86`. [page]
- A generator is a block that calls a model. `generator({ name, model, prompt, inputSchema, history, user, itemVisibility })`. `hc/src/flows/hello-chat/flow.ts:37-51`; `core/blocks/generator.ts:575-592` (the `itemVisibility` doc). [page]
  - `model` is a string such as `"openai/gpt-6-luna"`. `hc/src/flows/hello-chat/flow.ts:19`. [page]
  - `prompt` is the system prompt. `hc/src/flows/hello-chat/flow.ts:40`. [page]
  - `inputSchema` is a Zod schema for the action's input. `hc/.../flow.ts:21-23`, `:41`. [page]
  - `user: (input) => input.message` picks what is sent as the user message. `hc/.../flow.ts:44`. [page]
  - `history: true` loads the session's earlier turns into the prompt: "history slot: load prior conversation from persisted request items." `hc/.../flow.ts:42-43`. [page: one clause; the reader's page is a chat]
  - With no `outputSchema` the generator's output is text and streams: "By omitting outputSchema, the generator defaults to z.string() which enables real-time text streaming. The framework emits assistant MessageItems automatically for text generators." `hc/.../flow.ts:32-36`. [page]
- **`itemVisibility` decides whether a reply reaches the page.** `itemVisibility: { client: true, history: true }` shows the generator's reply to the client and keeps it in history. Unset means no auto-emitted items: "no auto-emission. Only the generator's typed `block_trace` output flows to parents". `core/blocks/generator.ts:575-587` (doc: "There is no position-inferred default — every generator declares its own visibility explicitly"); `core/blocks/generator.ts:1268-1276`. [page; this is the "page shows nothing" pitfall, section 7]
- A generator that is itself a caller action's block, with no `itemVisibility`, makes `defineFlow` warn once in development: `Flow "<kind>" action "<name>" runs generator "<block>" with no itemVisibility, so it emits no items and a chat on this action renders nothing. Set itemVisibility: { client: true, history: true } to show its reply in chat, or itemVisibility: { client: false, history: false } to keep it headless on purpose.` `core/flow/defineFlow.ts:548-573`; `coreT/silent-generator-action.test.ts:1-8`, `:36-48`. [page: the warning is the pointer to the fix]
- The warning covers only a generator that is the action's block. A sequencer whose generator steps are all silent is not warned, "so no warning does not mean the action renders." `core/flow/defineFlow.ts:555-558`. [ref]
- `userMessage: (input) => input.message` on the action entry makes the framework emit the user's own line as a message item, so the transcript shows what the user sent. `hc/.../flow.ts:75-77`, `:84`; `core/types/flow.ts:219` (`userMessage?: (input) => string | UserMessageEcho`); `react/hooks/useSession.ts:436-440` (`sendAction`'s `userMessage` option shows the line at once). [page]
- An action entry's own `inputSchema` is optional: it defaults to `block.inputSchema`. `core/types/flow.ts:204-209`. [ref] The page gives the schema on the generator only.
- `requireUser` defaults to true. `core/types/flow.ts:575-578`. [page; section 5]
- The old docs' demo flow (`ep:148-203`) gates the flow with a bearer-secret resolver and omits `itemVisibility`. It is written for the install skill; it is not this page's flow. `ep:67-73`. [old wrong for this page's purpose] `ep:161-168`'s generator has no `itemVisibility`, so its reply is silent in a chat page and `defineFlow` warns on it (`core/flow/defineFlow.ts:564-571`). Do not copy it.
- Where the file lives. The layout the standard prescribes is `src/flows/<flow>/flow.ts`, one block per file in `blocks/`. `docs/contributing/user-docs.md:290-300`. `ns:215-238` and `hc/src/flows/hello-chat/flow.ts` keep the generator in the flow file. [page: the page may declare the generator in `flow.ts` for brevity, or put it in `blocks/reply.ts`; the standard asks one export per block file, so the reply generator belongs in `src/flows/support/blocks/reply.ts` if the page names a separate file]

## 4. Serve it: two files

### 4a. The server object

- `createFlowState(options)` takes one config object and returns the `FlowState` handle the route mounts. `eng/flowstate/types.ts:439-445` (handle doc); `ns:49`. [page]
- **`flows` is a list of flow instances**: `createFlowState({ flows: [support] })`. `eng/flowstate/types.ts:119-124` (`flows?: readonly FlowInstance<any, any>[]`, "Flows to register, as a list. Each is served under its own `flow.id`"); `hc/fsdev.config.ts:13-18` (`flows: [helloChatFlow]`); `nextP/test/createNextHandler.test.ts:70-73`. [page]
- **The keyed object form throws.** `flows: { support }` fails at construction: "`flows` is a list of flows, each served under its own id: `flows: [readiness, context]`. The keyed record form was removed." `eng/flowstate/createFlowState.ts:365-377`. [old wrong] `ns:57`, `ns:73`, `ns:140-149`, `cfg:46-50`, `models:45-46`, `ep:119` and `ep:126` (the last two: `flows: { hello }`) all show `flows: { x }`. A reader who copies any of them gets that error. The page uses the list and does not mention the old form. [flag] These pages need the fix at cutover; this one is the first of the setup family to show the list.
- `stores` omitted means in memory: "Nothing persists across a restart; startup says so, and production warns." `eng/flowstate/types.ts:168-178` (`stores?: StoreAdapter | StoresConfig`, "omitted: in memory, as the `default` profile"); `goals/first-hour/runs-without-store-ceremony/goal.md` (Signal a: no `stores` and `fsdev run` answers, stderr says the app runs in memory). [page: one sentence; this page names no store]
- To keep data, pass one adapter: `stores: sqliteStores({ filename })`, from `@flow-state-dev/store-sqlite`. `eng/flowstate/types.ts:170-172`; `goals/first-hour/.../goal.md` (Signal b). [ref] The page links Persistence; it does not install a store.
- `models` is optional and sets the default model and intents. `eng/flowstate/types.ts:154-156`; `ns:139-152`. [ref] `reference/runtime`
- The config object lives in its own module. `ns:49` ("Keep it in its own file so the route handler imports a configured instance"). [page]
- The root file is `fsdev.config.ts`, default-exporting the handle, so the route and the `fsdev` CLI import one object. `cfg:9`, `cfg:35-37`; `hc/fsdev.config.ts:1-18` (file header: "the single runtime wiring for this app, imported directly by the Next.js route handler ... and loaded by the `fsdev` CLI"); `hc/app/api/flows/[[...path]]/route.ts:1`. [page]
- A TypeScript config loaded by the CLI cannot use the `@/` alias, only relative imports: "Native type stripping ignores `tsconfig` path aliases." `cfg:199`; `ns:91`. [page: one sentence, because the route's import of the config is where the alias is tempting] [flag] The route file (a Next.js file, bundled by Next) may use `@/`; only the config's own import chain is read by native type stripping. `hc/app/api/flows/[[...path]]/route.ts:1` imports `@/fsdev.config`; `hc/fsdev.config.ts:15` imports `./src/flows/hello-chat/flow` (relative). The page shows the config with a relative import to the flow.

### 4b. The route

- The mount is `createNextHandler(flowstate)` from `@flow-state-dev/next`. It returns `{ GET, POST, PATCH, DELETE }` for a catch-all route file; it resolves the router on the first request and awaits Next 15's async `params`. `nextP/src/createNextHandler.ts:1-10`, `:33-53`; `packages/next/README.md:8-14`. [page]
- It takes the `FlowState` handle, not the router: `createNextHandler(flowstate)`, not `createNextHandler(flowstate.getRouter())`. `ns:248-250` ("takes the `FlowState` handle, not the resolved router"); `nextP/src/createNextHandler.ts:40-46` (signature `flowstate: FlowState`). [page: pitfall]
- The route exports all four verbs: `GET, POST, PATCH, DELETE`. The destructuring form exports them at once. `nextP/src/createNextHandler.ts:40-52`; `ns:252-254` ("The framework uses all four. If you only export `POST`, streaming and state fetches will fail."). [page: pitfall; "streaming ... will fail" is in the old page, the code reason is that the request stream is read with `GET` (`eng/routes/…` stream route is `GET /api/flows/:flowId/requests/:requestId/stream`; `apps/docs/docs/server/setup.md:220-254` as cited in the Serving flows sheet)]
- The route file is `app/api/flows/[[...path]]/route.ts` (or under `src/app`). The mount is `/api/flows`. `hc/app/api/flows/[[...path]]/route.ts` (the example's file); `ns:99`; `eng/routes/createFlowApiRouter.ts` default mount `/api/flows` (`ha:49`); `node/serve.ts:56-57` (`basePath` default `"/api/flows"`). [page]
- **The optional catch-all `[[...path]]` serves the bare `/api/flows`; the required `[...path]` does not.** The handler is tested with an empty `params` for the bare URL, where the list of flows answers 200: "An optional catch-all passes no `path` for the bare `/api/flows` list." `nextP/test/createNextHandler.test.ts:83-91`; `eng/routes/createFlowApiRouter.ts:307-311` (`params: { path?: string[] }`); `eng/routes/http-handlers.ts:454` (`Array.isArray(context.path) ? context.path : []`). The client lists flows from exactly that URL: `cli/client.ts:735` (`t.json("/api/flows")`), and `useFlow` calls it on mount (`react/hooks/useFlow.ts:129`, `fsd.flows()`). [page] [old wrong] `ns:99`, `ns:110` and `hc`-contrary `apps/kitchen-sink/app/api/flows/[...path]/route.ts` use the required `[...path]`; `ep:205-240` works around it with a second bare route file that passes `{ path: [] }`. The page shows `[[...path]]`, one file. (That a required catch-all does not match the bare path is Next.js's routing, not the framework's; the page says only "use the optional catch-all so the bare `/api/flows` is served".)
- `export const dynamic = "force-dynamic"` on the route. `hc/app/api/flows/[[...path]]/route.ts:3-6` ("required for SSE streaming. Without this, Next.js may buffer the Response body, preventing real-time token-by-token delivery."); `ns:105`; `packages/next/README.md:24`; `packages/engine/README.md:31`; `vercelDoc:337`. [page: pitfall; section 7]
- `export const runtime = "nodejs"` appears in `ns:104` and in `packages/next/README.md:23-25`; the example omits it. [flag] The hello-chat example does not export `runtime`; the Next README and `ns` do. Edge runtimes are not supported (`ha:97`, cited in the Serving flows sheet). Page may include `runtime = "nodejs"`; it is correct either way.
- On Vercel, the same mount uses `createVercelNextHandler` from `@flow-state-dev/vercel/next`; it shapes SSE headers. `packages/vercel/src/next.ts:1-25`; `ns:108-118`; `vercelDoc:49`. [ref] `guides/deploying-to-vercel` (B-07); the page links, shows nothing.
- A request starts a run that continues after the response on a host that stays up; a serverless host that freezes the function needs `onBackgroundWork`. `ns:120`; `eng/flowstate/types.ts:206-218` (as cited in the Serving flows sheet). [ref] B-07.
- What the route serves: an action is `POST /api/flows/:flowId/actions/:action` (new session) or `POST /api/flows/:flowId/:sessionId/actions/:action`; `GET` serves streams and state; `DELETE` ends sessions. `ns:124-129`; `nextP/test/createNextHandler.test.ts:62-80` (a `POST` at `/api/flows/next-test/sess1/actions/run`). [ref] `reference/http-api`; the page names "one route file serves every flow" and does not list verbs.
- Adding a second flow is one entry in `flows`. `ns:129`. [page, one clause]

## 5. Who is calling: `userId`

- **Every call carries a `userId`.** The client requires one: `createClient({ userId })`, throws `userId is required` for an empty or blank one. `cli/client.ts:57-62` (doc: "The user every call acts as. Sent as caller input, never trusted: with sign-in, the server authenticates the request's credentials instead."), `:603`; `cli/internal/http.ts:89-93`; `client/test/client.test.ts:53`. [page]
- In React, `FlowProvider` takes `userId`; a hook with no `userId` of its own or from a provider acts as `"devuser"`. `react/context/FlowContext.ts:42-46`; `react/internal/useClient.ts:15`, `:20`. [page: pass it explicitly; the default is a development identity]
- The server refuses an action call that names no user. With no resolver configured, the default resolver reads `body.userId` and `POST .../actions/<name>` with none answers **400**. `eng/transports/auth/defaultBodyUserIdPrincipalResolver.ts:1-11`, `:31-44`; `eng/routes/action-routes.ts:103-130` (a 401 whose message names `userId` is turned into 400); `engT/transports/http-adapter.test.ts:226-240` (`returns 400 when userId is missing`). [page: "a call with no user is refused (400)"]
- With a resolver whose result has no user, the answer is **401**: `engT/transports/per-flow-resolver.test.ts:113-122`. [ref]
- The default is development-only: the server takes `userId` from the request body, which the caller writes, so it identifies a caller and proves nothing. `eng/transports/auth/defaultBodyUserIdPrincipalResolver.ts:39-43` ("The body is caller-controlled ... so it is not a source an organization may come from"); `cli/client.ts:59`; `apps/docs/docs/server/authentication.md:7-9` ("The framework treats the `userId` you supply as authoritative. Verifying that the `userId` belongs to the caller is your application's job"); `eng/routes/createFlowApiRouter.ts:151`. [page: one sentence; the real answer is a `resolvePrincipal` on the flow, and C-17 owns it]
- A session is bound to the user that created it; a later request naming another user against that session is refused and writes nothing. `apps/docs/docs/server/authentication.md:33-35` (`UserBindingMismatchError`). [ref] C-17.
- The organization never comes from the caller: with no resolver the framework runs everything under the development organization `DEFAULT_ORG_ID`, "a development and system-wiring identity, not a security boundary." `core/types/auth.ts:25-45`; `eng/routes/action-routes.ts:155-160`. [ref] C-17. [flag] The page does not need to say organization at all; it is here so a writer does not claim `userId` alone secures anything.
- `fsdev run` reads the same config and, being a development tool, acts as `devuser` unless told otherwise. `core/types/auth.ts:47-54` (`DEFAULT_LOCAL_USER_ID = "devuser"`, "the default of `fsdev run` and `fsdev chat`"). [page only if section 8 is kept]
- The authentication page is the destination: `apps/docs/docs/server/authentication.md`. [link] C-17.

## 6. Call it from a page

- The page needs three things: a provider that names the flow and the user, a session to send into, and `useSession` to read it. `react/context/FlowContext.ts:42-62`; `hc/app/page.tsx:25-61`. [page]
- `<FlowProvider flowKind="support" userId="u1">` supplies the defaults to the hooks under it. Props: `flowKind`, `sessionId`, `userId`, `baseUrl`, `apiPath`, `fetcher`, `renderers`. `react/context/FlowContext.ts:42-62`. [page]
- A hook reads `flowKind` and `userId` from the nearest `FlowProvider` unless given its own. `react/hooks/useSession.ts:610-616`; `react/hooks/useFlow.ts:58-62`. [page]
- **A session id is required.** `useSession(sessionId)` takes `string | undefined`; `sendAction` on a hook with no id throws `useSession.sendAction requires a sessionId`. `react/hooks/useSession.ts:610-613`, `:2188-2196`. [page]
- **`useFlow({ autoCreateSession: true })` supplies the id.** On mount it lists the user's sessions for the flow, selects the newest, or, if there are none and `autoCreateSession` is set, creates one; it returns `activeSessionId`. `react/hooks/useFlow.ts:23-30`, `:125-160`, `:174-183`; `hc/app/page.tsx:42-44`. [page: one clause on what it does]
  - `useFlow` has no `activeSessionId` until its first read finishes, so the first render has `activeSessionId === undefined`, `isLoading: true`; the page disables the send until the id exists. `react/hooks/useFlow.ts:66-69`, `:174-183`; `hc/app/page.tsx:134-140` (`disabled={!session.canSendAction || !flow.activeSessionId}`). [page]
- `session.sendAction(action, input, options?)` sends an action into the session. It resolves when the request is accepted, not when the answer is finished; the answer arrives in `items`. `react/hooks/useSession.ts:436-445` (signature `sendAction: (action: string, input: unknown, options?: { metadata?, userMessage?, attachments? }) => Promise<ExecuteActionResponse>`); `hc/app/page.tsx:63-69`. [page]
- `session.items` is the list of output items in order, including the user's line (from `userMessage`) and the assistant's message as it streams. `react/hooks/useSession.ts:379`; `hc/app/page.tsx:99`. [page]
- `session.isStreaming` is true while a request streams; `session.canSendAction` is true when a new action may be sent; `session.error` is the last error. `react/hooks/useSession.ts:338`, `:350`, `:358`. [page]
- `ItemsRenderer` renders `items` with built-in fallbacks for `message`, `status`, `error` and `reasoning` items: a message becomes a block with the role label ("You" or "Assistant") and its text. `react/components/ItemsRenderer.ts:1-30`; `react/components/ItemRenderer.ts:85-125` (`renderMessageFallback`, `renderStatusFallback`, `renderErrorFallback`, `renderReasoningFallback`), `:199`. [page: it is the shortest way to show a reply; custom renderers are `renderers` on the provider, [ref]]
- A hook must run in a client component: put `"use client"` at the top of the page file. `ns:193`, `ns:244-246`; `hc/app/page.tsx:1`. [page: pitfall] [flag] `ns` quotes an error string: `"useSession can only be used in a Client Component,"` which is Next's error, not the framework's; the page names the cause, not the string. `FlowProvider` can sit in a server layout if the hooks sit in client children (`ns:193`, `ns:246`). [ref]
- `FlowProvider` needs no `baseUrl` on the same origin with no Next.js `basePath`; with a `basePath`, pass it (`baseUrl="/portal"`). The client adds `/api/flows` itself, so `baseUrl="/api"` requests `/api/api/flows/...` and 404s. `cli/client.ts:63-72` (`baseUrl` doc: `""` for the page's own origin; `apiPath` default `"/api/flows"`); `react/internal/useClient.ts:31-37` ("No base URL means the page's own origin"); `clientDoc:30-45`; `ns:260-262`. [page: pitfall] [flag] `hc/app/page.tsx:35` passes `baseUrl=""`, which is the same as omitting it.
- The reply streams into `items` as it is generated; the user sees text appear. `hc/src/flows/hello-chat/flow.ts:4-8`; `hc/app/page.tsx` (`isStreaming` shows a "Thinking..." line while the request streams, `:112-117`). [page]
- A page minimum (type-checks against `react/context/FlowContext.ts`, `react/hooks/useFlow.ts`, `react/hooks/useSession.ts`, `react/components/ItemsRenderer.ts`; none compiled for this sheet):

```tsx title="src/app/page.tsx"
"use client";

import { useState } from "react";
import { FlowProvider, ItemsRenderer, useFlow, useSession } from "@flow-state-dev/react";

export default function Page() {
  return (
    <FlowProvider flowKind="support" userId="u1">
      <Support />
    </FlowProvider>
  );
}

function Support() {
  const flow = useFlow({ autoCreateSession: true });
  const session = useSession(flow.activeSessionId);
  const [text, setText] = useState("");

  return (
    <main>
      <ItemsRenderer items={session.items} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void session.sendAction("reply", { message: text });
          setText("");
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} />
        <button disabled={!session.canSendAction || !flow.activeSessionId}>Send</button>
      </form>
    </main>
  );
}
```

  Backed by `hc/app/page.tsx:25-69`, `:134-140`. `session.items` is `OutputItem[]` and `ItemsRendererProps.items` is `OutputItem[]` (`react/components/ItemsRenderer.ts:27-30`). Action name `reply` and input `{ message }` match the flow in section 3. [flag] The sitemap's example names `FlowProvider` and `useSession`; `useFlow` is also needed because `useSession` takes a session id. The sitemap says the page example is "`FlowProvider`, `useSession`"; one more import is the cost of a real page.

## 7. Common pitfalls (kept from `guides/nextjs-setup`)

The sitemap keeps "Common pitfalls" from `ns:242-262`. Each below is cited to code, not only to the old page. The page's answer to question 3, "your page shows nothing while the model answers", is whichever pitfall the page lists first for it; sections 7a and 7b are both candidates, see the flag after 7f.

### 7a. The page shows nothing at all: the generator emits no items
- Cause: the action's generator has no `itemVisibility`, so it emits no items; the model runs and the page stays empty. `core/blocks/generator.ts:575-587`, `:1268-1276`. Fix: `itemVisibility: { client: true, history: true }`. Development warns when the flow is built. `core/flow/defineFlow.ts:548-573`; `coreT/silent-generator-action.test.ts:36-48`. [page] [flag] This pitfall is not in the existing docs (`ns` and `ep` omit it; `ep`'s demo flow has the bug). It is the commonest reason for an empty chat page and the code warns about it.
### 7b. The text arrives all at once: the stream is buffered
- Cause: Next.js may buffer the response unless the route exports `dynamic = "force-dynamic"`, so tokens arrive together at the end rather than as the model writes them. `hc/app/api/flows/[[...path]]/route.ts:3-6`; `packages/next/README.md:24`; `vercelDoc:335-337` ("SSE stream arrives all at once ... make sure your route file exports `export const dynamic = "force-dynamic"`"). On Vercel, `createVercelNextHandler` adds `Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no`: `packages/vercel/README.md:83`; `vercelDoc:49`. [page]
### 7c. Streaming and state fail: the route exports fewer than four verbs
- Cause: the route exports only `POST`. The page's stream is a `GET`. `nextP/src/createNextHandler.ts:40-52`; `ns:252-254`. [page]
### 7d. `/api/flows` returns 404: the route is `[...path]`
- Cause: a required catch-all does not match the bare mount URL, which the page's first call (`GET /api/flows`, listing flows) hits. Use `[[...path]]`. `nextP/test/createNextHandler.test.ts:83-91`; `cli/client.ts:735`; `react/hooks/useFlow.ts:129`. [page] [flag] `ns` and `apps/kitchen-sink/app/api/flows/[...path]/route.ts` use `[...path]`; this contradicts them. The test shows the handler is correct with no `path`; whether Next.js routes the bare URL to a required catch-all is Next.js's behaviour and was not run here. The page may put it as "use `[[...path]]`, so the bare `/api/flows` is served" without asserting the 404 as the framework's.
### 7e. Wrong `baseUrl`
- Cause: `baseUrl="/api"` (or the mount) doubles the prefix: `/api/api/flows/...`, 404. `clientDoc:30-45`; `ns:260-262`; `cli/client.ts:63-72`. [page]
### 7f. "useSession can only be used in a Client Component"
- Cause: a hook in a server component. Add `"use client"`. `ns:193`, `ns:244-246`. [page]
### 7g. Passing the router, not the FlowState
- `createNextHandler(flowstate.getRouter())` is wrong; pass the handle. `ns:248-250`; `nextP/src/createNextHandler.ts:40-46`. [page]
### 7h. A config import through `@/`
- The `fsdev` CLI cannot resolve a `tsconfig` alias in the config's import chain. `cfg:199`; `ns:91`. [page, if `fsdev run` is shown]
### 7i. `flows` as an object
- `flows: { support }` throws. `eng/flowstate/createFlowState.ts:372-376`. [page: the page does not mention it as a pitfall unless a cold reader would arrive with the old docs; one clause under the config snippet is enough]
### 7j. FlowProvider placement
- Every hook (`useFlow`, `useSession`, `useClientData`) must be a descendant of the provider; nested providers inherit the parent's values. `react/context/FlowContext.ts:103-140`, `:110-120` (props fall back to the parent's); `ns:256-258`. [ref] Two clauses at most.

**[flag] Question 3.** The sitemap asks "Your page shows nothing while the model answers. Which pitfall is that?" Two pitfalls fit, with different symptoms. 7a: nothing ever appears (no `itemVisibility`). 7b: nothing appears until the reply is done, then all of it arrives (buffered stream). "While the model answers" fits 7b by wording and 7a by effect. The page should name both under distinct headings: "The page stays empty" (7a) and "The reply arrives all at once" (7b), and the cold-read key should grade either, naming the symptom. The caller settles which one the answer key names.

## 8. The Node alternative

- With no Next.js app, `@flow-state-dev/node`'s `serve(flowState)` stands up a long-lived HTTP server in one call. `node/README.md:1-12`, `:26-42`; `node/serve.ts:170-190` (doc and signature `serve(app: FlowState | FlowApiRouter, options = {}): Promise<ServeHandle>`). [page]
- Two lines:

```ts title="src/server.ts"
import { serve } from "@flow-state-dev/node";
import flowstate from "../fsdev.config";

await serve(flowstate);
```

  Backed by `node/README.md:29-42`; `node/serve.ts:184-190`. `fsdev.config.ts` default-exports the `FlowState` (section 4a). `node/index.ts:10`. The sitemap's "two lines" is the `serve` call and its import; the config import is the third. [flag] The standard asks for a title and no free names; `flowstate` is imported from the config file.
- Defaults: binds `process.env.PORT`, then `3000`, on `0.0.0.0`; mounts the API under `/api/flows`; serves `/healthz`; resolves once listening. `node/serve.ts:143-144` (`DEFAULT_PORT = 3000`, `DEFAULT_HOST = "0.0.0.0"`), `:166-174` (`resolvePort`), `:56-57`; `node/README.md:38-41`. [page: one sentence] [ref] the rest (`/healthz`, `SIGTERM`, `staticDir`, push) is on C-13 and `reference/runtime`.
- **`serve()` does not check authentication.** It binds `0.0.0.0` by default; with the default body-userId resolver, anyone who can reach the port can name any `userId`. The check that refuses a non-loopback bind is exported as `assertNetworkBindIsAuthenticated` and is run by `fsdev serve`; `serve()` itself imports only `isLoopbackHost` from it. `node/serve.ts:48`, `:228`; `node/bind-guard.ts:1-60`; `node/index.ts:24-25`. [page: one sentence, "pass `host: \"127.0.0.1\"` while developing", because the page sits at the integrator's first run] `host` is a `serve` option. `node/serve.ts:55`; `node/README.md:143` (`await serve(flowstate, { host })`).
- A browser page served by another origin would need `baseUrl` set to the server's origin, and the Node host's `basePath` replaces `/api/flows`, so the client gets the same value as `apiPath`. `ha:49-58`; `react/context/FlowContext.ts:47-52`. [ref] The page says the React part is unchanged for a page on the same origin and links C-13.
- `fsdev serve` is the command for the same call; `fsdev dev` serves the API and the DevTool together. `ha:17-21` (the matrix row for `serve()` names both); Serving flows sheet section 3. [ref]
- Running a flow from a terminal needs no page: `fsdev run <flowId> <action> -i '<json>'` runs the flow with the config's models and stores. `cfg:9-18`; `ns:85-89` (`pnpm fsdev run hello-chat chat -i '{"message":"hi"}'`); `ep:265`. [page: one command, as the check that the flow works before the page exists] [flag] `fsdev run` needs the config file, Node 22.18 (`ep:87`) and `@flow-state-dev/fsdev`. `fsdev run` acts as `devuser` (`core/types/auth.ts:47-54`), so the input need not carry `userId` the way `ep:265` writes it for the gated demo flow. The `-i` input is the action's input (`{"message":"hi"}`); `ep:265` carries `userId` inside input because that flow's `inputSchema` has it.

## 9. Answers to the sitemap's four questions

1. **Which file serves your flows over HTTP in a Next.js app?** `app/api/flows/[[...path]]/route.ts` (or `src/app/...`), which exports `{ GET, POST, PATCH, DELETE }` from `createNextHandler(flowstate)` and `export const dynamic = "force-dynamic"`. `nextP/src/createNextHandler.ts:40-52`; `hc/app/api/flows/[[...path]]/route.ts`; `packages/next/README.md:14-25`.
2. **What must every call say about who is calling?** A `userId`. The page's provider names it (`<FlowProvider userId="u1">`), the client requires it, and a call with none is refused (400 with the default resolver). The value is the caller's own claim until a `resolvePrincipal` verifies it. `cli/client.ts:57-62`, `:603`; `engT/transports/http-adapter.test.ts:226-240`; `eng/transports/auth/defaultBodyUserIdPrincipalResolver.ts:1-44`; `apps/docs/docs/server/authentication.md:7-9`.
3. **Your page shows nothing while the model answers. Which pitfall is that?** See the flag in section 7: no `itemVisibility` on the action's generator (7a; nothing ever shows) or a buffered route (7b; the text arrives all at once at the end). `core/flow/defineFlow.ts:548-573`; `hc/app/api/flows/[[...path]]/route.ts:3-6`.
4. **You have no Next.js app. What do you use instead?** `@flow-state-dev/node`: `await serve(flowstate)`. `node/README.md:29-42`; `node/serve.ts:184-190`.

## 10. The four questions, for each stored part

The page adds files and stores nothing of its own. What it names is where the data a chat produces is kept.

| Part | Who owns it | Who can see it | Where it is stored | How many |
| --- | --- | --- | --- | --- |
| The three new files (flow, route, page) | Your app's code | Whoever reads the repo | Source files in your repo | One flow file, one route file, one page |
| A session (the conversation the page sends into) | The `userId` that created it; a later request naming another user against that session is refused | That user; the page reads it through the session routes | The store `stores` names: in memory when `stores` is omitted (lost on restart), otherwise the adapter (for example `sqliteStores({ filename })`) | One per `useFlow` auto-create; `useFlow` reuses the user's newest session on a reload; a new chat is another session |
| The items in a session (the user's lines and the replies) | The session | The session's user | The same store | One per message the user sent and one per reply, kept in order |
| The model key (`OPENAI_API_KEY`) | You | Not visible to the client; read from the server's environment | `.env.local` or the host's secret store; never committed | One per provider |

Sources: `eng/flowstate/types.ts:168-178` (in memory when omitted); `goals/first-hour/runs-without-store-ceremony/goal.md` (Signals a and b); `apps/docs/docs/server/authentication.md:33-35` (session bound to its user); `react/hooks/useFlow.ts:125-160` (reuse the newest session, else create); `ns:205`, `models:21-34` (key in the environment). [page: one sentence on in-memory sessions and where to read about keeping them, since a reload after a server restart loses the conversation; the rest is [ref]]

[flag] **Dev reload.** In `next dev`, a module reload can rebuild the `FlowState` object and, with the default in-memory store, drop sessions. This is not stated anywhere citable in the allowed sources and was not run; the page does not say it.

## 11. What the page links to, and does not explain

- Server options (`models`, `stores`, `adapters`, profiles, and the rest of `createFlowState`) → C-13 (`./serving-flows.md`) and `reference/runtime`. `eng/flowstate/types.ts:116-420`.
- Authentication and who a caller is → C-17 (`./auth-and-tenancy.md`). `apps/docs/docs/server/authentication.md`.
- Hooks (`useSession`, `useFlow`, `useClientData`, `renderers`) → C-10 (`./sessions-items-and-streaming.md` or the page the sitemap names for C-10; the writer confirms the slug).
- Deploying (Vercel, `onBackgroundWork`, `createVercelNextHandler`, Docker, Railway) → B-07. `vercelDoc`; `ns:108-120`.
- Persistence (keeping sessions across restarts) → the persistence concept page. `eng/flowstate/types.ts:168-178`.
- The assistant install path (`install-fsd` skill) and the generated demo flow → `getting-started/existing-project` as it stands; the sitemap keeps this page's by-hand path. `ep:13-23`. [flag] Not decided by this sheet.

## 12. What it gets you

Each is observable and tied to the page's example. All are guarantees, not mechanism.

- **Nothing in your app moves.** The flow, the route file and the page are new files; no existing route, layout or config is edited. The route is under `/api/flows`, so it shares nothing with your other routes. `ep:11-23` (the install adds files and appends to `.gitignore`), `ep:69` ("Only this flow is gated. Everything else your project serves is unchanged."); the three-file shape is `ns:99`, `ns:160-174`, `hc` layout. [page: the figure's claim; verify against the final file list] [flag] `ns` also has the reader edit `app/layout.tsx` to add the provider; this page puts the provider in the page file, which keeps "the page" the third new file and adds no edit to an existing one.
- **One route file serves every flow.** Adding a second flow is one entry in `flows`, with no second route. `ns:129`; `eng/flowstate/types.ts:119-123`.
- **The reply streams as it is written**, and the page shows it with `ItemsRenderer` and no renderer of your own. `hc/src/flows/hello-chat/flow.ts:32-36`; `react/components/ItemRenderer.ts:85-125`.
- **The terminal runs the same flow.** `fsdev run support reply -i '{"message":"hi"}'` goes through the same config as the route, so a flow can be checked before the page exists. `cfg:9`, `cfg:35-37`; `ns:85-89`.
- **The same flow serves from Node.** Moving off Next.js changes the file that mounts it, not the flow. `ha:11`; `node/README.md:26-42`.

## 13. For the caller: where the sitemap and the existing pages disagree with the code

- **`flows: { x }` is a broken example in every setup page** (listed in section 4a). This page uses the list. The Setup, Config, Models and Existing-project pages need the fix at cutover.
- **`[...path]` versus `[[...path]]`** (section 4b, 7d). The existing docs use the required form; the example uses the optional form; the handler's own test passes no `path` for the bare list. The page uses `[[...path]]`.
- **Sitemap example "`FlowProvider`, `useSession`"** needs `useFlow` too, because `useSession` takes a session id and `sendAction` throws without one (section 6).
- **Sitemap question 3** has two fitting pitfalls (section 7).
- **`ep`'s demo flow omits `itemVisibility`** and so renders nothing in a chat page; `defineFlow` warns on it (section 3).
- **`ns:28` calls `zod` a peer dependency;** it is a dependency of `@flow-state-dev/core` (section 2).
- **Node version.** 22 in `ns` and the package `engines`; 22.18 in `ep` for the CLI's config loading (section 1).
- **`serve()` binds `0.0.0.0` and does not run the authentication check** that `fsdev serve` runs (section 8).
- **Source read but not citable:** none outside the allowed list was opened. The page plan's Sources line names only existing user docs, both cited.

## 14. Revise round 1 notes

- Moved to Reference, page keeps a symptom line and a link: provider key table (R-15 `reference/environment`); generator defaults and `itemVisibility` (R-02 `reference/generators`, R-06 `reference/items`); `kind` in URLs (R-05 `reference/flows`); refusal of a call with no `userId` (R-20 `reference/authentication`; the page keeps the development-only line); route requirements, the four verbs and the `[[...path]]` folder (R-13 `reference/http-api`); `"use client"` and `baseUrl`/`basePath` (R-14 `reference/client`); `createNextHandler` input (R-12 `reference/runtime`). The page names `baseUrl` only in the doubled-prefix pitfall, as the cause (section 6).
- Node path: the page now says `pnpm add @flow-state-dev/node` (section 8; `node/README.md`).
- Session is defined at its first use on the page, in the `stores` sentence (section 6, 10).
- Figure caption "Three new parts": flow, server (`fsdev.config.ts` and the route file) and page. The description now says the server is two files.

## 15. Revise round 2 notes

- Intro now reads "a flow, a server for it, and a page"; the server is two files (`fsdev.config.ts`, the route file), as the figure says (sections 4a, 4b).
- Generator sentence gives each clause: text output streams (section 3, `hc/.../flow.ts:32-36`), `history: true` loads earlier turns (`:42-43`), `itemVisibility` sends to client and keeps in history (`core/blocks/generator.ts:575-587`).
- Each pitfall states its cause, from sections 7a-7g: no `itemVisibility`; buffered response without `dynamic`; four verbs, stream is a `GET`; `[[...path]]`; `"use client"`; `baseUrl` doubles `/api/flows`; pass the handle not the router.
