---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/contracts": patch
"@flow-state-dev/client": patch
"@flow-state-dev/testing": minor
"@flow-state-dev/orchestration": patch
---

`getItems()`, `RequestRecord.items` and item subscriptions return `RuntimeItem`, which is `OutputItem` plus trace rows: `block_trace`, `router_decision`, `state_snapshot` and `generator_step` (FIX-2054). Only types change. Runtime behaviour is the same.

These signatures return or pass `RuntimeItem`, which can break code that expects `OutputItem`:

- `ResponseEmitterHandle.getItems()` and the `subscribeToItems` listener and filter (core).
- `ResponseEmitter.getItems()`, `RequestRecord.items` and `RequestStore.persistItems` (engine).
- The `testItems` selectors that don't filter by type: `all()`, `sideChain()`, `main()`, `byAgent()` and `byVisibility()` (testing). They return trace rows when given them.

To upgrade, type arrays and callbacks that receive these values as `RuntimeItem`, imported from `@flow-state-dev/core`. Where code needs an `OutputItem`, filter out the trace rows with a type guard:

```ts
import type { RuntimeItem } from "@flow-state-dev/core";
import type { OutputItem } from "@flow-state-dev/core/items";

const TRACE = new Set(["block_trace", "router_decision", "state_snapshot", "generator_step"]);
const isOutputItem = (item: RuntimeItem): item is OutputItem => !TRACE.has(item.type);

const visible = emitter.getItems().filter(isOutputItem);
```

`.waitForCondition` predicates and `wakeOn` filters keep their `OutputItem` types. These signatures accept `RuntimeItem` as well as `OutputItem`: `resolveItemVisibility` and `collapseToCanonicalLog` (contracts, re-exported by core), `testItems` (testing), and the filter that `onTaskChangeFor` returns (orchestration). Existing callers need no change.

`RequestStreamStore` and `createRequestStreamStore` (client) take the row type as a parameter, defaulting to `OutputItem`, so existing stores are unchanged. A store seeded with trace rows is created as `createRequestStreamStore<RuntimeItem>()`, and its `getSorted()`, `getRaw()`, `getById()` and `getOwnedBy()` return `RuntimeItem`.
