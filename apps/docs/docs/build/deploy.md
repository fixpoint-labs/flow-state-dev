---
title: Choose where to deploy
type: concept
description: What a host has to give your app, and how a ten-minute request, a serverless platform and a database change which host you pick.
---

import Figure from "@site/src/components/Figure";
import Hosts from "./figures/deploy-hosts.svg";

# Choose where to deploy

A host passes each HTTP request to your app, keeps a process alive long enough to finish a reply that streams, and gives the app somewhere to keep what it saves. Hosts differ on the last two. A server you run keeps a process and a disk. A serverless platform keeps neither.

The example is a support desk: a `support` flow, a customer at `acme`, and a `buildReport` action that takes ten minutes.

<Figure svg={Hosts} caption="Hosts by what they keep alive" description={"Three rows, one per kind of host, each with three boxes. The first column names the host: a long-lived process such as Railway or Docker, a serverless function such as Vercel or Lambda, and a queue with a worker, BullMQ. The second column has a dashed outline because it lasts one action run: the run and its stream on the long-lived process, one function call on the serverless host, and the job's run in the worker process. The third column has a hatched top because it outlives the request. It is the store: SQLite on a volume or Postgres on the long-lived process, Postgres over the network on the serverless host, and Redis plus Postgres with the queue. The serverless row's store is highlighted: it is the only thing there that lasts, and it sits off the host."} />

## The same app, mounted

The app is one config object. It does not name a host.

```ts title="fsdev.config.ts"
import { createFlowState } from "@flow-state-dev/engine";
import { postgresStores } from "@flow-state-dev/store-postgres";
import support from "./src/flows/support/flow";

export default createFlowState({
  flows: [support],
  stores: postgresStores({ connectionString: process.env.FSD_DB_URL }),
});
```

On a server you run, one call mounts it. `serve` starts a long-lived HTTP server for the app. `fsdev serve` does the same from the terminal.

```ts title="src/server.ts"
import { serve } from "@flow-state-dev/node";
import flowstate from "../fsdev.config";

await serve(flowstate);
```

Next.js on Vercel mounts it in a route file instead, and AWS Lambda in a handler export. The runtime must be Node, and edge runtimes are not supported ([Runtime options](../reference/runtime.md)).

Before the first deploy, give each flow a way to tell who is calling ([Authentication and tenancy](../concepts/auth-and-tenancy.md)). Without one, the app will not trust a `userId` the caller sends. The Vercel, Next.js and Lambda handlers answer every call with HTTP 500 and `{ "error": "Internal server error" }`, whatever `NODE_ENV` says, and log the cause once, naming the flow. `serve` and `fsdev serve` refuse to start on any host but loopback, and `serve` binds `0.0.0.0` unless told otherwise. [Authentication](../reference/authentication.md) has the exact messages and the override.

If a proxy sits in front of the app, the model's reply arrives in bursts, or all at once at the end, when the proxy buffers the response. Turn buffering off for the path the app is mounted on, `/api/flows` under `serve`. [Items and the stream](../reference/items.md) lists the headers the app sets itself.

## Does serverless change your flows?

No. Your flows, blocks and client code stay as they are. What changes is around them:

**The mount file.** A route file or a handler export takes the place of `serve`, as above.

**The store.** A function has no disk that lasts, so it needs a database it reaches over the network.

**Work after the reply.** An action called without asking for a streamed reply, such as `send` from a script, gets an immediate response carrying the request's id, and the run carries on after it. A serverless host can freeze the function once the reply is out, which stops the run partway. On Vercel, `onBackgroundWork` hands that run to `after` from `next/server`, which keeps the function alive after the reply until the run finishes, within the route's maximum duration.

```ts title="fsdev.config.ts"
import { createFlowState } from "@flow-state-dev/engine";
import { vercelPostgresStores } from "@flow-state-dev/vercel/store";
import { after } from "next/server";
import support from "./src/flows/support/flow";

export default createFlowState({
  flows: [support],
  stores: vercelPostgresStores(),
  onBackgroundWork: (promise) => after(() => promise),
});
```

