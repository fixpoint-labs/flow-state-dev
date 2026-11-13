# Facts for Kits and slots (C-12, concept)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests, `goals/`, one example. No spec is cited. The one exception (a surface specified and not yet built) is used only for public names, and each is marked **[reconcile]**.

Paths are from the repo root. Abbreviations:

- `dk` = `packages/core/src/kit/define-kit.ts`
- `ki` = `packages/core/src/kit/index.ts`
- `ct` = `packages/core/src/index.ts`
- `ft` = `packages/core/src/types/flow.ts`
- `ty` = `packages/engine/src/flowstate/types.ts`
- `kp` = `packages/engine/src/flowstate/kits.ts`
- `cl` = `packages/engine/src/folder/claim.ts`
- `wk` = `packages/engine/src/folder/walk.ts`
- `dt` = `packages/core/test/define-kit.test.ts`
- `et` = `packages/engine/test/flowstate/kits.test.ts`
- `goal` = `goals/kits/install-in-any-order/goal.md`
- `cap` = `apps/docs/docs/fundamentals/capabilities.md`
- `hf` = `docs/contributing/docs-revamp/pages/concepts/how-it-fits-together.md` (a revamp draft; read only so the two pages agree)
- `ex` = `examples/hello-chat/fsdev.config.ts`

Legend: **[page]** the page states it. **[ref]** it belongs on `reference/kits`; the page links, does not state it. **[reconcile]** a name from a surface specified and not yet built; keep it on the page only as the plan's illustration and mark it for cutover. **[verify]** not confirmed by a test or contradicts the plan; keep off the page until settled.

There is no existing user page about kits. `apps/docs` has no `defineKit` or `kits` mention (grep of `apps/docs/docs`, `apps/docs/guides`: none).

## Flags against the page plan (read first)

