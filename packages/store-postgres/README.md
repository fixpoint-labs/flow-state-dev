# @flow-state-dev/store-postgres

A PostgreSQL store for Flow State, with connection pooling.

```bash
pnpm add @flow-state-dev/store-postgres pg
```

```ts
import { createFlowState } from "@flow-state-dev/engine";
import { postgresStores } from "@flow-state-dev/store-postgres";
import supportDesk from "./flows/support-desk";

const flowstate = createFlowState({
  flows: { supportDesk },
  stores: {
    default: {
      primary: postgresStores({ connectionString: process.env.DATABASE_URL!, max: 20 }),
    },
  },
});
```

Reference: [the `store-postgres` section of the Flow State API reference](https://flow-state.dev/docs/reference/api/store-postgres).
