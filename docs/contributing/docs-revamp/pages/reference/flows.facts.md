# Facts for Flows and actions (R-05, reference)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests and `goals/`, one example. No spec, no `docs/internal/`, no `CLAUDE.md`, no PR or commit text. Where a fact comes from reading the implementation and no test or exported doc comment pins it, it is marked **[source]**; where a test pins it, **[test]**; where an existing user doc states it and the code agrees, **[doc]**. **[ran]** marks a thing I ran this session against the real code (throwaway probe tests, deleted afterwards; nothing left in the tree). Nothing was run against a deployed server.

Paths are from the repo root. Abbreviations:

- Core, `packages/core/src/`: `ft` = `types/flow.ts`, `df` = `flow/defineFlow.ts`, `re` = `flow/resolve-entry.ts`, `dsp` = `types/dispatch.ts`, `dpb` = `blocks/dispatcher.ts`, `sc` = `types/session-create.ts`, `sch` = `types/schedules.ts`, `blk` = `types/block.ts`, `dep` = `helpers/deprecation.ts`, `rv` = `types/resource-visibility.ts`, `st-` = `types/state.ts`
- Engine, `packages/engine/src/`: `ra` = `execution/runAction.ts`, `ret` = `execution/retention.ts`, `pt` = `execution/past-turns.ts`, `tick` = `execution/schedule-tick.ts`, `rg` = `registry/flow-registry.ts`, `rge` = `registry/errors.ts`, `ro` = `context/record-owner.ts`, `be` = `context/binding-errors.ts`, `sb` = `context/session-birth.ts`, `cec` = `context/createExecutionContext.ts`, `cvs` = `context/client-visible-state.ts`, `stt` = `context/settled-turns.ts`, `sk` = `stores/scope-keys.ts`, `cas` = `stores/cas.ts`, `rs` = `stores/memory/request-store.ts`, `ar` = `routes/action-routes.ts`, `ru` = `routes/route-utils.ts`, `sro` = `routes/state-routes.ts`, `cs` = `routes/client-session.ts`, `ssr` = `routes/session-routes.ts`, `rr` = `routes/resume-routes.ts`, `rec` = `routes/recovery-routes.ts`, `hh` = `routes/http-handlers.ts`, `cfs` = `flowstate/createFlowState.ts`, `fst` = `flowstate/types.ts`
- Other: `jp` = `packages/bullmq/src/job-processor.ts`, `bmr` = `packages/bullmq/README.md`, `rf` = `packages/fsdev/src/resolve-flow.ts`, `rn` = `packages/fsdev/src/commands/run.ts`, `cl` = `packages/client/src/client.ts`
- Existing user docs, `apps/docs/docs/`: `cf` = `configuration/flow.md`, `ff` = `fundamentals/flows.md`, `fa` = `fundamentals/actions.md`, `fi` = `advanced/flow-isolation.md`, `ds` = `server/setup.md`, `bg` = `apps/docs/guides/background-jobs-bullmq.md`
- Tests, `packages/engine/test/` unless prefixed: `fio` = `flow-instance-ownership.test.ts`, `fiso` = `flow-isolation.test.ts`, `fri` = `flow-registry-identity.test.ts`, `uc` = `user-cell.test.ts`, `sbt` = `session-birth.test.ts`, `rae` = `run-action-edge.test.ts`, `ex` = `execution.test.ts`, `ab` = `abort.test.ts`, `ro-t` = `request-observer-items.test.ts`, `rfz` = `request-finalization.test.ts`, `arm` = `auto-resume-target.test.ts`, `retn` = `retention.test.ts`, `hw` = `history-window.test.ts`, `ais` = `action-input-schema-fix552.test.ts`, `rsp` = `request-spend.test.ts`, `dcf` = `context/dispatch-cross-flow.test.ts`; `cft` = `packages/core/test/flow.test.ts`, `cfc` = `packages/core/test/flow-config.test.ts`, `cfe` = `packages/core/test/flow-entries.test.ts`, `sga` = `packages/core/test/silent-generator-action.test.ts`, `jpt` = `packages/bullmq/test/job-processor.test.ts`

## What the page is

A Reference page for `defineFlow` and the actions on it: tables and lookups, no narrative, no word budget. The plan names six tables (every `defineFlow` field; action fields; session settings; running several copies of one flow; isolation flags; lifecycle hooks) and three lookups: "What does a request name to reach one copy of a flow?", "When does `onFinished` fire?", "What does `isolateUserState` change?". Answers to the three lookups are in section 9.

Imports the page's rows name:

- `defineFlow`, `defineView`, `dispatcher`, `defineResource`, `DEFAULT_ORG_ID`, `estimateTokenCounter`: `@flow-state-dev/core`. Types `FlowDefinition`, `FlowInstance`, `FlowType`, `ActionConfig`, `ActionCore`, `SessionConfig`, `RequestConfig`, `UserConfig`, `OrgConfig`, `RetentionPolicy`, `InstanceOwnerPin`, `SessionCreateCheck`, `ScopeClientConfig`: `@flow-state-dev/core/types`. **[source]** the `types` re-exports are what `packages/fsdev/src/resolve-flow.ts:11` and `packages/engine/src/registry/flow-registry.ts:55-60` import from.
- `createFlowState({ flows })`, `createFlowRegistry`, `FlowIdentityConflictError`, `CrossFlowSchemaConflictError`, `FlowInstanceBindingMismatchError`: `@flow-state-dev/engine` (`fst:152-157`; `fio` imports `createFlowRegistry`, `runAction` from `../src`; the error classes are in `rge:35-50`, `rge:130-170`, `be:110-133`).

## 1. `defineFlow` fields

`defineFlow(definition)` returns a callable `FlowType` (the definition); calling it with optional instance options returns a `FlowInstance`. `df:1623-1712`; `ft:858-925`. **[test]** `cft:50-92`.

| Field | Type | Default | Fact | Source |
|---|---|---|---|---|
| `kind` | `string` | required | The definition's id. A singleton's instance id is its kind. An instance option `kind` overrides it for that instance, and the singleton's id then derives from the effective kind (`flow({ kind: "reports-eu" }).id` is `"reports-eu"`). | `ft:540`; `df:428`, `:1444`; **[test]** `cft:100-109` |
| `cardinality` | `"singleton" \| "collection"` | `"singleton"` | See section 6. Definition-only. | `ft:493-509`, `:546`; `df:193-199` |
| `configSchema` | Zod object | none | See section 6. Definition-only. | `ft:573`; `df:258-284` |
| `actions` | `Record<string, ActionEntry>` | required | Caller-addressed entries: HTTP, MCP and voice, each authorized per request. An entry is a bare block or `{ block, ...fields }`; `defineFlow` turns a bare block into `{ block }`. `{}` is accepted. See section 2. | `ft:587-592`, `:298-300`; `df:130-143`; **[test]** `cft:122-131` (`actions: {}`) |
| `internal` | `{ actions: Record<string, entry> }` | none | Entries no caller can name. See section 4. Definition-only. | `ft:594-605`; `df:837-850` |
| `task` | `{ actions: Record<string, entry> }` | none | Entries a task board dispatches a claimed row to. See section 4. Definition-only. | `ft:607-615` |
| `views` | `Record<string, ViewDefinition>` | none | Blocks a screen watches, each declared with `defineView`. A value that is not a `defineView` result throws at definition: `Flow "<kind>" view "<name>" is not a view. Declare it with \`defineView({ scope, block })\`.` Definition-only. | `ft:617-624`; `df:873-887` |
| `session` | `SessionConfig` | none | See section 5. | `ft:358-413`, `:626` |
| `request` | `RequestConfig` | none | See sections 5 and 8. | `ft:415-478`, `:627` |
| `user` | `UserConfig` | none | `stateSchema`, `cas`, `client`. See section 5. | `ft:480-485` |
| `org` | `OrgConfig` | none | `stateSchema`, `cas`, `client`. See section 5. | `ft:487-492` |
| `resources` | map of resource and collection declarations | none | One flat map. A resource's own `scope` decides where it is stored. Resources a block declares reach the flow without being repeated. A flow entry under a block's accessor must be the block's own `defineResource()` reference, or `defineFlow` throws. A single resource declared at the flow level with `prefetchMode: "lazy"` throws (lazy is for a block's own declaration). | `ft:631-638`; `df:1227-1277`, `:1559-1568`; **[doc]** `ff:` "Automatic resource collection" |
| `tools` | `ToolsConfig` | none | `defaults.timeoutMs`, `defaults.retry`, `onToolStarted`, `onToolCompleted`, `onToolErrored` (a hook function or a block). A cache hit still fires started and completed with `cached: true`; `onToolErrored` never fires on a cache hit because errors are never cached. Applied to every generator action block, internal and task entry, webhook handler and static schedule block. | `ft:74-99`; `df:500-545`, `:535-545`, `:628-666` |
| `voice` | `VoiceConfig` | none | Flow-level TTS provider and speak defaults. Settable on the definition and overridden whole on an instance. | `ft:640`; `df:1610` (`options?.voice ?? definition.voice`) |
| `mcp` | `{ enabled?, exposeResources? }` | off | Opt-in MCP exposure. `enabled` defaults false. `exposeResources` defaults true. With `enabled: true`, every action not opted out must have a non-empty `description`, its own or its block's, or `defineFlow` throws `Flow "<kind>" exposes action "<name>" via MCP but the action has no description...`. Definition-only. | `ft:324-339`, `:642-647`; `df:1348-1368` |
| `webhooks` | `WebhookConfig` | none | Event bindings per provider. Each binding is an action in webhook form and is not an entry of `actions`. Definition-only. Page owner: R-32. | `ft:649-656`; `df:628-647` |
| `schedules` | `SchedulesConfig` | none | Three keys: `static`, `resolve`, `index`. See section 4b. Definition-only. | `ft:658-666`; `sch:210-248` |
| `resourceVisibility` | `(ctx, resource) => "visible" \| "read-only" \| "hidden"` | every resource reachable as its own `llmReadable` and `llmWritable` flags allow | Which resources the model's resource tools reach each turn. It narrows only. A `"hidden"` resource answers like one that is not registered; `"read-only"` refuses a write exactly as a resource that is not `llmWritable` does. Block code that names a resource directly is not narrowed. Definition-only. | `ft:668-675`; `rv:1-40` |
| `requireUser` | `boolean` | `true` | Shorthand for `authentication.requireUser`. Resolved as: instance `authentication.requireUser`, else definition `authentication.requireUser`, else instance `requireUser`, else definition `requireUser`, else `true`. Where both `requireUser` and `authentication.requireUser` are set on one definition, `authentication.requireUser` wins. With `false`, `defineFlow` throws if the flow declares `user.stateSchema`, a non-empty `user.client.expose`, or any user-scoped resource (the flow's own or a block's). | `ft:574-578`; `df:1432-1441`, `:1287-1316`, `:1575-1577`; **[test]** `cft:133-168`, `:170-250` |
| `authentication` | `AuthenticationConfig` | none | `resolvePrincipal`, `defaultUserId`, `requireUser`. On an instance, merged field by field over the definition: each of the three comes from the instance when it sets it, else from the definition. Page owner: R-20. | `ft:580-585`; `df:1318-1336` **[source]**, no test pins the field-by-field merge |
| `tokenCounter` | `TokenCounter` | `estimateTokenCounter` | The counter the engine packs history with and `ctx.tokenCounter` reads. | `ft:677`; `cec:3032`; `blk:436-443` |
| `costEstimator` | `{ estimate(usage, model) => number }` | none | Custom USD cost from model usage. | `ft:109-112`, `:678` |
| `isolateUserState` | `boolean` | `false` | See section 7. Instance option wins over definition. | `ft:680-698`; `df:1456` |
| `isolateOrgState` | `boolean` | `false` | See section 7. | `ft:700-701`; `df:1457` |

