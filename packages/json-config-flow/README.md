# `@flow-state-dev/json-config-flow` — LAB / DO NOT MERGE

Proof-of-concept: build an entire FSD workflow from **JSON config only**, by
compiling a small fixed catalog of block kinds into real
`@flow-state-dev/core` blocks (`sequencer`, `utility.keyedRouter`,
`generator`, `handler`).

> **Invent-kill:** this does **not** replace TypeScript for novel block types.
> Authors still write TS when they need a new primitive. This package only
> proves config composition of a catalog.

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
