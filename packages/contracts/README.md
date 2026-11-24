# @flow-state-dev/contracts

The zero-dependency layer under `@flow-state-dev/core`: the item taxonomy and a few pure helpers. `core` re-exports every name, so an app imports them from `@flow-state-dev/core` and reads their reference there. Install this package directly only where `core`'s dependencies are too heavy, such as a browser bundle.

```bash
pnpm add @flow-state-dev/contracts
```

```ts
import { cloneValue, deepEqual } from "@flow-state-dev/contracts/helpers";

const draft = cloneValue(saved);
draft.title = "Renamed";
deepEqual(draft, saved); // false
```

Reference: [the `core` section of the Flow State API reference](https://flow-state.dev/docs/reference/api/core).
