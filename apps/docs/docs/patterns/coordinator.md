---
sidebar_position: 4
---

# Coordinator (deprecated)

`coordinator()` has been renamed to `parallelTasks()`. The API is identical.

See [parallelTasks](./parallelTasks) for the current documentation.

`coordinator()` still works but emits a deprecation warning. Replace it with `parallelTasks()`:

```ts
// Before
import { coordinator } from "@flow-state-dev/patterns";
const block = coordinator({ name: "research", worker: researchWorker });

// After
import { parallelTasks } from "@flow-state-dev/patterns";
const block = parallelTasks({ name: "research", worker: researchWorker });
```

`coordinator()` will be removed in the next major version.
