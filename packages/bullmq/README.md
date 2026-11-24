# @flow-state-dev/bullmq

Durable background jobs, cron and worker dispatch for `@flow-state-dev/engine`, on BullMQ and Redis.

```bash
pnpm add @flow-state-dev/bullmq bullmq ioredis
```

```ts
import { createFlowState } from "@flow-state-dev/engine";
import { bullmqJobQueue } from "@flow-state-dev/bullmq";

export const flowstate = createFlowState({
  flows: [billing],
  stores: { /* a backend the web process and the workers both reach */ },
  jobQueue: bullmqJobQueue({ connection: process.env.REDIS_URL! }),
});

process.on("SIGTERM", () => flowstate.dispose());
```

Reference: [the `bullmq` section of the Flow State API reference](https://flow-state.dev/docs/reference/api/bullmq).
