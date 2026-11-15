---
title: Deploy to AWS Lambda
type: recipe
description: "Run a Flow State app on AWS Lambda behind a Function URL, with response streaming so SSE events arrive as they happen."
---

# Deploy to AWS Lambda

Run a Flow State app on AWS Lambda behind a Function URL, with response streaming so SSE events arrive as they happen.

Lambda is a serverless target: functions spin up on demand and stop when idle. That suits short-to-medium flows and bursty traffic. The tradeoffs are cold starts and a per-invocation time limit, both covered below. For long-running agents that stream for minutes, a long-lived host (see [Deploying to Railway](/guides/deploying-to-railway)) is a better fit.

---

## Prerequisites

- A Node.js 22+ project with flow-state-dev
- An AWS account and the [AWS CLI](https://docs.aws.amazon.com/cli/) configured
- `@flow-state-dev/node` and `@flow-state-dev/store-postgres` installed
- A Postgres database the function can reach over the network (see step 4)
- At least one LLM provider API key

---

## 1. Write the handler

`@flow-state-dev/node/aws-lambda` wraps your app in Lambda's streaming runtime. `createLambdaHandler` takes the `FlowState` that `createFlowState` returns and returns the function you export.

```ts title="src/handler.ts"
import { createLambdaHandler } from "@flow-state-dev/node/aws-lambda";
import { createFlowState } from "@flow-state-dev/engine";
import { postgresStores } from "@flow-state-dev/store-postgres";
import helloChat from "./flows/hello-chat/flow.js";

const flowstate = createFlowState({
  flows: [helloChat],
  models: { default: "openai/gpt-6-luna" },
  stores: {
    default: {
      primary: postgresStores({ connectionString: process.env.DATABASE_URL }),
    },
  },
});

export const handler = createLambdaHandler(flowstate);
```

The handler serves the `/api/flows` routes and the `/healthz` endpoint. Every endpoint is listed in the [runtime reference](/reference/runtime).

---

## 2. Enable response streaming

For SSE to work on Lambda, the function has to stream its response:

- The handler uses Lambda's streaming runtime. `createLambdaHandler` does this for you.
- The function is invoked in streaming mode. Configure a **Function URL** with `InvokeMode: RESPONSE_STREAM`.

```bash
aws lambda create-function-url-config \
  --function-name my-flow-app \
  --auth-type NONE \
  --invoke-mode RESPONSE_STREAM
```

Without `RESPONSE_STREAM`, Lambda buffers the whole response and SSE events arrive only after the flow finishes.

`--auth-type NONE` is for the smoke test only. A public URL lets any caller act as any user and run billed model calls. For production, switch the Function URL to IAM auth, or give `createFlowState` a `resolvePrincipal` so the app verifies the caller itself. See [Authentication](/docs/server/authentication).

---

## 3. Configure memory and timeout

- **Memory:** 256 MB is a reasonable floor; raise it if your flows hold large context. Memory also scales CPU, which shortens cold starts.
- **Timeout:** set it to your longest expected flow plus headroom (for example 60s). The function bills until the flow completes or the timeout fires.

Keep timeouts conservative so an abandoned stream doesn't bill for minutes. What a client disconnect does is in the [runtime reference](/reference/runtime).

---

## 4. Choose a store

The filesystem and SQLite stores don't survive between invocations. Use a database the function reaches over the network, such as a managed Postgres. Create the store at module scope, as step 1 does with `postgresStores()`, so warm invocations reuse its connection. Which stores persist is in the [persistence overview](/docs/persistence/overview). Starting the store on a cold start has a cost you can remove; see [Cold starts](#cold-starts-the-first-request-after-idle).

---

## 5. Deploy

Bundle `src/handler.ts` and its dependencies (esbuild or your bundler of choice), zip it, and create the function. A minimal AWS CLI flow:

```bash
# after bundling to dist/handler.js and zipping to function.zip
aws lambda create-function \
  --function-name my-flow-app \
  --runtime nodejs22.x \
  --handler handler.handler \
  --zip-file fileb://function.zip \
  --role arn:aws:iam::ACCOUNT_ID:role/my-lambda-role \
  --timeout 60 \
  --memory-size 256 \
  --environment "Variables={OPENAI_API_KEY=sk-...,DATABASE_URL=postgres://...}"
```

For anything beyond a first deploy, manage this with SAM, CDK, or Terraform rather than raw CLI calls. The pieces are the same: a Node 22 function, a Function URL in `RESPONSE_STREAM` mode, and your environment variables.

---

## 6. Verify

```bash
# Use your Function URL, then:

# 1. Health check
curl https://YOUR_URL.lambda-url.REGION.on.aws/healthz

# 2. List flows
curl https://YOUR_URL.lambda-url.REGION.on.aws/api/flows

# 3. Run an action
curl -X POST https://YOUR_URL.lambda-url.REGION.on.aws/api/flows/hello-chat/actions/chat \
  -H "Content-Type: application/json" \
  -d '{"userId": "test", "input": {"message": "Hello"}}'

# 4. Stream the response. Events should arrive incrementally, not in one burst
curl -N https://YOUR_URL.lambda-url.REGION.on.aws/api/flows/hello-chat/requests/REQUEST_ID/stream
```

If step 4 returns everything at once, the function isn't streaming. Recheck `InvokeMode: RESPONSE_STREAM` on the Function URL.

---

## Troubleshooting

### Cold starts: the first request after idle

The first request after idle is slower, but it does not fail. The API waits for the store to finish starting and then answers. It returns a 500 only if store startup failed for good. `/healthz` behaves differently: it answers 503 `{ "status": "initializing" }` until the store is ready, so don't point a startup probe at it and treat 503 as an outage.

What that first request pays for is loading the bundle and starting the store. With `postgresStores`, starting the store creates the schema by default: about 30 idempotent statements and an advisory lock, on every cold start. To skip that cost, create the schema once as a deploy step, then pass `skipSchemaInit: true` in the handler:

```ts title="scripts/migrate.ts (run once per deploy)"
import { createPostgresStores } from "@flow-state-dev/store-postgres";

const stores = await createPostgresStores({ connectionString: process.env.DATABASE_URL });
await stores.close();
```

```ts title="src/handler.ts"
primary: postgresStores({
  connectionString: process.env.DATABASE_URL,
  skipSchemaInit: true,
}),
```

Run the migration before the first request that uses the new schema. Store options are in the [persistence overview](/docs/persistence/overview).

### SSE arrives all at once

The function is buffering. Confirm the Function URL uses `RESPONSE_STREAM`, and that nothing sits between the client and the Function URL. A gateway or proxy in front can hold the response until it ends, so test against the Function URL directly.

### Function times out mid-stream

Raise the timeout, or move long-running flows to a long-lived host.

---

## See also

- [Host adapters](/docs/server/host-adapters): when to choose Lambda over the alternatives
- [Deployment overview](/guides/deployment): SSE and persistence fundamentals