`reads` was a flow field and is refused by name at definition: `Flow "<kind>" declares "reads", which was removed. Declare each as a view instead...`. `df:858-865`. A flow written for it throws; nothing serves it. The page must not list it.

### 1a. Instance options (the argument to the factory)

`FlowInstanceOptions`, `ft:723-771`.

| Option | Fact | Source |
|---|---|---|
| `id` | A singleton defaults to its kind; a collection member has no default and `id` must be a non-empty string. A singleton may be built with another id for direct unregistered execution (an eval label), but the registry refuses to register it. | `df:409-429`; **[test]** `cft:100-121` |
| `kind` | Overrides the definition's kind for this instance. | `ft:733`; `df:1444` |
| `config` | The copy's settings. See section 6. | `ft:741` |
| `requireUser`, `authentication` | See section 1. | `ft:742-743` |
| `actions` | Per-instance action overrides. For a name the definition has, the entry is merged over the definition's with a shallow spread (`{ ...existing, ...override }`), so a `{ block }` override keeps the definition's `userMessage`, `concurrency` and the rest. A new name adds an action (the instance of `demo` in `cft:50-92` carries `extra` and `run`). A bare block is accepted. | `ft:744-750`; `df:575-614`; **[test]** `cft:50-92`, `sga:57-62` (an override adds an action) |
| `session`, `request`, `user`, `org` | Each is merged over the definition's with a one-level spread: a key the instance sets replaces the definition's value for that key, other keys stay. | `df:485-498`, `:1448-1450`, `:1504` |
| `resources` | Replaces the definition's flow-level `resources` map whole (`options?.resources ?? definition.resources`); resources blocks declare are still collected and merged in. | `df:1547`, `:1569` **[source]** |
| `tools` | `defaults` merged one level; each hook taken from the instance when set. | `df:462-483` |
| `voice`, `tokenCounter`, `costEstimator` | Instance value, else definition value. | `df:1610`, `:1615-1616` |
| `isolateUserState`, `isolateOrgState` | Instance value, else definition value, else `false`. | `df:1456-1457` |
| `ownerPin` | `{ orgId, userId? }` for an owner-pinned instance. `register(flow, { pin })` is authoritative; `ownerPin` is how a reload hands the pin on. Omitted: the instance is shared. A caller outside the pin gets the same `404` an unregistered address gets, and the instance is left out of the `GET /api/flows` listing for that caller. Page owner: R-20; the page keeps one row. | `ft:704-721`, `:765-770`; `rg:96-108`; `hh:1001-1026` |

Definition-only options. Passing one to the factory throws `Flow "<kind>" instance options set "<key>", which is not an instance option...` and TypeScript rejects it. The list: `resourceVisibility`, `webhooks`, `schedules`, `mcp`, `internal`, `task`, `reads`, `views` (`df:177-186`, `:448-460`). `cardinality` and `configSchema` are refused by their own messages (`df:209-233`). **[test]** `cft:8-22` (webhooks, schedules, mcp), `cfe:59-65` (internal), `cfe:389-` (task; the last test in the file), `cft:122-131` (cardinality), `cfc:275-287` (configSchema).

`ff:` says "Everything else is settable per instance: `id`, `kind`, `config`, `actions`, `session`, `request`, `user`, `org`, `resources`, `tools`, `voice`, `authentication`, `requireUser`, `tokenCounter`, `costEstimator`, `isolateUserState`, and `isolateOrgState`." The code agrees and adds `ownerPin`. **[doc]**

### 1b. What a definition and an instance carry

- A definition (`FlowType`) is callable and also readable: it carries `kind`, `cardinality`, `requireUser`, `config`, `requiresConfig`, `actions`, and the rest. `requiresConfig` is `true` when its `configSchema` does not parse `{}`, or the value that parse gives does not satisfy a block's `flowConfigSchema`. `ft:858-925`; `df:1654-1676`.
- An instance (`FlowInstance`) carries `id`, `kind`, `cardinality`, `requireUser`, `config` (never absent: a frozen empty object when there is no `configSchema`), and the merged config. `ft:773-856`.
- `ctx.flow.config` is the only part of the flow a block reads off the context. `blk:277-286`, `:376-400`.
- `createFlowInstance` builds each instance fresh, so definition-time validation (below) runs when the definition is called and again per instance. `df:1393-1416`, `:1652`.

Validation `defineFlow` runs, each a thrown `Error` at definition (or at the factory call, for the per-instance ones), none of them a request-time refusal. **[test]** where named.

| Check | Message names | Source |
|---|---|---|
| `cardinality` not one of the two policies | the flow and the bad value | `df:193-199`; **[test]** `cft:122-130` |
| `session.client.expose` (and `user`, `org`) names a key not on that scope's `stateSchema`, when the schema is a plain object that can be introspected | the flow, the scope, the keys, the valid keys | `df:106-120`; **[test]** `cft:1010-1023`, and `cft:1025-1035` (no check when the schema cannot be introspected) |
| `<scope>.client` carries a `derived` key | `... declares "derived", which was removed. Declare a view instead` | `df:97-104`; **[test]** `cft:996-1011` |
| a `webhooks` or `schedules` config is malformed | by name | `df:1466-1467` |
| an `internal` or `task` entry has no block, or has an invalid `concurrency` | the entry | `df:897-920`; **[test]** `cfe:39-57` |
| a `dispatcher()` the flow reaches names an entry of its own flow the flow does not declare | the block, the address, the fix | `df:958-1069`; **[test]** `cfe:67-98` |
| a task entry no board dispatches to, a task dispatcher no board holds, two boards for one entry | by name | `df:1010-1062`, `:1090-1097`; **[test]** `cfe:323-372` |
| a resource declared `flowIsolation: true` at session scope | `Sessions are intrinsically flow-bound — drop the flag.` | `df:1180-1185` |
| a resource declared `sharedToLineage: true` outside session scope | `That scope already spans every session in a lineage` | `df:1187-1193`; **[test]** `cft:965-980` |
| two accessor keys that resolve to one storage cell | the two accessors and the cell | `df:1144-1216` |
| two scope-state schemas the flow's reachable blocks declare disagree on a field | both sources | `df:809-826` |
| a request-level `concurrency` or an action's `concurrency` is an unknown policy | the flow and action | `df:1587-1590` |
| `requireUser: false` with user-scope declarations | see `requireUser` row | `df:1287-1316` |

## 2. Action fields

An action is a bare block, or an object. Every field below is optional except `block`. An `internal` or `task` entry carries the same core (everything except `description` and `mcp`). `ft:198-262` (core), `:272-289` (caller-addressed), `:298-300`; `dsp:720-775` (`InternalEntry` and `TaskEntry` are `ActionCore &` their own fields).

| Field | Type | Default | Fact | Source |
|---|---|---|---|---|
| `block` | `BlockDefinition` | required | The block that runs. | `ft:200` |
| `inputSchema` | Zod schema | the block's `inputSchema` | The input is parsed against `action.inputSchema ?? block.inputSchema` before the block runs, and the block gets the parsed value (defaults applied). A failure ends the request `failed` with error code `validation_error` and message `Action input validation failed at "<path>": <issue message>` (path part omitted when empty). Over HTTP this is not a `400`: the route answers `202` and the request settles `failed`. | `ft:202-209`; `ra:412-427`; **[test]** `ais:11-90`, `rae:40-66`; **[ran]** a `POST /api/flows/p/s1/actions/run` with `input: { n: "x" }` answered `202` and the request record read `failed` |
| `description` | `string` | the block's `description` | Resolved once by `defineFlow`: the action's own, else its block's. Required (non-empty) when the action is exposed over MCP. Used by DevTool tooltips either way. A description an override or definition wrote stays when the block is swapped; one resolved from the old block is replaced by the new block's. | `ft:275-286`; `df:149-155`, `:602-611`, `:1348-1368` |
| `mcp` | `{ enabled?, name?, session? }` | exposed when the flow enables MCP | `enabled: false` keeps the action off MCP. `name` must match `[A-Za-z0-9_.-]{1,128}` and defaults to the key in snake case (`recordPayment` is `record_payment`). `session`: omitted means a fresh ephemeral session per call; a string is a mint template (the first `*` becomes a random token, no `*` appends one); `{ fromInput: "<field>" }` reads the session id from that input field. `fromInput` is safe only under a single server-trusted principal. Page owner: R-34. | `ft:124-170` |
| `userMessage` | `(input) => string \| { text, metadata?, attachments? }` | none | Writes the request's input as a `user` message item when the request starts. `metadata` rides on the item for a client to read and is never sent to a model. `attachments` are `FileContent` references the flow itself kept. One taken from the action's input is written into the message as given; reading it from a run whose session or person does not own the file throws `AttachmentUnavailableError`. Files in the HTTP body's `attachments` are the ones the action route checks and claims. Not written again when a request continues after a suspend or crash (the echo is skipped in replay mode). Not written when the input fails validation (parse runs first). | `ft:172-187`, `:212-219`; `ra:1812-1830`; `engine/src/blobs/attachments.ts:160-209`; `engine/src/routes/attachment-claim.ts:1-70` **[source]** |
| `taskOf` | `(input) => string \| undefined` | none | Names the task the request is for. A non-empty id is stamped as `taskId` on the `userMessage` echo and every item the request emits, unless a nearer scope marks another task. Trace items stay unstamped. `undefined` or an empty string stamps nothing. The id is a label: it never routes, admits or authorizes. | `ft:220-230`; `ra:1818-1819` |
| `tokenBudget` | `{ maxTotalTokens, warnAt?, onExceeded? }` | none | Checked once, after the block returns (not mid-run). See section 2a. | `ft:231-235`; `ra:2729-2760` |
| `durable` | `boolean` | `false` | Page says it has no effect (internal cleanup of suspension records and lease is not on the page). A request that suspended and resumed, or ran a checkpointing sequencer, is cleared without it. Suspending and crash recovery do not depend on it: they need a host with durable execution (on by default wherever stores persist), and sequencers checkpoint unless they set `durable: false`. | `ft:236-243`; `ra:2917-2924` (`usedDurability = action.durable === true \|\| sawDurableFrame \|\| isReplayMode`) |
| `concurrency` | `ConcurrencyConfig` | `request.concurrency`, else `"allow"` | Resolved `entry.concurrency ?? flow.request?.concurrency ?? "allow"` for every entry type. An unknown policy throws at definition. Page owner: R-18. | `ft:244-253`; `df:1587-1590` |
| `autoResume` | `boolean` | `true` | Whether a request on this entry becomes the session's auto-resume target, the session record's `latestRequestId` that a client attaching to the session reattaches to. `false`: the request is still recorded and listed, and `latestRequestId` stays on the request before it. Meant for a control action sent beside a running request. Also: a request that creates its session leaves `latestRequestId` unset when `autoResume` is false, and a dispatch delivered into an existing session does not stamp it either. | `ft:254-261`; `ra:1585-1620`; **[test]** `arm:44-65` |
| `onCompleted`, `onErrored` | `BlockDefinition` | none | Action-level hooks. They are blocks, not functions. See section 8. | `ft:210-211` |

