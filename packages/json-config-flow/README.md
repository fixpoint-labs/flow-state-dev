# `@flow-state-dev/json-config-flow` — LAB / DO NOT MERGE

Proof-of-concept: build an entire FSD workflow from **JSON config only**, by
compiling a small fixed catalog of block kinds into real
`@flow-state-dev/core` blocks (`sequencer`, `utility.keyedRouter`,
`generator`, `handler`).

Also: a **tool** can build a **dynamic sequencer** at runtime, persist it as a
workflow document (resource), and **run it on demand**.

> **Invent-kill:** this does **not** replace TypeScript for novel block types.
> Authors still write TS when they need a new primitive. This package only
> proves config composition of a catalog. Dynamic ≠ a programming language in
> JSON — it means composing catalog blocks into a sequencer and saving that JSON.

## One-liner

```ts
import { readFileSync } from "node:fs";
import { loadFlowFromJson } from "@flow-state-dev/json-config-flow";

const config = JSON.parse(
  readFileSync(new URL("../demo/demo-intake.json", import.meta.url), "utf8"),
);

const flow = loadFlowFromJson(config, {
  defaultModel: "mock-model",
  tools: {
    logIntake: (args) => ({ logged: true, args }),
  },
  fetch: async () =>
    new Response(JSON.stringify({ accepted: true }), { status: 200 }),
});

// `flow` is a defineFlow factory — register with the engine like any other flow.
export default flow();
```

## Catalog (block kinds)

| `type`       | Compiles to                         | Config highlights                                      |
|--------------|-------------------------------------|--------------------------------------------------------|
| `sequencer`  | `sequencer().step(...)`             | `steps: string[]` of block ids                         |
| `router`     | `utility.keyedRouter`               | `key` path + `routes` map; `"default"` → fallback      |
| `generator`  | `generator({ prompt, outputSchema })` | JSON Schema → Zod at load; `model` / `defaultModel`  |
| `map`        | `handler`                           | path/`{{template}}` mappings → object                  |
| `http`       | `handler`                           | URL/method/headers/body templates; injectable `fetch`  |
| `tool`       | `handler`                           | named host tool via `LoadFlowOptions.tools[toolId]`    |

## Demo JSON

See [`demo/demo-intake.json`](./demo/demo-intake.json): classify → branch on
`intent` → plan path (map + HTTP) or chat path (map + named tool).

## Dynamic workflows (save + run on demand)

### Document shape

`WorkflowDocument` (version `1`) stores `id`, `title`, timestamps, and a full
`FlowJsonConfig` under `flow` (actions + blocks catalog).

### Store / resource

- **POC default:** `createInMemoryWorkflowStore()` — process-local, fine for
  labs and unit tests (treat as session-scoped).
- **Engine sketch:** `workflowCollectionDeclaration()` documents a
  session-scoped `workflows/*` collection; adapt with
  `workflowStoreFromCollection(ctx.resources.workflows)` once the host wraps
  the sketch in `defineResourceCollection`. Prefer **session** scope for the
  POC (org scope for durable shared playbooks).

### Builder tools → save → run

```ts
import {
  createInMemoryWorkflowStore,
  createWorkflowBuilderTools,
  runSavedWorkflow,
} from "@flow-state-dev/json-config-flow";

const store = createInMemoryWorkflowStore();
const builderTools = createWorkflowBuilderTools(store);

// Pass Object.values(builderTools) as generator `tools` so a planning model
// can call createWorkflow / appendWorkflowStep / replaceWorkflowSteps / …

// Later (or in tests without a model):
const { output } = await runSavedWorkflow(
  store,
  "notify-plan",
  { message: "ship it" },
  {
    fetch: myFetch,
    tools: { logDynamic: (args) => ({ logged: true, args }) },
  },
  { ctx: myBlockContext },
);
```

API surface:

| Export | Role |
|--------|------|
| `createWorkflowDocument` | Pure constructor for a named empty entry sequencer |
| `createInMemoryWorkflowStore` / `WorkflowStore` | Persist / load documents |
| `workflowStoreFromCollection` | Thin adapter toward `ctx.resources` collections |
| `createWorkflowBuilderTools(store)` | `handler` blocks for generators (`createWorkflow`, `appendWorkflowStep`, `replaceWorkflowSteps`, `setWorkflowEntryAction`, `getWorkflow`) |
| `loadSavedWorkflow` / `runSavedWorkflow` | Compile via `loadFlowFromJson` / `compileAllBlocks`; optional execute with `asRuntime` + `ctx` |

Static snapshot of a built workflow:
[`demo/dynamic-workflow.json`](./demo/dynamic-workflow.json) (map → http → tool).

Flow: **plan-with-tools → save workflow → run saved workflow**.

## Test / typecheck

```bash
pnpm --filter @flow-state-dev/json-config-flow test
pnpm --filter @flow-state-dev/json-config-flow typecheck
```

## Gaps vs “any custom flow in JSON”

- Fixed catalog only — no arbitrary TS `execute` bodies in config.
- Path language is a tiny `$.a.b` + `{{...}}` helper, not JSONPath/JMESPath.
- JSON Schema → Zod covers a minimal subset (object/string/enum/number/array/…).
- Generators still need a host model resolver (mock in tests).
- No dispatcher / durable / capability wiring in this POC.
- Dynamic builder persists JSON composition only — not a general-purpose language.
- Full `ctx.resources` wiring is an adapter sketch; default store is in-memory.