**The clock.** A long-lived process runs schedules on its own. A serverless app needs something to wake it, which on Vercel is a cron entry that calls a route ([Schedules on Vercel](./schedules/vercel-cron.md)).

## When a request runs ten minutes

The run, not the browser tab, is what a host has to keep alive. A closed tab does not cancel `buildReport`, and a client that reconnects picks the stream up where it left off. Stopping a run takes an explicit abort call ([HTTP API](../reference/http-api.md)).

A run whose process stops is not lost silently. If the Railway container restarts while a report is running, the run shows up afterwards as that conversation's interrupted turn, about a minute later with the default settings. Continue finishes the same request, and Discard ends it. That needs a store that outlasts the process, such as SQLite on a volume or Postgres.

How long a run may last is the host's limit, not the framework's. A long-lived process holds it as long as the process lives. A function has a maximum duration set by the platform, and a run that outlasts it is cut off. So a ten-minute report belongs on a long-lived host, [Railway](./deploy/railway.md) or [Docker](./deploy/docker.md), or behind a queue.

A queue returns to the browser at once and runs `buildReport` as a job in another process, against the same store ([Queued runs](../reference/background-work.md)). That worker process is itself long-lived, so a queue takes the long run off the web host, not off the need for a long-lived host ([Run background jobs with BullMQ](./background-jobs-bullmq.md)).

## What has to live outside the process

Three things: the store, the queue and the secrets.

The store holds the support desk's sessions, state, requests and paused runs. Leave `stores` out and the app runs in memory. Startup says so, and with `NODE_ENV=production` it warns once, but it serves anyway. On serverless every cold start is a restart, and the host picks when they happen, so two calls that land on different instances do not see each other's sessions. Use Postgres on serverless or with more than one server; SQLite is for one process on a disk that lasts. [Stores](../reference/stores.md) says what each one keeps.

The queue, if you use one, keeps its jobs in Redis. The secrets, such as `FSD_DB_URL`, `REDIS_URL` and `OPENAI_API_KEY`, go in the host's own environment settings, never in the repository or the image.

## Pick one

- **Next.js on Vercel:** a database, a maximum duration set on the route, and `onBackgroundWork` wired to `after`, as above. [Deploy to Vercel](./deploy/vercel.md).
- **Next.js elsewhere:** mount the app with `@flow-state-dev/next`, the Next.js adapter, and use a store that lasts. [Serving flows](../concepts/serving-flows.md).
- **A server you run:** `serve` or `fsdev serve` on Railway, Render, Fly, Docker or a VPS. [Railway](./deploy/railway.md), [Docker](./deploy/docker.md).
- **AWS Lambda:** a Function URL in streaming mode and a network database. A run longer than the function's own timeout is cut off.
- **A run longer than the platform allows:** a queue and a worker.

## What it gets you

**A report outlives its tab.** The customer at `acme` can close the browser halfway through `buildReport` and come back to the finished report, or to the stream where they left it.

**One store serves every process.** On Postgres, every web instance and a BullMQ worker read the same sessions, so a report the worker finishes is in the conversation the browser opens.

**Changing host is a config change.** Moving `support` from Railway to Vercel touches `fsdev.config.ts` and one mount file, nothing in `src/flows/`.

## How it fits with the others

[Serving flows](../concepts/serving-flows.md) is the config object this page mounts. [Persistence](../concepts/persistence.md) says what each store keeps and who owns a record. [Background work](../concepts/background-work.md) covers the queue and the other ways to run work after the reply.

## Next

- [Runtime options](../reference/runtime.md): every `createFlowState` option, the `serve` defaults and the abort and health routes.
- [Stores](../reference/stores.md): the options for SQLite and Postgres.
- [Deploy to Vercel](./deploy/vercel.md): the route file, `maxDuration` and the database, step by step.
- [Run background jobs with BullMQ](./background-jobs-bullmq.md): a queue and a worker for the long run.