`inputSchema` on a collection copy or override: an instance override of an action replaces fields one by one (section 1a).

### 2a. `tokenBudget`

| Setting | Fact | Source |
|---|---|---|
| `maxTotalTokens` | Total tokens counted across the request's model calls (`ctx.request.tokenUsage.totalConsumed`). Over means `consumed > maxTotalTokens`. | `ra:2729-2742` |
| `warnAt` | A fraction of `maxTotalTokens`. At or past it, but not over the budget, a transient `status` item reads `Token budget warning: consumed <n> of <max>` and the request completes. | `ra:2731-2733`, `:2754-2760` |
| `onExceeded: "error"` (default) | The request fails with `ValidationError` code `validation_error`, `Token budget exceeded: consumed <n> > <max>`. | `ra:943`, `:2738-2744`; **[test]** `rae:348-390` |
| `onExceeded: "stop"` | A transient `status` item reads `Token budget exceeded: consumed <n> of <max>`; the request ends `incomplete`; `onCompleted` hooks do not run (`onFinished` does, with status `incomplete`). | `ra:2745-2753`, `:2813`; **[test]** `rae:446-499` (status `incomplete`, `onCompleted` not run) |
| `onExceeded: "warn"` | The same `status` item, one only, and the request completes. | `ra:2745-2750`; **[test]** `rae:396-444` |
| Warning item | `type: "status"`, `transient: true`, `detail.code: "system.token_budget_warning"`. | `ra:966-977` |
| What counts | Each generator and evaluator result, a tool-loop step as it finishes, an evaluator a generator calls as a tool, a schema-repair call. A request that suspends and resumes keeps one count. Runs of a coding-agent block (Claude Code, Codex, Cursor) report to the ledger's harness runs, not its by-model total, and do not count. | `engine/src/context/createExecutionContext.ts:3134-3149`; `engine/src/execution/request-spend-ledger.ts:12-36`; **[test]** `rsp:205-240`; **[doc]** `cf:` "Token budgets" |

## 3. Client exposure per scope (the carried row's detail)

- `session`, `user` and `org` each take `client: { expose?: string[] }`. State is private by default: a field reaches the client only when it is named in `expose`. `ft:54-67`, `:375`, `:484`, `:490`.
- `request` has no `client` config. `RequestConfig` has no such field. `ft:415-478`.
- A scope with no `client`, or an empty `expose`, sends nothing; `clientData.<scope>` is omitted from the state read when it would be empty. `sro:84-86`, `:160-181`, `:220-243`; `ru:402-414`. **[source]**
- `expose` copies `state[name]` verbatim, after the scope's schema defaults are applied. The state read takes `?clientData=session.foo,user.bar` to choose names. `ru:395-414`; `sro:84-86`.
- Session state reaches a client two ways: names in `session.client.expose`, and every top-level field the session `stateSchema` declares `.readonly()` (set at create, and published as a listing filter). The session read, listing, create and metadata-edit responses all send the session record through this one filter; a record whose owner this process cannot resolve sends an empty `state`. `cvs:16-18`; `cs:43-55`. **[source]**
- `expose` names a key that is not on the schema: throws at definition (section 1). `session.client.derived` throws at definition; a view replaces it. `df:97-120`; **[test]** `cft:983-1035`. `cf:182` and `ff:` "Session configuration" still show `derived`; the code refuses it (section 12).
- A resource has its own `client` config and is not governed by these. R-08.

## 4. Entry maps and schedules

### 4a. `internal.actions` and `task.actions`

