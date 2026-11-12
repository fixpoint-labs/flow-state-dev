# @flow-state-dev/store-sqlite

A SQLite store for Flow State: real SQL with no database server.

```bash
pnpm add @flow-state-dev/store-sqlite
```

```ts
import { createFlowState } from "@flow-state-dev/engine";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import supportDesk from "./flows/support-desk";

const flowstate = createFlowState({
  flows: { supportDesk },
  stores: {
    default: { primary: sqliteStores({ filename: "./data/flowstate.db" }) },
  },
});
```

Reference: [the `store-sqlite` section of the Flow State API reference](https://flow-state.dev/docs/reference/api/store-sqlite).
