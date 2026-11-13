# @flow-state-dev/workforce

Workers: describe each in a `WORKER.md`, and `hireWorkforce` gives back the flows to register.

```bash
pnpm add @flow-state-dev/workforce
```

```ts
import { readDeclaredRoster } from "@flow-state-dev/workforce/loader";
import { createWorkerInstallation, hireWorkforce } from "@flow-state-dev/workforce";

const roster = await readDeclaredRoster("./workforce");
if (roster.problems.length) {
  throw new Error(`workforce: ${roster.problems.map((p) => `${p.layer} ${p.path}`).join(", ")}`);
}

const installation = createWorkerInstallation({ standardWorkers: roster.workers });
flowRegistry.registerMany(hireWorkforce(installation)); // ["agent", "workforce-roster"]
```

Reference: [the `workforce` section of the Flow State API reference](https://flow-state.dev/docs/reference/api/workforce).