1. **`workforce()`, `harnesses()` and `claudeCode()` are not built.** No source file under `packages/*/src` exports a factory by those names; the only `defineKit` callers are tests and goal fixtures (grep of `packages/*/src`: `defineKit` appears only in `packages/core/src/kit/` and in `ty:128`'s doc comment). The chain figure and question 1 and 3 can name them only as the plan's illustration, marked **[reconcile]**. Everything the page *explains* (slots, `requires`, `contributes`, `fill`, order, the folder) is built and tested with made-up kits (`et:36-78`).
2. **What the doc comments themselves show of the chain (citable, public surface):** a kit contributes to another kit's slot by the key the owner's factory carries: `{ [workforce.slots.workerFlows]: { coder: coderFlow(config) } }` for a keyed slot (`dk:125-130`); the app fills a slot with `fill: { [harnesses.slots.harnesses]: [codexHarness(), cursorHarness()] }` (`ty:140-145`); an app lists `createFlowState({ kits: [workforce({ model }), harnesses({})] })` (`dk:5`). That gives: `workforce` declares `workerFlows`; a kit (here, the harnesses kit) puts a `coder` flow in it; `harnesses` declares a `harnesses` slot that the app fills with Codex and Cursor entries. **[reconcile]** All three spellings. The doc comments say `workforce({ model })`; the config keys are settled at FIX-2705, so the page should not show `workforce`'s options beyond what the page needs.
3. **`claudeCode()` as the kit that fills the harnesses slot appears only in the page plan**, not in any doc comment or test. Keep it **[reconcile]** and in the figure only.
4. **Question 3, "Codex beside Claude Code."** From the surface: the slot is the harnesses kit's (`harnesses.slots.harnesses`, `ty:141`), and it is filled from the app's `fill` (`ty:140-145`, `et:92-106`) or by a kit that requires the harnesses kit (`dk:121-123`, `kp:139-142`). It is not workforce's slot. Whether Claude Code is already filled by `claudeCode()` is **[reconcile]**.
5. **Import path of the three kits is unknown.** `defineKit` and `slot` import from `@flow-state-dev/core` (`ct:112-113`); `createFlowState` from `@flow-state-dev/engine` (`ex:13`). The hello-chat example's config imports `createFlowState` from the engine and `@flow-state-dev/workforce` is the plan's path for `workforce` in `hf:28`. Any other path for `harnesses` or `claudeCode` is **[reconcile]**; the page should not print one.
6. **A runnable example needs a made-up kit.** `defineFlow({ kind, actions: {} })()` is the tests' flow (`et:25`); a flow with no actions is legal but teaches nothing, so a page example needs a real flow. The page's example app is `help-desk` (`hf:28-33`).
7. **Question 5 (kit, capability or flow) is judgement over cited definitions**, not a stated rule anywhere. The sheet gives the definitions below; the page's answer is derived from them.

## 1. What a kit is (opening)

- A kit is a feature an app installs with one config object: `createFlowState({ kits: [workforce({ model }), harnesses({})] })`. `dk:4-6`. [page]
- A kit "declares what it needs (`config`, the kits it `requires`), the typed places other kits fill (`slots`), what it fills in the kits it requires (`contributes`), an optional folder it owns in the app (`directory`), and an `install` that returns the flows it serves." `dk:6-9`. [page]
- The kit "composes existing pieces: resources, views and capabilities ride on the flows the install returns." `dk:9-11`. A flow declares `views` (`ft:619-624`). [page]
- A kit's definition is safe to import anywhere; only its folder reader, which runs on the server at start-up, touches the file system. `dk:12-15`, `dk:141-142`. [ref]
- `defineKit(definition)` returns the kit's factory. The app calls it with the kit's config and lists the result in `kits`. `dk:203-206`. [page]
- A kit's name is lowercase letters, digits and single hyphens, at most 64 characters, not reserved, and unique in an app. It is half of every slot key, joined with a `.`. `dk:117`, `dk:219-225`; refused: `dt:24-27`. [ref]
- `kits` is a list of `KitInstance`; each kit's flows are served beside the app's own `flows`. `ty:127-131`; test `et:92-106` (`["app-flow","b-flow","c-flow"]`). [page]
- Kits are listed in `createFlowState`, which an app's `fsdev.config.ts` default-exports. `ex:15-21`; `hf:28-37`. [page]

### Kit, capability, flow (question 5)

- A capability "is a bundle of resources, state, helpers, and block-level configuration packaged under one name"; a block installs it by listing it in `uses`. `cap:6-8`. [page]
- A flow is "a self-contained system inside your app, registered with the server for clients to call. It names its actions." `hf:42`. [page]
- A kit is the unit an app installs from its config; its `install` returns flows, so a kit holds flows and what rides on them. `dk:4-11`. [page]
- A kit can do what neither of the others does: declare slots, fill another kit's slots, own a folder in the app, check a config at the app's own call (`dk:6-9`, `dk:240-256`). [page]
- Derived for the page (**not stated anywhere**; check it reads true against the above): packaging a feature for other apps, a piece a block pulls in with `uses` is a capability; a feature that serves its own flows, takes config, reads a folder or leaves openings is a kit; one flow alone is a flow an app lists in `flows`.

## 2. What a kit brings into an app (second figure)

- Flows: the kit's `install` returns `{ flows }`. `dk:95-98`, `dk:148-151`. Served beside the app's `flows`. `ty:130-131`, `et:92-106`. [page]
- Registered at start-up, not at construction: after `new`, `state.meta.flowKeys` is `[]`; after `ready()` it holds `b-flow`. `et:108-114`. [page, one clause]
- A config, checked when the app calls the kit's factory: a bad config fails at the app's own call, "its config is invalid: greeting: ...". `dk:249-256`; `dt:29-38`. A kit with no config schema refuses any given: `kit "plain" takes no config, but was given "model"`. `dk:258-262`; `dt:40-44`. The config is what the schema parsed, defaults applied. `dt:35`. [page: one sentence; ref: the options]
- A folder it owns (optional): `directory: { path, read }`. `dk:138-147`. [page]
  - Its default `path` is read against the app's root (`root` option; defaults to the working directory). `dk:139-141`, `ty:147-153`, `kp:237-248`; test `et:325-331`. [page]
  - The app overrides it with `directory` in the kit's config, read against the working directory instead. `dk:141-143`, `dk:90-91`, `dk:155-163`, `ty:150-152`; tests `et:333-346`, `goal:12` (`c:relative`). [ref]
  - A kit that owns no folder refuses a `directory` in its config: "`directory` is set, but this kit owns no folder." `dk:242-244`; `dt:43`. [ref]
  - Every entry in the folder is used or the app does not start: the reader claims what it consumed; "anything left unclaimed (except the names that never mean anything, such as `.DS_Store`) stops the app starting, each named." `dk:70-75`; `cl:1-8`. Ignored names: `.DS_Store`, `Thumbs.db`. `wk:22`. [page: the one sentence; ref: the rest]
  - Test: a folder holding `greeting.txt` (used), `notes.txt` and `old/draft.md` (not): `ready()` rejects naming `"notes.txt"` and `"old"`, installs nothing, and every later entry point (`getRuntime()`) rejects the same. `et:348-364`. Goal `b:stray` (`goal:11`). [page, one clause]
  - The folder is read before any install runs, and every refused entry across every kit is named in one error. `kp:263-290`. [ref]
  - A symlink anywhere in it is refused, claimed or not. `dk:83-84`; `cl:14-17`; `et:366-380` (`..` through a symlink). [ref]
  - A missing folder is named missing, not as an unused file. `et:382-391`. [ref]
  - Two kits reading one folder are refused: `kits "notes" and "other" both read the folder`. `kp:250-254`; `et:393-404`. [ref]
- Views: "resources, views and capabilities ride on the flows the install returns" (`dk:9-11`), and a view is declared on a flow (`ft:619-624`). What a view reads is on the Views page (`views.facts.md`). [page: one clause, link]
- Slots it declares and slots it fills: section 3.

### Four questions, for each stored part

A kit itself stores nothing: the plan (order, merged slots, folders) is held in memory by the engine and rebuilt at every start (`kp:26-34`, `kp:106-261`; installed at `ready()`, `et:108-114`). The stored parts a kit touches:

| Part | Who owns it | Who can see it | Where it is stored | How many |
|---|---|---|---|---|
| **The kit's folder** (files, for example `workforce/` of `WORKER.md` files) | The app: the files are in the app's repo, in the folder named by the kit's `directory.path` or the app's `directory` override. `dk:138-147`, `kp:237-249` | Whoever can read the app's files. The reader runs on the server at start-up. `dk:141-142`. Nothing in it is sent to a browser by the kit: a kit "has no client half" is stated only in the contributor glossary, so the page must not say it. **[verify]** | On disk in the app, read at start-up and not written back. `kp:268-290` | One folder per kit; the same folder for two kits is refused. `kp:250-254` |
| **The kit's config** | The app, in its config file | The server's process | In memory, as parsed by the kit's schema, per `KitInstance`. `dk:263`; `dt:35` | One per kit: a kit listed twice is refused, "a kit installs once per app". `kp:59-61`; `et:299-303` |
| **Slot entries** | The kit or app that gave each entry; the slot belongs to the kit that declared it. `dk:122-123` | The server; the owner kit's `install` receives the merged entries. `dk:46-48`, `dk:106-107`, `kp:292-299` | In memory, merged at construction. `kp:210-229` | Keyed slot: one entry per key, a repeated key refused naming both. List slot: every contribution appended. `dk:22-41`; `kp:157-199` |
| **What the kit's flows store** (resources, session state) | The flows the kit's install returns; this is the flows' scopes, not the kit's | By each flow's scope rules | In the app's stores (`stores` option) | Per the flows. **Out of scope for this page**: link to Resources and State and scopes. |

## 3. A slot

- A slot is a typed place a kit declares for other kits to fill: `slots: { name: slot.keyed(schema) | slot.list(schema) }`. `dk:121-124`, `dk:56-66`. [page]
- Two kinds. **Keyed**: entries by key; each contributor gives a record, or entries carrying a string `id` that becomes the key; two contributors giving one key is refused, naming both. `dk:22-31`; test `et:146-169` (keyed by `id`), `et:236-247`. **List**: contributions append in install order, the app's last. `dk:33-41`, `dk:62`; test `et:92-106` (`["c","app"]`). [page: one line each; ref: the rest]
- Every entry is checked against the slot's schema, and the owner receives what the schema parsed (defaults applied, values coerced). `dk:29`, `kp:151-156`; test `et:208-224` (`[{ n: 1 }]`, `{ three: 3 }`). An entry the schema refuses is refused at construction, naming the slot and the contributor. `et:278-287`. [ref]
- The key a contribution goes under is `<kit>.<slot>`, read from the owner's factory (`workforce.slots.workerFlows`), not spelled by the contributor. `dk:50-54`, `dk:196-197`, `dk:227-229`; test `dt:14-22` (`"board.columns"`, `"board.cards"`). [page]
- The owner's `install` receives each declared slot's merged entries in `slots`. `dk:100-108`, `dk:148-151`; `kp:292-299`. [page]
- Only a kit that requires the owner, directly or through another kit, can fill a slot: "Only a kit that requires it can fill them." `dk:122-123`, `dk:121`. Refused at construction: `kit "stranger" fills slot "b.order", but does not require kit "b", which declares it.` `kp:139-142`; `et:249-259`. A kit that requires a kit that requires the owner may fill it: "`d` requires `b` only through `c`, which is enough." `et:70`, `kp:88-100`; goal `a:entries` (`goal:8`). [page]
- A fill of a slot no kit declares is refused, naming the slot. `kp:135-138`; `et:261-276`. [ref]
- An app fills any slot, by its key, with `fill`: `fill: { [harnesses.slots.harnesses]: [codexHarness(), cursorHarness()] }` (**[reconcile]** the key). `ty:140-145`; `kp:203-205` (an app's fill has no requires check). A keyed slot takes a record, or a list of entries each keyed by its `id`; a list slot gets the app's entries last. `ty:143-145`. Test: `fill: { [b.slots.order]: ["app"], [b.slots.entries]: { app: "from the app" } }` gives `["c","app"]` and `{ c, app }`. `et:92-106`. [page]
- The app can drop a kit's contribution: `kit().without(slotKey)` drops the whole slot's contribution; `.without(slotKey, key)` drops one key of a keyed slot. `dk:164-170`, `dk:173-178`; tests `et:200-206` (`{ c }`; order stays `["c","d"]`), `et:226-233` (order `["c"]`, entries untouched), `dt:59-68` (the original unchanged). [page: one sentence, since it is how an app declines part of a kit]
- "An order nobody can satisfy, a slot filled twice under one key, a fill by a kit that doesn't require the slot's owner and an entry its slot's schema refuses throw here [at construction]." `ty:132-135`. Every problem is named at once, in one error. `kp:47-53`, `kp:259`; `et:261-276`. [ref]

## 4. Order (question 2)

- The `kits` list can be in any order. "the app lists kits in any order"; "Returns its factory ... lists the result in `createFlowState({ kits })`, in any order." `dk:205-206`; `ty:127-129`. [page]
- They install in `requires` order: each after every kit it requires. `ty:128-129`; `kp:28-29`, `kp:55-85`. Test: kits listed `[d(), b(), c()]` install `["b","c","d"]`. `et:81-90`. Goal: the app lists `[d, b, c]` and every kit's flow answers; the goal never lists kits in requires order, which would hide an install in list order. `goal:5`, `goal:13`. [page]
- The goal's two controls fail if the engine installs in the listed order or contributes owners first. `goal:17-18`. [verify: contributor material; not for the page]
- **Where listed order does matter (one clause or none):** ties keep the app's order: two kits neither requiring the other install in the order listed, so their entries in a *list* slot append in that order. `dk:34-36`, `kp:55`, `kp:76-80`, `kp:149` (entries sorted by install rank). No test covers a tie between two independent contributors; **[verify]** before the page says it. The app's own `fill` always comes last. `dk:34-36`; `kp:204` (rank `Number.POSITIVE_INFINITY`).
- A kit requiring a kit that is not installed is refused: `kit "c" requires kit "b", which is not installed.` Kits requiring each other are refused: `kits require each other: "x", "y".` A kit listed twice is refused. `kp:59-69`, `kp:77-79`; `et:289-303`. [ref]

## 5. A kit that fills one can open another (the chain)

- A kit may both fill the slots of a kit it requires and declare slots of its own. `dk:121-124`, `dk:125-130`. [page]
- Its contribution is built after its own dependents have filled its slots, so `contributes` can pass on what it was given: `contributes` "Runs after every kit that requires this one has contributed, so `slots` holds this kit's own slots fully filled, the app's `fill` included." `dk:131-133`; `kp:6-10`, `kp:207-229`. [page]
- Test: `c` requires `b`, declares its own list slot `extras`, and builds its entry in `b` from it; `d` requires `c` and fills `extras`. The entry in `b` is `c with ...` built from what `d` put in `c`'s slot. `et:116-145`. Goal `a:chain` (`goal:9`): `c`'s entry in `b` is `c carries [from d]`. [page]
- `contributes` receives `{ config, slots }` and returns a record from slot key to entry. `dk:134-137`; `kp:222-227`. [ref]
- The whole chain, as the plan names it. **[reconcile]** `workforce` declares `workerFlows` (a keyed slot of flows; the doc comment `dk:125-130` shows `{ coder: coderFlow(config) }` going in). `harnesses` requires `workforce`, contributes the `coder` flow, and declares a `harnesses` slot (`ty:141`). `claudeCode` requires `harnesses` and fills that slot. The app's `fill` can add Codex and Cursor entries to the same slot (`ty:141`). The *mechanism* of each step is built and tested with made-up kits (`et:116-145`, `et:92-106`); the three named kits are not.
- Answer to question 1, from the surface: the harnesses kit requires `workforce` and returns the `coder` flow from `contributes`, under `workforce.slots.workerFlows`. `workforce` declares the slot and has "never heard of" the harnesses kit; it receives the merged flows in its `install`. `dk:121-137`; `kp:292-299`. **[reconcile]** the names; the mechanism is verified.

## 6. Failure shapes (page links to `reference/kits`; at most one is shown)

All thrown as `FlowStateConfigError`, from `createFlowState(...)` at construction, except a folder refusal, which rejects `ready()` and every request. `kp:47-53`, `kp:286-289`; `ty:132-135`; `et:348-364`.

- A fill from a kit that does not require the owner: `createFlowState: kit "stranger" fills slot "b.order", but does not require kit "b", which declares it.` `kp:140`; `et:249-259`.
- A keyed slot filled twice: `slot "b.entries": the key "c" is filled by kit "c" and by kit "twin".` `kp:191`; `et:236-247`.
- An entry the schema refuses: `slot "b.order": kit "wrong" gave an entry its schema refuses: ...`. `kp:154`; `et:278-287`.
- Several problems: `createFlowState: the kits can't be installed:` and a `  - ` line per problem. `kp:47-53`.
- A stray file in a kit's folder: `createFlowState: the app can't start; a kit's folder was refused:` then a line naming the kit, the file and the folder. `kp:286-289`; `et:348-364`; goal `b:stray`.
- A config the kit's schema refuses: thrown at the app's own call of the factory, not at `createFlowState`. `dk:251-256`; `dt:29-38`.

## 7. Examples (all four are buildable from the exported surface with a made-up kit)

Imports: `defineKit`, `slot`, `defineFlow` from `@flow-state-dev/core` (`ct:112-113`; `et:14`); `createFlowState` from `@flow-state-dev/engine` (`ex:13`); `z` from `zod` (`dt:8`).

- Install three kits: `createFlowState({ kits })` with an unordered list. **[reconcile]** if the page uses `workforce()`/`harnesses()`/`claudeCode()`; `hf:28-37` already shows `workforce({ directory: "./workforce" })` marked as reconciling at cutover.
- Fill a slot from the app: `fill: { [kit.slots.name]: [...] }`; works today with a made-up owner kit (`et:92-106`, `et:208-224`).
- A small kit: `defineKit({ name, slots, install })` where `install` returns `{ flows: [...] }`; `slots` in `install` are typed from the declaration (`SlotValue`, `dk:46-48`). Works today (`dt:14-22`, `et:48-56`).
- Contribute to another kit: `defineKit({ name, requires: [owner], contributes: () => ({ [owner.slots.x]: ... }), install })`. Works today (`et:58-66`). `requires` takes the owner's *factory*, which is why a factory can only require a kit defined before it (`et:293-294`).

## 8. Reference rows (move off the page)

`defineKit` options (`name`, `config`, `requires`, `slots`, `contributes`, `directory`, `install`, `dk:110-152`); the two slot kinds and their merge rules; `KitFolder.claim` rules (`dk:76-86`, `cl:30-37`); the folder's root/`directory` rules; the full startup refusals (section 6); `without` (`dk:166-178`); the kit-name rule (`dk:117`, `dk:219-225`). → `reference/kits`.

## 9. What the page must not state

- The names `workforce()`, `harnesses()`, `claudeCode()` as exported, built or released; each is **[reconcile]**.
- That a kit "has no client half": only in the contributor glossary, not citable.
- That list order breaks ties for list-slot entries, until a test covers it **[verify]**.
- Anything about how a kit's flows store data beyond "the flows' scopes".