- Declared `internal: { actions: { name: block | { block, ...core } } }` beside `actions`. The flat spelling `internal: { name: ... }` throws `Flow "<kind>" declares "internal" without an \`actions\` map...`. `df:837-850`; **[test]** `cfe:372-388` (task, flat sibling refused).
- Reachable only by an `internal` dispatch. The map is the boundary: a dispatch resolves one type's map and never falls through to another's, so an action named the same does not stand in. `re:1-88`; `dsp:1-60`; **[test]** `cfe:87-97`, `engine/test/execution/resolve-action-core.test.ts:74-80`. No HTTP, MCP, webhook or schedule caller reaches an `internal` entry: the dispatch type is decided by which door it came through, never by the body. `re:18-21`.
- The dispatch comes from a `dispatcher()` block (default `type: "internal"`). Without `flowKind` it resolves on the sending instance's own `internal.actions`, checked at `defineFlow`. With `flowKind: "<instance id>"` it resolves on **another flow instance's** `internal.actions`, checked when the dispatch runs: `flow-not-found` (not registered; a collection's bare kind counts as not registered) or `no-entry` (flow has no such entry), thrown to the sending block as `DispatchRefusedError`. `dpb:45-62`, `:185-216`; `dsp:17-27`; **[test]** `dcf:192-290`. **So "reachable only through a `dispatcher()` block in the same flow" is not the whole rule**: a dispatcher in another flow can name this flow's entry (section 11, row 5).
- A `dispatcher()` runs in a request of the sending flow. Its dispatch is fire-and-forget: it starts a request on the target and returns the handle. `dpb:45-62`; **[test]** `dcf:192-240`.
- `task.actions` entries are reached only by a `dispatcher({ action, session })` placed as a worker on a task board; `defineFlow` puts each behind the board's claim gate. An entry no board addresses throws at definition unless it declares `from`. `df:958-1099`; `ft:607-615`.
- Both maps are definition-only (an instance option throws). `cfe:59-65`, `:389-`.
- Entries carry the action core (`block`, `inputSchema`, `onCompleted`, `onErrored`, `userMessage`, `taskOf`, `tokenBudget`, `durable`, `concurrency`, `autoResume`), not `description` or `mcp`. `dsp:720`, `:756`; `ft:198-262`.
- A task entry that a shared child session receives (a dispatcher with `session` other than `per-task`) defaults to `concurrency: "queue"` unless the entry sets one. `df:1072-1077`; **[test]** `cfe:243-276`.
- Page owner for dispatch and boards: R-19, R-23. This page keeps the map rows.

### 4b. `schedules`

`SchedulesConfig` has three keys, all optional. `sch:210-248`.

| Key | Fact | Source |
|---|---|---|
| `static` | `Record<id, ScheduleConfig>`. Each is an action in scheduled form (its `block` and policy are inline, so it needs no entry in `actions`). Looked up first. Validated when the flow is defined. The engine's tick fires every enabled static schedule that is due. | `sch:140-205`, `:210-218`; `df:1467`; `tick:100-112` |
| `resolve` | `(scheduleId, ctx) => ScheduleConfig \| null`. Called when `static[id]` is absent. `null` answers `404`. A dynamic config is validated at dispatch (`400 invalid_schedule`). `ctx` carries `flowKind`, `gatewayPrincipal`, `request`, `stores` (`resourceState.get`, `content.get`), `userStorageKey(userId, orgId)` and `ownerPin`. | `sch:210-236`, `:57-100` |
| `index` | The schedule index (`@flow-state-dev/scheduled`'s `ScheduleIndex`) this flow's dynamic schedules are mirrored into. The tick claims due entries from it and dispatches them to this flow. One index serves one flow; an index two flows name is claimed once, for the first flow that names it. | `sch:238-247`; `tick:100-115` |

- The tick fires only schedules it can enumerate: a flow is ticked when it has at least one `static` entry or an `index` (`declaresTickedSchedules`). A flow whose `schedules` has only `resolve` starts normally and is never ticked; its fires have to come from an outside caller of the dispatch endpoint. `tick:216-220`; **[test]** `packages/engine/test/flowstate/local-scheduler.test.ts:305-313`.
- `schedules` is definition-only. `cft:10-22`.
- Field definitions of `ScheduleConfig` (`cron`, `input`, `principal`, `timezone`, `onOverlap`, `description`, `enabled`) belong to R-33 and are not carried here (section 11, row 6). The row that stays here is the three keys.

## 5. Session, user, org and request settings

### 5a. `session` (`SessionConfig`, `ft:358-413`)

| Field | Type | Default | Fact | Source |
|---|---|---|---|---|
| `stateSchema` | Zod object | none | The session state shape. A new session's initial state is parsed through it, so every declared key starts at its default. A top-level `.readonly()` field is set when the session is created and never changes: a write that would change it fails with `ReadonlySessionStateError`, code `readonly-session-state`, `Session "<id>" of flow "<kind>" can't change state field "<field>": it is readonly, set when the session was created. Start a new session for another value.`, whoever writes it and through every write path. Other fields still write. Readonly fields are also the only fields the session listing filters by (`?state.<field>=` over HTTP, `listSessions({ state })` in the client; a field that is not readonly, a flow that declares none, or a filter with no `flowKind` or `flowId` is refused). Only a plain `z.object` at the top is read for readonly fields. | `ft:359-368`; `sb:460-475`; **[test]** `sbt:310-355`, `sbt:574-610`; `cl:105-117` |
| `client` | `{ expose? }` | private | See section 3. | `ft:370-375` |
| `metadata` | Zod schema | none | Declares the shape of session metadata for typing. Not enforced: `ctx.session.setMetadata()` and the metadata route do not parse against it, so a value outside the schema is stored. `setMetadata` shallow-merges `metadata` into the stored one. | `ft:359`; `cec:3355-3371`; **[source]** (no parse in `ssr` or `cec`) |
| `retention` | `{ maxItems?, maxAge? }` | unbounded | See section 5b. | `ft:345-350`, `:376`; `ret:53-80`, `:93-240` |
| `historyWindow` | `{ turns: number }` | `50` | The most recent `turns` past turns loaded as cross-turn history per request: completed requests, and requests cut short when their server died. The window is counted before an interrupted request that a retry re-ran, or one still parked on a gate, is left out, so those take a slot and a full window can show fewer than `turns` turns. It caps the store read and the default generator's in-prompt history; the full session stays retrievable through the state endpoint. Per-call `history({ limit })` refines within the window and cannot widen it. `0` or a negative number gives no cross-turn history. | `ft:378-390`; `cec:775`, `:845-855`; `stt:89-135`; **[test]** `hw:73-163`; **[ran]** with `historyWindow: { turns: 0 }` and with `{ turns: -2 }` over five stored completed turns, `ctx.session.items.history()` returned 0 messages in the in-memory store |
| `cas` | `{ maxRetries?, baseDelayMs? }` | `3` retries, `10` ms base delay | Optimistic-concurrency retry budget for session writes. Same option on `user` and `org`. Not on `request`. | `st-:1-4`; `cas:31-32`, `:130`, `:139`; `cec:2655`, `:2697`, `:2739` |
| `createCheck` | `(input) => { ok: true } \| { ok: false, message, status? }` | none | Runs before a session of this flow is written, on every path that creates one: the create route, an action sent to a session id that does not exist yet, a webhook delivery, `fsdev run`, and a dispatch into a key-derived child session. Never runs for a turn on an existing session, and never again for a create that lost a race. Receives `{ principal: { userId, orgId, tenantId? }, sessionId, flow: { kind, id }, state, via, readCollectionResource(ref, topic) }`; `state` is the initial state after `stateSchema` parsed it, `via` is `"create" \| "action" \| "webhook" \| "cli" \| "dispatch"`. A refusal answers with `status` (`400`, `403` or `404`; default `400`) and `message`, body `{ error: <message> }`, and writes nothing. `readCollectionResource` reads one item of a user- or org-scoped collection of this flow at the creating principal's own scope; it throws for any other ref. | `ft:391-399`; `sc:1-103`; `sb:293-360`; `ru:137-143`; **[test]** `sbt:194-262`, `:356-415` |
| `serverOwned` | `string[]` | none | Session-state fields only the flow's own code writes. A create that carries a value for one (the create route's `state`, an action's seed, `fsdev run --seed-session`) is refused `400` with `{ error: "Session state field \"<field>\" is written only by flow \"<kind>\"; a caller cannot set it.", field }`. State a dispatching block names for its child session is not caller state and is not refused. | `ft:400-406`; `sb:219-239`, `:298`; **[test]** `sbt:238-257` |

#### Initial state, and when it must fit

- A new session's initial state is parsed through `stateSchema` (defaults fill in). On a flow that **binds its sessions**, meaning it declares a top-level `.readonly()` session-state field or a `session.createCheck`, a state the schema rejects is refused `400` with `{ error: "The initial state of a session of flow \"<kind>\" doesn't fit its stateSchema at \"<path>\": <issue>", field }` and nothing is written. Any other flow keeps a rejected initial state as sent and validates it when its actions run. `sb:243-285`; **[test]** `sbt:225-237`, `:289-309`. **[doc]** `cf:181`.
- The create route takes the initial state in the body (`state`). An action sent to a session id that does not exist carries none (the state is `{}`), so on a flow whose sessions need state (a required readonly field, or a check that reads it) the action is refused `400` at the door with the field named, nothing registered and nothing written; the way to start such a session is the create route (or `fsdev run --seed-session`). A webhook delivery for a missing session is refused the same way. `sbt:356-415`; `ar:284`; **[test]** `sbt:356-365`, `:385-399`.
- `fsdev run` passes `--seed-session <json|file>` as the initial state; a refusal exits `2` (`EXIT_INVALID_ARGS`) with the refusal message, plus the hint `Pass the session's initial state with --seed-session.` when a `createCheck` exists and no seed was given. A session the run did not create is checked before anything is written: another instance's session exits `2` naming the owner instance, and a seed may not set a `serverOwned` field or change a readonly one. `rn:372-395`, `:440-475`.
- Create route on an id that exists, or one another create took first, answers `409 { error: "Session \"<id>\" already exists" }` and does not call `createCheck` again. The action, webhook and CLI paths adopt the winner of a lost race instead (the winner was checked when it was born). `ssr:485-510`; `sb:1-37`, `:395-470`; **[test]** `sbt:259-267`.
- A session created again under an id that was deleted starts with only what its own create named. `sbt:268-277`; `sb:60-97`.
- Dispatch into a key-derived child: the child's state comes from the dispatching block; the same `createCheck` and readonly rules apply; a child that already exists is adopted only when its readonly state matches what this dispatch names. **[test]** `sbt:417-537`.

### 5b. `retention`

| Fact | Source |
|---|---|
| `{ maxItems?, maxAge? }`. Neither set means no retention. `maxAge` is milliseconds or a duration string `<number><ms\|s\|m\|h\|d>` (`"30s"`, `"5m"`, `"2h"`, `"7d"`, decimals allowed); anything else throws `Invalid duration string: "<value>". Expected format: "30s", "5m", "2h", "7d".` when the request starts. | `ret:53-80`; `engine/src/utils/duration.ts:6-35`; `ra:1204` |
| Runs after a request completes (status `completed` only), on that session. A session nothing is written to does not shrink. | `ra:2935-2955`; `ret:1-6`, `:93-110`; **[test]** `retn:125-` |
| What is evicted: whole past turns, oldest first by when each ended. A past turn is a `completed` request, or an `interrupted` one (its server died). A `failed` request is never an eviction candidate. | `pt:30-40`; `ret:105-115`, `:129-143`; **[test]** `retn:366-381` |
| Order: `maxAge` first (turns that ended before `now - maxAge`), then `maxItems` (walks newest first, keeps turns while the running total of items, counting the current request and every protected request, stays within `maxItems`; the rest are evicted). `maxItems: 0` evicts every prior turn; `maxAge: 0` evicts every older turn. | `ret:195-240`; **[test]** `retn:187-235`, `:251-278` |
| Never evicted: the current request; a request still in the active registry; a request whose run has not finished (`finalizedAtMs: null`); one whose run finished less than the grace window ago; an interrupted request that is parked at a pending gate or is owed a re-drive. A protected request still counts toward `maxItems`, so older evictable history is evicted in its place and a busy session can briefly exceed its limits. | `ret:113-150`, `:158-193`, `:211-235`; **[test]** `retn:423-578`, `:580-660` |
| A run's end is when it has finished writing, `onFinished` and the background work it started included. The grace window after that is twice `LIVE_TAIL_LIVENESS_MS` (default `30000` ms, so `60` s). An invalid or non-positive `LIVE_TAIL_LIVENESS_MS` falls back to `30000`. A record written by a version that never stamped the end is held for the larger of the stale-request threshold (default `60000` ms) and `maxAge`, plus the grace window. | `ret:66-80`; `engine/src/streaming/live-tail-liveness.ts:9-17`; `engine/src/runtime-config.ts:280`; **[test]** `retn:113-123`, `:512-537`, `rfz:67-130` |
| Deleting a request removes its record, items, event log and run-once (cached step) results, and ends live streams of it. A record is deleted only while it still has the status it was judged in, so a request re-driven in between keeps its record. | `rs:135-165`; `engine/src/stores/types.ts:847-858` |

### 5c. `user` and `org` (`ft:480-492`)

- `stateSchema`, `cas`, `client` (section 3). No retention, no history window, no `metadata`.
- Their state is one record per scope owner, shared by every flow on the server by default, or per instance with the isolation flags. Section 7 and the stored-parts answers in section 10.
- `user.stateSchema`, `user.client` and user-scoped resources need `requireUser` true (section 1).

### 5d. `request` (`RequestConfig`, `ft:415-478`)

| Field | Type | Default | Fact | Source |
|---|---|---|---|---|
| `stateSchema` | Zod object | none | Request-scoped state. | `ft:416` |
| `onStarted`, `onCompleted`, `onErrored`, `onFinished` | `BlockDefinition` | none | Lifecycle hooks. See section 8. | `ft:417-420` |
| `onStepErrored` | `BlockDefinition` | none | Accepted by the type and collected for resources, but nothing in the engine ever runs it. See section 12 (the page must not list it as a hook that fires). | `ft:421`; `df:736-743`; no reference in `packages/engine/src` |
| `heartbeatIntervalMs` | number | `10000` | The active-request heartbeat; the same tick carries cross-process abort delivery. `0` disables both: a cancellation recorded elsewhere is never delivered, and a run longer than the default stale threshold (60 s, `DEFAULT_STALE_THRESHOLD_MS`, `liveness-gate.ts:67`) can be marked `interrupted` while still running. Each run still checks once for a cancellation as it starts. | `ft:422-432`; `ra:1430`, `:1491`; `engine/src/context/liveness-gate.ts:66`, `:85`, `:113-126` |
| `sseHeartbeatMs` | number | `15000` | Cadence of the SSE `: ping` comment frames on this flow's streams. `0` disables. A flow value wins over the host default. | `ft:433-441`; `hh:212`, `:288`; `ar` and `engine/src/routes/stream-routes.ts:108-111` |
| `concurrency` | `ConcurrencyConfig` | `"allow"` | Default for every entry that omits its own. | `ft:471-477` |
| `mutationTimeoutMs` | number | `30000` | Budget for in-memory state writes (the target and sequencer scopes, anything not bridged through a persist callback). A mutator past it rejects with `ScopeMutationTimeoutError`. `Infinity` disables. Does not apply to `request`, `session`, `user` or `org`, which persist. | `ft:454-470`; `cec:665-675` |
| `cleanupCheckpointsOnTerminal` | boolean | `false` | Delete durable sequencer checkpoints when the request ends; kept otherwise. | `ft:443-453`; `ra:2917-2931` |

## 6. Running several copies of one flow

### 6a. Cardinality and ids

| Fact | Source |
|---|---|
| `cardinality: "singleton"` (default): one instance, whose id is its `kind`. The factory takes no id, or the kind spelled out. Registering a singleton under any other id is refused. | `ft:493-509`; `df:409-429`; `rg:786-848`; **[test]** `cft:100-109`, `fri:32-42` |
| `cardinality: "collection"`: several named copies. Every instance must be created with an explicit non-empty `id`, and that id is the only address it answers to. The bare kind never selects a member, even when one is registered. A collection definition is readable without an id (`engineer.cardinality`, `engineer.actions`); calling it with no id throws `Flow "<kind>" has cardinality "collection", so every instance needs an explicit id: call the flow factory with { id: "<instance-id>" }.`; an empty id throws `Flow "<kind>" instance id must be a non-empty string; received ""`. | `ft:493-509`; `df:409-429`; **[test]** `cft:111-121`, `fri:79-127` |
| Ids are unique across the registry whatever the kind. `register` refuses, with `FlowIdentityConflictError` and `reason`: `duplicate-id` (any instance, of any kind, already holds the id), `singleton-id-mismatch` (a singleton under a custom id; the message tells the author to declare `cardinality: "collection"`), `mixed-cardinality` (one kind registered under both policies, whichever registers first), `invalid-cardinality`, `invalid-id`, `unminted-config` (see below). Refused before any registry state changes, so the earlier registration stays reachable. | `rge:7-80`; `rg:786-870`; **[test]** `fri:31-77`, `registry/runtime-registration.test.ts:153-170` |
| An exact id wins a lookup even when the string is another kind's name. A collection member whose id equals its own kind is admitted as an exact id. Registration order never picks a member. `get` and `list` read the registry per request, and `register` and `unregister` work while running. | `rg:1-54`, `:131`, `:308-327`; **[test]** `fri:79-127` |
| `createFlowState({ flows })` takes a list; each flow is served under its own `flow.id`; two with one id are refused at construction. The old keyed-record form throws `FlowStateConfigError`: `createFlowState: \`flows\` is a list of flows... The keyed record form was removed.` | `fst:150-157`; `cfs:403-416` |
| `unminted-config`: registering a definition (not an instance) whose `configSchema` does not parse `{}` (or whose blocks' `flowConfigSchema` the empty bag does not satisfy) throws `Flow "<kind>" was registered as a definition rather than an instance, but it cannot run without a config bag... register <kind>({ config: { ... } }), not the defineFlow(...) result.` A definition that needs no bag is admitted as a singleton under `id = kind`. | `rg:797-817`; `rge:81-88`; **[test]** `fri:150-230` |

### 6b. Settings a copy carries (`configSchema`, `config`)

| Fact | Source |
|---|---|
| `configSchema` is what a copy may be created with. The factory's `config` is parsed against it and frozen. Blocks read it as `ctx.flow.config`. It is normalized, never persisted, never on the wire, and no part of any storage key; it stays in the process (a request that resumes after a deploy runs on the settings the process was started with). The bag is shallowly frozen: a nested object is mutable. | `ft:547-572`, `:792-801`; `blk:277-286`, `:376-400`; **[test]** `cfc:79-111` |
| Must be a plain `z.object({ ... })`. A union, an intersection or an object wrapped in `.refine()` throws where the flow is defined (`...declares a configSchema that is not an object schema...`). A `.catchall(...)` throws (`...declares a configSchema with a catchall...`; put open-ended data in one declared key whose schema is a record). | `df:258-284`; **[test]** `cfc:288-312`, `:555-563` |
| Top-level keys are closed: a key the schema does not declare throws at the factory call, `Flow "<kind>" instance "<id>" has an invalid config bag: "<key>" is not a declared setting`. A nested object is closed only if written `.strict()`; otherwise an undeclared nested key is dropped (the setting is missing, never wrong) unless a required nested key then fails the parse. | `df:299-327`; **[test]** `cfc:129-150`, `:570-615` |
| `config` on a flow with no `configSchema` throws at the factory call: `...was created with a config bag, but the flow declares no configSchema`. | `df:312-318`; **[test]** `cfc:113-127` |
| Omitting `config` parses `{}`: defaults apply, and a required setting throws at the factory call (`...was created without a config bag, and the flow's configSchema cannot be satisfied by an empty one...`). | `df:328-341`; **[test]** `cfc:239-260` |
| `configSchema` passed as an instance option throws by name (`...not an instance option... Declare "configSchema" on defineFlow(...)`). | `df:225-233`; **[test]** `cfc:275-287` |
| A block's `flowConfigSchema` declares what that block needs of any flow it is installed on. A block that reaches the flow and requires config while the flow declares no `configSchema` throws where the flow is defined (`Flow "<kind>" reaches block "<name>", which requires flow config, but the flow declares no configSchema`). A bag a block cannot read throws at the factory call naming flow, instance id and block (`...has a config bag that block "<name>" cannot read`); this is per copy, so a flow looser than a block needs is refused at the mint of each copy that omits the field and not where it is defined. A `flowConfigSchema` that would change the bag (a `.default()`, a `.transform()`, a coercion) throws at the factory call (`block "<name>" declares a flowConfigSchema that would change the bag`); the default belongs on the flow's `configSchema`. A requirement is collected from every reachable block including a tool the generator lists statically; one resolved dynamically is checked when it becomes known. | `df:372-394`; `cfc` `:801-872`, `:313-350`, `:617-800` |
| The given-versus-learned line: anything a copy is given goes in the bag; anything a copy learns goes in its own isolated state. | **[doc]** `ff:` "Copies that differ by settings"; `ft:561-562` |

### 6c. What a request names to reach one copy

| Fact | Source |
|---|---|
| Every entry point reaches an instance by its id: the HTTP action routes, the CLI, webhooks, schedules, MCP, and a queue worker. For a singleton the id is the kind (`POST /api/flows/my-chat/actions/send`, `fsdev run my-chat send`). For a collection member it is the id registered (`POST /api/flows/review-east/actions/run`). The route templates' `:flowKind` and `:flowId` segments both carry the instance id. | `ar:81-86`; `engine/src/routes/router.ts:130-135`; `rn:291-315`; `jp:325-329`; **[doc]** `ff:` "How an instance is addressed", `ds:194-204` |
| The kind of a collection is not an address. `POST /api/flows/review/actions/run` answers `404 { error: "Unknown flow \"review\"" }` when only `review-east` and `review-west` are registered, with no fallback to a copy registered first. | `ar:81-86`; **[test]** `fio:121-141` (`404`) |
| The CLI: `fsdev run <id> <action>` looks the id up in the config's registry (`Flow "<id>" not found in fsdev config (<path>). Available flows: <ids>`), or among discovered flows (`Flow "<id>" not found. Available flows: ...`); both exit `4` (`EXIT_DISCOVERY_ERROR`). | `rn:291-315`; `packages/fsdev/src/exit-codes.ts:14-20` |
| The client: `createClient(...).flow(address)`; session listing filters by `flowKind` (the definition) and `flowId` (the exact owning instance, narrower for a collection). | `cl:7-8`, `:80-91`, `:538` |
| A session and every request under it record the instance that created them (`flowId`), and the definition's kind (`flowKind`) as a label for listings. | `ro:1-21`; **[test]** `fio:143-157` |
| `GET /api/flows` lists one row per instance (`id`, `kind`, `cardinality`). Page owner: R-13. | `hh:520-537` |

### 6d. Which flow governs a record

| Fact | Source |
|---|---|
| The instance a stored record names governs it, never the one the caller addressed. Every reader that turns a stored session or request back into a flow resolves through `resolveRecordOwner`: re-entry, recovery, route authorization, state, resource and debug reads, adoption. `flowId` (the owner) is authoritative; it must resolve, and the instance's kind must equal the record's `flowKind`, else `owner-kind-mismatch`; an owner not registered in this process is `owner-not-registered`. | `ro:1-116` |
| A record with no `flowId` (written before instances had ids) belongs to the singleton whose id is its kind, and to nothing else: never to a collection member and never to a different kind whose id happens to equal the stored kind. When the kind is a collection (even with one member registered) it is `migration-required`; when the kind's address now belongs to an instance of another kind it is `migration-required`; when nothing is registered under the kind it is `owner-not-registered` (`404 Unknown flow "<id>"`). | `ro:79-116`, `:135-144`, `:156-181`; `ru:720-735`; **[test]** `fio:446-497` |
| On the action route, the principal is resolved at the addressed instance first (`flowKind: flow.id` in the resolver's envelope), then the record is admitted. | `ar:105-115` |
| At admission, a session is checked in this order: another user's session first, then another flow instance's. A session in another tenant is left alone here (the tenant binding refuses a key collision later). The same function serves a direct run and a queued one, so the order cannot differ. | `be:154-183`; `ra:1296-1303`, `:1321-1330`; `createInboundTransportHost.ts:590-640`; **[test]** `engine/test/session-owner-admission.test.ts:140-176` |
| Another user's session: `UserBindingMismatchError` (message names the session, never its owner), answered over HTTP as `404 { error: "Unknown session \"<id>\"" }`, the same as an id with no session. Org mismatch answers the same way. | `be:19-44`; `ar:278-283`; `ru:118-120` |
| Another instance's session on the action route: `409 { error: "wrong-instance-session", message: "Session \"<id>\" is not owned by flow instance \"<addressed id>\"" }`. A request id another instance owns: `409 wrong-instance-request`. A legacy owner-less record on a collection kind, or one whose address changed kind: `409 migration-required`. A request id another principal holds: `409 request-id-in-use`. Nothing is written in any of these; the refusal never names the owning instance. | `ar:285-310`; **[test]** `fio:159-193`, `:446-497` |
| An ownerless row of another kind reached through a collection member is a wrong address, `409 wrong-instance-session`, not a migration. | `ro:156-181`; **[test]** `fio:490-497` |
| `migration-required` is also the answer for a record that names no organization. The record routes (`GET`/`DELETE` of a session, its requests, state) answer `409 migration-required` for an unattributable record; they do not serve it. | `ru:735-775`; `engine/src/routes/route-auth.ts:288-345`; **[test]** `fio:446-519` |
| Routes that read a request (`stream`, `status`, `resume`) address a request through the instance: another instance's address answers `404` like an unknown request, so the instance's existence is not disclosed. `retry` and `continue` answer `400 { error: "Flow mismatch: request belongs to flow instance \"<owner>\", not \"<addressed>\"" }`. | `rr:98-111`; `rec:96-107`, `:200-210`; **[test]** `fio:414-445` |
| Programmatic entry: `runAction` rejects with `FlowInstanceBindingMismatchError` (`record: "session" \| "request"`, `recordId`, `addressedFlowId`, optional `reason`) before the user record, history or request is touched; the active registry is not written. | `be:97-133`; `ra:1321-1330`; **[test]** `fio:195-222` |
| A queue worker: a job's `flowKind` is the instance's exact id, resolved with `registry.get`; the worker does not translate it. A job naming a session or request another instance owns fails as `UnrecoverableError` (matched by the error's name `FlowInstanceBindingMismatchError`) and is not retried; nothing is written. | `jp:1-10`, `:325-330`, `:458-466`; `bmr:157` **[doc]** |
| Turning an existing flow into a collection: a job already enqueued under the bare kind finds no instance afterwards. The worker answers `Unknown flow "<kind>"` as `UnrecoverableError`, a terminal failure with no retries. The queue has to be drained before the change. Saved sessions that predate instance ids are attributed by the offline procedure in the persistence page. | `jp:325-330`; **[test]** `jpt:190-197` (unknown flow, `UnrecoverableError`); **[doc]** `bg:141`, `bmr:157` |

Not on this page: the full `409`/`404` table by route (R-13), the offline attribution procedure (R-16, persistence), what authentication admits (R-20).

## 7. Isolation flags

What the flags decide. "Cell" is the stored user or org record the flag keys.

| Flag | Value | What it does | Source |
|---|---|---|---|
| `isolateUserState` | omitted or `false` | The flow's `user` state record is the one every flow shares for that user in that organization. Its `stateSchema` joins the cross-flow check at registration: two flows declaring the same field with a different type, or the same field with a different default, are refused with `CrossFlowSchemaConflictError`; identical schemas merge; fields only one of the two flows declares, required or optional, merge with a `console.warn` (`disjoint fields`); only a shared field with a different type or default is refused. The comparison reads neither optionality nor which flow extends which. `engine/src/registry/schema-compat.ts:116-123`, `flow-registry.ts:727-732`. User-scoped resources with no `flowIsolation` of their own are shared too. | `ft:680-698`; `rg:539-570`, `:564-567`; `rge:112-170`; **[test]** `fiso:277-345`, `:286-296` |
| `isolateUserState` | `true` | The flow's `user` state record is keyed to the instance (its `id`, not its kind), so no other flow sees it and none can clash with its schema: its `stateSchema` drops out of the cross-flow check. Two copies of a collection isolate from each other as well as from other flows. User-scoped resources that do not set `flowIsolation` default to isolated. Does not move existing data: the flow starts on a fresh record and the shared one stays for the others. Renaming an instance moves its isolated data the same way. | `ft:680-698`; `sk:194-200`; `rg:564-567`; `df:1117-1142`; **[test]** `fiso:325-332`, `:1330-1377`; **[doc]** `fi:36-93`, `:115-117` |
| `isolateOrgState` | omitted, `false`, `true` | The same three states for the `org` record and org-scoped resources. Independent of `isolateUserState`: one can be isolated and the other shared. | `ft:700-701`; `sk:215-227`; **[test]** `fiso:184-198`, `:333-343`, `:1379-1420` |
| resource `flowIsolation` | `true` | That resource's data is keyed to the instance (user or org scope), whatever the flow flag says. Throws at definition on a session-scoped resource (sessions are bound to one flow already). | `sk:403-410`, `:421-433`; `df:1180-1185` |
| resource `flowIsolation` | `false` | That resource is shared across flows, even when the flow isolates the scope. It stays in the cross-flow schema check, so its schema must agree with the other flows' declarations at that storage ref. | `sk:403-410`; `rg:539-560`; **[test]** `fiso:451-475` |
| resource `flowIsolation` | omitted | Follows the flow flag for that scope (`isolateUserState` for user-scoped, `isolateOrgState` for org-scoped). | `sk:403-410`; `df:1126-1134`; **[test]** `fiso:497-516` |
| (no flag for a session-scoped resource) | | A session belongs to one flow instance. A session resource can instead be `sharedToLineage: true`, to share one copy across a session and the sessions dispatched under it; throws on user or org scope. | `df:1187-1193` |

- The flow flag governs the scope **record** (`ctx.user.state`, `ctx.org.state`), which is one blob. A resource's own `flowIsolation` always wins over the flag for that resource, in both directions. A flag that is `false` does not undo a resource that sets `flowIsolation: true`. `sk:1-25`, `:403-410`.
- The flow flag's value is the instance option, else the definition's, else `false` (`df:1456-1457`).
- "Isolated" for a collection is per instance id. For a singleton the instance id is its kind, so isolating it gives one record per user. `sk:26-41`.
- There is no flag for sharing between copies other than `flowIsolation: false` on a resource. **[doc]** `cf:` "See also".
- A shared declaration and an isolated one at the same `ref` occupy different cells and are not compared. Two declarations in one flow that resolve to one cell are compared and must agree. **[test]** `fiso:688-860`.
- Known gaps, pinned by tests as excluded: a collection pattern overlapping a concrete ref is not caught; two instances of one kind with differing per-instance `resources` overrides are not compared (same-kind pairs are skipped). **[test]** `fiso:1090-1143`.
- Registering a flow whose kind a registry once held, unregistering it, and registering a different definition under the same kind is admitted; the stale schema stays in the cross-flow view until restart. **[test]** `registry/runtime-registration.test.ts:176-231`.

### Cross-flow guardrail, as a reader sees it

- Fires when a flow is registered, so at startup for `createFlowState({ flows })` and at the call for a runtime `register`. `rg:212-243`.
- Throws `CrossFlowSchemaConflictError`, named flows, the scope (`user` or `org`), the field (`stateSchema` or `resources.<ref>`) and the reason (`incompatible-shape`, `incompatible-types`, `secret-mismatch`, `incompatible-default`). The message ends with the remedy: `Set isolateUserState: true on one of the flows to opt out of cross-flow sharing, or reconcile the schemas.` (`isolateOrgState` for org; `flowIsolation: true` on that resource, or a distinct `ref` (a distinct `pattern` for a collection), for a resource). `rge:112-170`; `engine/src/registry/schema-compat.ts:1-80`; **[test]** `fiso:298-343`.
- A failed registration leaves the registry as it was, including when the org check fails after the user check passed. **[test]** `fiso:344-381`.

## 8. Lifecycle hooks

Hooks are blocks. `request.onStarted`, `onCompleted`, `onErrored`, `onFinished` and the action's `onCompleted`, `onErrored` each take a `BlockDefinition` (for example a `handler`), not a function. `ft:210-211`, `:417-420`; `ra:824-858` (`runObserver` executes `block: observer`). Each runs as its own block beside the action's block, on its own path, and what the action's block emitted stays in the session's items. **[test]** `ro-t:1-60`. They observe: nothing they return changes the request's result. Past-tense names. The hook's input is one object, below.

| Hook | Fires | Input | If it throws | Source |
|---|---|---|---|---|
| `request.onStarted` | When the request starts, before the action's block. | `{ requestId, actionName }` | The failure propagates: `runAction` rejects with it. | `ra:2399-2403`; **[test]** `rae:68-102` |
| `action.onCompleted` | After the block returns, when the request ends `completed`. Not for `incomplete`, `failed`, `aborted`, `interrupted`. Runs before the request hook. | `{ requestId, actionName, output }` | Propagates as a failure of the request (the call is inside the request's own try) **[source]**. | `ra:2813-2818` |
| `request.onCompleted` | Same condition, after `action.onCompleted`. | `{ requestId, actionName, output }` | Same. | `ra:2820-2824`; **[test]** `ex:2207-2315` (order `request.started, action.completed, request.completed, request.finished:completed`) |
| `action.onErrored` | When the request fails. | `{ requestId, actionName, error }` (a normalized `FlowError`) | Swallowed: the primary failure is kept. | `ra:3298-3302`; **[test]** `rae:105-160` |
| `request.onErrored` | When the request fails, after `action.onErrored`. | same | Swallowed. | `ra:3304-3308`; **[test]** `ex:2207-2315` (order `request.started, action.errored, request.errored, request.finished:failed`) |
| `request.onFinished` | Once per request run that ends, whatever the ending, after the terminal status is recorded and emitted: `completed`, `incomplete`, `failed`, `aborted`, `interrupted`. After `onCompleted` or `onErrored` when those run. | `{ requestId, actionName, status, output? }` for `completed`/`incomplete`; `{ requestId, actionName, status: "failed", error }`; `{ requestId, actionName, status: "aborted" }`; `{ requestId, actionName, status: "interrupted" }` | On `failed`, `aborted` and `interrupted` a throw is swallowed. On `completed` it is not swallowed (the success path awaits it with propagation) **[source]**; not pinned by a test. | `ra:2964-2969`, `:3219-3223`, `:3257-3261`, `:3311-3316`; **[test]** `ab:2412-2468` (an aborted request runs only `request.finished:aborted`), `ab:2473-2530` |
| `request.onStepErrored` | **Never.** See section 12. | none | n/a | no reader of `onStepErrored` in `packages/engine/src` |

- A request that suspends at a gate (`ctx.suspend`) ends the run with status `suspended`; the `onCompleted`, `onErrored` and `onFinished` hooks do not run at that point, and no completion hook runs until a resumed run ends. `ra:2606-2630` (the suspend branch settles the record and returns); **[source]**. Whether `onStarted` runs again for the resumed run is not guarded by replay mode in the code (`ra:2399-2403`) and no test pins it; do not state it.
- Order on success: `onStarted`, block, `action.onCompleted`, `request.onCompleted`, `onFinished`. On failure: `onStarted`, block, `action.onErrored`, `request.onErrored`, `onFinished`. **[test]** `ex:2207-2315`.
- On `completed`, `onFinished` runs after the record is settled `completed` and the final status event is emitted; the request's record is not evictable until `onFinished` and the side-chain work it queued have finished. `ra:2964-2985`; **[test]** `rfz:67-130`, `:128-`.
- Side-chain work queued by `onCompleted`, `onErrored` or `onFinished` is waited for before the request settles. `ra:2845`, `:2975`, `:3329`; **[test]** `ab:2650-2700`, `rfz:128`.
- A cancel accepted before the completion hooks (during the side-chain drain) ends the request `aborted` and skips `onCompleted`; `onFinished` reports `aborted` and fires exactly once. `ra:2792-2796`, `:2813`; **[test]** `ab:2412-2468`.
- A token budget with `onExceeded: "stop"` ends `incomplete`: `onCompleted` hooks do not run; `onFinished` does with status `incomplete`. `ra:2751-2753`, `:2813`; **[test]** `rae:446-499`.
- A hook that is not a block (a plain function, as `ff:` shows in its hooks examples) is not what the engine runs. **[ran]** a plain function in each of `request.onStarted`, `onCompleted`, `onErrored` and `onFinished` made `defineFlow(...)` throw `TypeError: Cannot read properties of undefined (reading 'flowConfigSchema')` at definition (throwaway probe test, deleted). The page states only the `request` hooks. Section 12.
- Block-level `onCompleted` on a block's own config is a different hook (fires after that block's `execute` succeeds; generators also get `meta.model`). Page owner: R-01. **[doc]** `ff:` "Block-level completion". Not re-verified here.
- Tool hooks `tools.onToolStarted`, `onToolCompleted`, `onToolErrored` are a separate set. Section 1.

## 9. The three lookups

**What does a request name to reach one copy of a flow?** The copy's instance id, in the segment after `/api/flows` (`POST /api/flows/<id>/actions/<action>`, `POST /api/flows/<id>/<sessionId>/actions/<action>`), `client.flow("<id>")`, `fsdev run <id> <action>`, and a queue job's `flowKind`. A singleton's id is its kind. A collection member's id is the `id` it was created with, and the bare kind is a `404`. Section 6c. After the first request the stored session names its instance, and a later request that names another instance is `409 wrong-instance-session`. Section 6d.

**When does `onFinished` fire?** Once when a request's run ends, whether it ended `completed`, `incomplete`, `failed`, `aborted` or `interrupted`, after the terminal status is recorded and emitted and after `onCompleted` or `onErrored` where those run. Its input carries `status`, plus `output` or `error`. It does not fire when a request suspends at a gate; it fires when the resumed run ends. On a failed, aborted or interrupted request an error thrown in it is swallowed. Section 8.

**What does `isolateUserState` change?** Where the flow's `user` state record is stored and who shares it. `false` (default): one record per user per organization, shared by every flow, so every flow's user schema must be compatible (checked at registration). `true`: a record per user per organization **per flow instance**, which no other flow or copy reads or clashes with, and the flow's user schema is left out of the cross-flow check. It also sets the default `flowIsolation` for user-scoped resources that do not set their own; a resource's own `flowIsolation` always wins. It moves no existing data. Section 7.

## 10. Stored parts: who owns, who can see, where, how many

The page states things that are stored: the session and request records, the user and org records, and the instance settings. Resources are R-08's and are not repeated here beyond `flowIsolation`.

| Part | Owner | Who can see it | Where it is stored | How many | Source |
|---|---|---|---|---|---|
| Session record (state, metadata, `latestRequestId`, `flowKind`, `flowId`, `lineageId`) | The user who created it, in one organization (and tenant, if any), under one flow instance (`flowId`). Fixed for the session's life: another user, org, tenant or instance is refused. | Its owning user. Another user's session answers like an id with no session (`404`). A client sees only the state fields named in `session.client.expose` plus readonly fields, and never the journal or stored resources. | The session store, keyed by the session id, prefixed `<tenantId>:` when a tenant header is present. In-memory unless the app names stores. | One per session id. Many per user and per flow; a user has as many as they create. A deleted id can be created again and starts from what its own create names. | `be:19-95`; `sk:229-250`; `cs:1-55`; `sb:60-97` |
| Request record (status, items, event log, `flowKind`, `flowId`) | The principal that started it, under the instance that ran it. | The owning user (a request another user owns reads as not found). A resume, status or stream read through another instance reads as not found. | The request store. Past turns are evicted by `retention`; a deleted request's events and cached step results go with it. | One per request; many per session. | `rr:98-111`; `rs:135-165`; `ret:93-240` |
| User record (`ctx.user.state`) | The user in one organization. Shared by every flow by default, or one per instance with `isolateUserState`. | That user. A client sees the fields in `user.client.expose` through the state read. Another organization's runs read a different record, so what a flow saves for a user in one organization is not what any flow reads for them in another. | The user store, keyed `<userId>:~org:<orgId>`, plus `:<instanceId>` when isolated (each part escaped). | One per user per organization (shared); one per user per organization per instance (isolated). | `sk:43-57`, `:165-200`; `sro:93-103`; **[test]** `uc:221-243`, `fiso:1277-1377` |
| Org record (`ctx.org.state`) | The organization. Shared, or per instance with `isolateOrgState`. | Members' runs of the flows that read it. A client sees `org.client.expose` fields. | The org store, keyed `<orgId>`, plus `:<instanceId>` when isolated. | One per organization (shared); one per organization per instance (isolated). | `sk:215-227`; **[test]** `fiso:1379-1420` |
| Instance settings (`config`) | The registered copy. | Blocks of that copy, through `ctx.flow.config`. Not in any listing, not on the wire. | Process memory only; not stored. | One bag per copy; frozen for its life. | `ft:792-801`; `blk:376-400` |
| Registered instances | The process that registered them. | Callers the instance's `ownerPin` (if any) admits; `GET /api/flows` lists the rest. | In memory, in the registry. Not persisted. | One per instance id. | `rg:94-154`; `hh:1001-1026` |

`isolateUserState: true` and a renamed instance both point at a different record; the earlier one stays on disk and is no longer read. **[doc]** `fi:91-93`, `:115-117`.

## 11. Dispositions of the rows other pages moved to R-05

The list comes from `grep -rhE --include=*.record.md -e '→ R-05( \(corrected by pass 5\))?$' docs/contributing/docs-revamp/pages` (22 rows). Each was checked against the code. Every row is carried unless it says otherwise.

| # | Row (short) | Disposition |
|---|---|---|
| 1 | Action fields: bare block or `{ block, ... }`; each optional field with type and default | **Carried**, section 2. Corrected: `userMessage` returns `string \| { text, metadata?, attachments? }`, not just a string; `taskOf` and `autoResume` are fields too; `description` defaults to the block's. |
| 2 | `inputSchema` defaults to the block's; input checked before the block runs | **Carried**, section 2. Added: a failure is a failed request (`validation_error`), not an HTTP `400`; **[ran]**. `fa:` says "Bad input returns 400"; the code does not (section 12). |
| 3 | Shared user record rule; `isolateUserState` gives a record of its own | **Carried**, sections 7, 9, 10. Detail the row lacked: the check also refuses a field with a different default, and a schema one flow extends merges with a warning; the record is per user **and organization**. |
| 4 | Client exposure per scope; request state has no client config | **Carried**, section 3. Corrected: `derived` no longer exists (throws); session state also reaches the client through `.readonly()` fields. |
| 5 | `internal.actions`: not callable by any client; reachable only through `dispatcher()` in the same flow | **Carried and corrected**, section 4a. A `dispatcher({ flowKind })` in another flow can reach this flow's `internal` entry, refused by name (`flow-not-found`, `no-entry`) when absent. "In the same flow" is the default and the only case `defineFlow` checks. |
| 6 | `schedules` flow fields `resolve`, `index`, `static`; clock fires only an index the flow names | **Carried**, section 4b. Precise rule: the tick fires static schedules and index entries; a flow with only `resolve` is never ticked. `ScheduleConfig` field definitions belong to R-33 and are **not** carried here. |
| 7 | `retention` and `historyWindow`: defaults, what is evicted and when | **Carried**, sections 5a and 5b. |
| 8 | Top-level `requireUser` and its precedence against `authentication.requireUser` | **Carried**, section 1. The full ladder is instance `authentication.requireUser`, definition `authentication.requireUser`, instance `requireUser`, definition `requireUser`, `true`; `false` also forbids user-scope declarations. |
| 9 | Per-field merge of `authentication` from instance over definition | **Carried**, section 1 (`authentication` row). **[source]** only: no test pins the merge. |
| 10 | Which flow governs a record (corrected by pass 5) | **Carried**, section 6d. Corrected once more: the ownerless-row rule is "the singleton whose id is its kind"; it is `migration-required` when the kind is a collection even with **one** member registered, not only "several instances" (`fio:446-497`). An organization-less record is also `migration-required`. |
| 11 | Session settings: how an initial seed is checked; racing creates; refusal when initial state is required; the CLI keeps `--seed-session` | **Carried**, section 5a "Initial state". |
| 12 | Running several copies: what a request must name; singleton kind versus member id | **Carried**, sections 6c and 9. |
| 13 | Flow definition rows: what makes a module a flow; duplicate-id behaviour | **Carried**, section 13 (flow discovery) and section 6a. Two different duplicate behaviours: `createFlowState`/registry refuse, directory discovery keeps the first. |
| 14 | Action fields: input schema, hooks, token budget, durability | **Carried**, sections 2, 2a, 8. |
| 15 | Instance cardinality: `singleton` defaults id to kind; `collection` needs an id | **Carried**, section 6a. |
| 16 | Scope and flow isolation: `true`, `false`, omitted, per tier | **Carried**, section 7. "Per tier" here is per resource scope (user, org) and per resource: `isolateUserState` and `isolateOrgState` for the record, `flowIsolation` per resource, and a session-scoped resource refuses the flag. Memory's four tiers are resources and follow the resource rows. |
| 17 | `autoResume` default true; when false, `latestRequestId` stays on the earlier request | **Carried**, section 2. |
| 18 | `defineFlow` dev warning for a generator action with no `itemVisibility` | **Carried**, section 14. |
| 19 | `schedules` `resolve` and `index` | **Carried** (same as row 6). |
| 20 | Instance binding: stamped session and request; `FlowInstanceBindingMismatchError` before the action starts; user check first with `UserBindingMismatchError` (corrected by pass 5) | **Carried**, section 6d. Both errors verified. Over HTTP the first is `409 wrong-instance-session` and the second is `404 Unknown session`. |
| 21 | Enqueued job fields: `flowKind` addresses an instance; a job naming another instance's session fails unrecoverable and writes nothing | **Carried in part**, section 6d (the `flowKind` address and the refusal). **Dropped:** the other `FlowJobData` fields (`actionName`, `input`, `userId`, `sessionId`, `orgId`, `tenantId`, `source`, `metadata`, `attachments`, `requestId`, lease fields): they are the job's shape (`packages/bullmq/src/types.ts:17-50`), not a flow setting, and belong to the BullMQ/background-work page. The "writes nothing" half is pinned for the engine's admission (`fio`) and is **[source]** for the worker (`jp:458-466`). |
| 22 | Jobs enqueued under a bare kind after the flow becomes a collection: what happens, what to do first | **Carried**, section 6d. A job that is already queued fails `Unknown flow "<kind>"` as `UnrecoverableError` (no retries); drain the queue before making the change. **[test]** `jpt:190-197`; **[doc]** `bg:141`. |

Dropped from the existing pages (things the old pages say that the code does not support), each with its reason:

- `onStepErrored` as a working request hook. Nothing runs it (section 12).
- `session.client.derived` and `reads`. Both refused at definition (section 12).
- Hooks written as functions (`onCompleted: async (result, ctx) => ...`). The engine runs blocks.
- `cron` as "display-only. The host scheduler fires; the framework does not". The engine's tick fires static schedules (R-33 owns the rest of `ScheduleConfig`).
- "Bad input returns 400" on the action route.

## 12. Contradictions found: existing docs against the code

The code wins. Each is something the old pages state that the code contradicts, so the page must not repeat it.

1. **Hooks are blocks, not functions.** `ff:` "Actions", "Lifecycle hooks" show `onCompleted: async (result, ctx) => {}`, `onErrored: async (error, ctx) => {}`, `onStarted: async (ctx) => {}`. `cf:127`, `:197` say `BlockDefinition`, which is right. The types accept only `BlockDefinition` (`ft:210-211`, `:417-421`) and `runObserver` calls `executeBlock({ block: observer, input })` with the input object `{ requestId, actionName, ... }` (`ra:824-858`).
2. **`onStepErrored` never runs.** It is declared (`ft:421`), its block is collected into the flow's reachable blocks (`df:741`), and there is no other reader in `packages/engine/src`, `packages/core/src`, or any test or goal. `cf:197` lists it as a request lifecycle hook and `ff:` describes it as "non-terminal step failure". Do not list it as firing.
3. **`session.client.derived` is refused.** `cf:182` documents `{ expose?, derived? }` and `ff:` "Session configuration" has a `derived` example. `defineFlow` throws `<scope>.client declares "derived", which was removed. Declare a view instead...` (`df:97-104`; **[test]** `cft:996-1011`).
4. **`reads` is refused.** `ff:` "Reads: looking without storing" shows `reads: { tasks: { block } }` and `client.flow("board").read(...)`. `defineFlow` throws `Flow "<kind>" declares "reads", which was removed. Declare each as a view instead` (`df:858-865`). **[source]**
5. **`cron` is not display-only.** `cf:240` and `sch:142-146` say the framework does not run the schedule; the engine's tick enqueues every enabled static schedule whose latest due time passed (`tick:100-112`), while `sch:1-17` (the same file's header) says the tick fires static and dynamic schedules. A mistake in `sch` and `cf`; R-33 owns the field.
6. **`internal.actions` "same flow".** Section 4a: a `dispatcher({ flowKind })` can address another flow's internal entry.
7. **`userMessage` type.** `cf:123` says `(input) => string`. The type is `string \| { text, metadata?, attachments? }` (`ft:172-187`, `:219`).
8. **Bad action input is not an HTTP `400`.** `fa:` "How an action executes" step 1 says "Bad input returns 400". The route does not read the schema; the request is accepted `202` and fails with `validation_error` (`ar:77-330` has no input parsing; `ra:412-427`; **[ran]** probe above; **[test]** `rae:40-66`).
9. **`ctx.flow.config` is the only `ctx.flow` member.** `ff:` is consistent; mentioned so the page does not add `ctx.flow.id` or `ctx.flow.kind`, which the code does not expose (`blk:277-286`).
10. **Dev-only wording.** `ff:` and `cf:` do not mention the silent-generator warning (section 14); `ds:` does not either. Not a contradiction; the row is new on this page.

## 13. Flow definition rows: what counts as a flow, and duplicate ids

| Where | Rule | Source |
|---|---|---|
| `createFlowState({ flows: [...] })` | A list of `FlowInstance`s (call the factory; `export default chatFlow()`). Each is served under its own `flow.id`; two with one id throw at construction (`FlowIdentityConflictError`, reason `duplicate-id`). A `defineFlow(...)` result handed in place of an instance is admitted only when its `cardinality` is singleton and its `configSchema` (if any) parses `{}`; otherwise `unminted-config`. | `fst:150-157`; `cfs:403-416`; `rg:786-870`; **[test]** `fri:129-230` |
| Directory discovery (`fsdev run`/`dev` with no config) | Scans `src/flows` and `flows`, then one level into `packages/*`, `examples/*`, `apps/*`, `labs/*` for `src/flows` and `flows`. In a flows folder: each `.ts` or `.js` file directly inside, and each subfolder's `flow.ts`, `flow.js`, `index.ts` or `index.js`. The module's **default export** counts as a flow when it is an object with a string `kind` and an object `actions` (`isFlowInstance`); a callable `defineFlow(...)` (a function) does not. A module that imports fine and exports no flow is skipped silently; one that throws on import is reported (stderr warning, and in the "not found" error) and discovery continues, and for a subfolder a failing candidate stops the fallthrough to the next. Duplicates are de-duplicated by **instance id, first discovered wins**, silently; two instances of one kind with distinct ids are both kept. | `rf:19-29`, `:32`, `:38`, `:75-121`, `:163-210`, `:223-235`; **[test]** `packages/fsdev/test/discovery-import-failures.test.ts:60-135` |
| `fsdev.config.*` | Must default-export a `FlowState`; its registry is used and discovery does not run (`--flow-dir` is refused with a config). | `packages/fsdev/src/resolve-runtime.ts:119-150` |
| `resolveFlow(path)` | One file; missing default export or a default export that is not a flow instance (a `kind` and `actions`) is an error: `Default export is not a valid FlowInstance (must have kind and actions): <path>`; exit `4` (`EXIT_DISCOVERY_ERROR`). | `rf:270-300`; `packages/fsdev/src/exit-codes.ts:18` |

## 14. `defineFlow` development warning: generator action with no `itemVisibility`

- Fires for a **caller** action (an entry of `actions`) whose block is itself a generator and whose config sets no `itemVisibility`: the generator emits no items, so a chat mounted on the action renders nothing. `df:547-573`.
- Message: `Flow "<kind>" action "<name>" runs generator "<block name>" with no \`itemVisibility\`, so it emits no items and a chat on this action renders nothing. Set \`itemVisibility: { client: true, history: true }\` to show its reply in chat, or \`itemVisibility: { client: false, history: false }\` to keep it headless on purpose.`, prefixed `[flow-state-dev]`, via `console.warn`. `df:565-571`; `dep:11-37`.
- When it fires: once per process per flow kind and action, when the flow is built (defining it, or calling the factory), including for an action an instance override adds. Not again for the same kind and action. **[test]** `sga:41-62`.
- When it does not: a generator that sets `itemVisibility` in any form; a handler action; `internal`, `task`, webhook and schedule entries; a sequencer whose generator steps are silent (only a generator that **is** the action's block is checked, so "no warning" does not prove the action renders); `NODE_ENV=production`; `FSD_QUIET_WARNINGS=1`. **[test]** `sga:64-96`; `dep:11-37`; `df:547-559`.
- A warning, never a throw: a headless generator action is legitimate.

## 15. Facts left out of the page on purpose, and why

- Webhook bindings (R-32), `ScheduleConfig` fields (R-33), MCP wire behaviour (R-34), authentication resolution (R-20), concurrency policies (R-18), durable execution and resume (R-17), stores and the persistence cutover (R-16), HTTP route status tables (R-13). Each gets a row or a link only.
- Mechanism not observable by a caller: the encoding of storage keys (`encodeScopeKeyComponent`), the order of the abort poll, the retention batch size, the stale-request sweep. The user-record key shape in section 10 is **[source]** and is named only to answer "where stored"; the page may say "one record per user per organization (and per instance when isolated)" without the key.
- `InstanceOwnerPin` internals (R-20).
- The two-copies-of-one-kind gap (`fiso:1113-1143`) is a known limitation and the page may state it as a limit.

## 16. Open items the page must not state without a pin

- Whether `request.onStarted` fires again for a resumed run (`ra:2399-2403` has no replay guard; untested).
- What a throwing `onCompleted` or success-path `onFinished` does to the request record (the call sits inside the request's own try; untested; section 8 rows).
- Per-field `authentication` merge (section 1; **[source]** only).
- The worker-side "writes nothing" half of the queue-job refusal (**[source]** `jp:458-466`; the engine admission is pinned by `fio:159-222`).

## 17. Revise round 1: what changed on the page, and where each moved row now lives

- Both examples type-check (strict, bundler resolution, workspace packages) now that `src/flows/support/blocks/reply.ts` and `blocks/audit-reply.ts` are on the page. Both are `handler` blocks; `auditReply` is the `request.onFinished` hook, whose input carries `requestId` and `status`. **[ran]** `tsc` exit 0 on the four files, scratch folder deleted.
- The ownerless-record rule (row above, `ro:79-144`) is not on the page: a reader starting today never has a record without a `flowId`. An ownerless record of a registered singleton kind is served as that singleton's; `409 migration-required` comes only when the kind is registered only as a collection, or the singleton at that address now has another kind. Detail by case: R-13 and R-20.
- `requireUser` order and the user-state refusal (sections 1 and 11, row 8): R-20 `authentication` "`requireUser` and `defaultUserId`" (`authentication.md` lines 111 and 145). The page keeps a row and a link.
- `dispatcher()` resolution and `DispatchRefusedError` (section 4a): R-19 `background-work` "Dispatch" and "Refusals". Default `concurrency: "queue"` on a shared child session: R-23 `task-board` "Concurrency" (line 209). The page keeps one sentence and links.
- `schedules` keys and which flows the tick reaches (section 4b): R-33 `schedules` "The flow's `schedules` option" and "What calls the tick?" (a flow with `resolve` and no `index` is never ticked, line 202). The page keeps the three key names and links.
- Ownership table of stored parts (section 10): R-16 `stores` "What each stored part is". Instance settings stay on this page under "Settings a copy carries" (Storage row).
- `createFlowState({ flows })` list shape, the keyed-record error, `register` and `unregister` (section 6a): R-12 `runtime` (not yet written; the link is a sitemap slug). The page keeps the list shape in one sentence.
- Ways in by instance id, the `404` body for a collection's bare kind, the `GET /api/flows` rows, the queue job `UnrecoverableError` cases and the status table of "Which flow governs a record" (sections 6c and 6d): R-13 `http-api` "Reaching one copy of a flow" and "What a wrong session returns", R-19 `background-work` "Queued runs", R-20 `authentication`. The page keeps the way-in table, the bare-kind rule and the `FlowInstanceBindingMismatchError` shape, which no other page lists.
- Resource `flowIsolation` precedence, the session-scope throw and `sharedToLineage` (section 7): R-08 `resources` "Scopes and sharing" (lines 154-157). One row here.
- Block-level `onCompleted` and the tool hooks (section 8, last two bullets): R-01 `blocks`. A clause and a link.
- Directory discovery paths and the import-failure warning (section 13): R-35 `cli` "Flow discovery". The page keeps what makes a module a flow and the duplicate rule, because `cli.md` sends that question back to this page, plus the single-file error and exit `4`, which `cli.md` does not give.
- The "Three lookups" section is cut. Its answers are the isolation table, the hook table and the ways-in table.
- `historyWindow`: the sentence about capping the store read is cut as mechanism. `mutationTimeoutMs`: "target and sequencer scopes" is now "the state `ctx.targets` and `ctx.sequencer` address" (`ft:454-470` names target and sequencer scopes; `apps/docs/docs/fundamentals/blocks.md:608` shows `ctx.targets`). Retention "owed a re-drive" is now "one the server will run again after a crash".
- Declined: `configSchema` definition and instance properties moved to R-38 (section 1b): no R-38 page exists to carry `requiresConfig`, so the sentence stays.
