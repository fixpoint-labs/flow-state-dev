---
title: Deploy to AWS Lambda
type: recipe
description: "Run a Flow State app on AWS Lambda behind a Function URL, with response streaming so SSE events arrive as they happen."
---

# Deploy to AWS Lambda

Run a Flow State app on AWS Lambda behind a Function URL, with response streaming so SSE events arrive as they happen.

Lambda suits short-to-medium flows and bursty traffic. The costs are cold starts and a time limit on each invocation. For agents that stream for minutes, a long-lived host such as [Railway](./railway.md) is a better fit.

---

## Prerequisites

- A Node.js 22+ project with flow-state-dev
- An AWS account and the [AWS CLI](https://docs.aws.amazon.com/cli/) configured
- `@flow-state-dev/node` and `@flow-state-dev/store-postgres` installed
- A Postgres database the function can reach over the network (see step 5)
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

`helloChat` is your flow module, `src/flows/hello-chat/flow.ts`, as built in [Your first flow](../your-first-flow.md). The handler serves the `/api/flows` routes and the `/healthz` endpoint. Every endpoint is listed in the [HTTP API reference](../../reference/http-api.md).

---

## 2. Require a credential

The handler answers every request, `/healthz` included, with a 500 while a flow takes its `userId` from the request body. Give the flow a `resolvePrincipal` that checks a credential. A shared secret is enough to start:

```ts title="src/flows/hello-chat/flow.ts"
import { defineFlow } from "@flow-state-dev/core";
import { createBearerSecretPrincipalResolver } from "@flow-state-dev/engine";
import { z } from "zod";
import { chatPipeline } from "./blocks/chat-pipeline";

const helloChat = defineFlow({
  kind: "hello-chat",
  authentication: {
    resolvePrincipal: createBearerSecretPrincipalResolver({
      secret: process.env.FLOW_API_SECRET ?? "",
      principal: { userId: "smoke-test", orgId: "my-org" },
    }),
  },
  actions: {
    chat: { block: chatPipeline, userMessage: (input) => input.message },
  },
  session: {
    stateSchema: z.object({ messageCount: z.number().default(0) }),
    client: { expose: ["messageCount"] },
  },
});

export default helloChat();
```

Runs and session reads need the secret; `/healthz`, the flow list and `/api/flows/capabilities` answer without it. An empty secret throws when the module loads. For signed-in users, write `resolvePrincipal` around your own session, as [Auth and tenancy](../../concepts/auth-and-tenancy.md) shows.

---

## 3. Enable response streaming

For SSE to work, the function has to stream its response, so the **Function URL** needs `InvokeMode: RESPONSE_STREAM`:

```bash
aws lambda create-function-url-config \
  --function-name my-flow-app \
  --auth-type NONE \
  --invoke-mode RESPONSE_STREAM
```

A Function URL made through the CLI comes with no access policy, and every request gets a 403, even with `--auth-type NONE`. Grant access with two statements, one per command. The second limits `lambda:InvokeFunction` to calls made through the Function URL.

```bash
aws lambda add-permission \
  --function-name my-flow-app \
  --statement-id UrlPolicyInvokeURL \
  --action lambda:InvokeFunctionUrl \
  --principal '*' \
  --function-url-auth-type NONE

aws lambda add-permission \
  --function-name my-flow-app \
  --statement-id UrlPolicyInvokeFunction \
  --action lambda:InvokeFunction \
  --principal '*' \
  --invoked-via-function-url
```

The console and AWS SAM add this policy for you when they create a Function URL with auth type `NONE`. See [Control access to Lambda function URLs](https://docs.aws.amazon.com/lambda/latest/dg/urls-auth.html).

Without `RESPONSE_STREAM`, Lambda buffers the whole response and SSE events arrive only after the flow finishes.

With `--auth-type NONE` anyone can reach the URL, and the step 2 secret decides who reaches a flow and its billed model calls. To close the function itself, switch the Function URL to IAM auth.

---

## 4. Configure memory and timeout

- **Memory:** 256 MB is a reasonable floor; raise it if your flows hold large context. Memory also scales CPU, which shortens cold starts.
- **Timeout:** set it to your longest expected flow plus headroom (for example 60s). The function bills until the flow completes or the timeout fires.

What a client disconnect does is in the [runtime reference](../../reference/runtime.md).

---

## 5. Choose a store

The filesystem and SQLite stores don't survive between invocations, so use a database the function reaches over the network. Create the store at module scope, as step 1 does with `postgresStores()`, so warm invocations reuse its connection. Which stores persist is in [Persistence](../../concepts/persistence.md). Starting the store on a cold start has a cost you can remove; see [Cold starts](#cold-starts-the-first-request-after-idle).

---

## 6. Deploy

Bundle `src/handler.ts` and its dependencies with your bundler (esbuild, for example), zip it, and create the function:

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
  --environment "Variables={OPENAI_API_KEY=sk-...,DATABASE_URL=postgres://...,FLOW_API_SECRET=...}"
```

Past a first deploy, use SAM, CDK, or Terraform with the same pieces: a Node 22 function, a Function URL in `RESPONSE_STREAM` mode, and your environment variables.

---

## 7. Verify

```bash
# Use your Function URL, then:

# 1. Health check
curl https://YOUR_URL.lambda-url.REGION.on.aws/healthz

# 2. List flows
curl https://YOUR_URL.lambda-url.REGION.on.aws/api/flows

# 3. Run an action and stream its events in the same response
curl -N -X POST https://YOUR_URL.lambda-url.REGION.on.aws/api/flows/hello-chat/actions/chat \
  -H "Authorization: Bearer $FLOW_API_SECRET" \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{"input": {"message": "Hello"}}'
```

The `Accept: text/event-stream` header keeps the flow running on the invocation that streams it. Without it the POST answers 202 and returns, and Lambda can freeze the function before the flow finishes.

Events should arrive one at a time. If they arrive in one burst, see [SSE arrives all at once](#sse-arrives-all-at-once).

---

## Troubleshooting

### Cold starts: the first request after idle

The first request after idle is slower but does not fail. The API waits for the store to finish starting and then answers. It returns a 500 only if store startup failed for good. `/healthz` behaves differently: it answers 503 `{ "status": "initializing" }` until the store is ready, so don't point a startup probe at it and treat 503 as an outage.

That first request loads the bundle and starts the store, and by default `postgresStores` creates the schema, idempotently, on every cold start. To skip that cost, create the schema once as a deploy step, then pass `skipSchemaInit: true` in the handler:

```ts title="scripts/migrate.ts"
import { createPostgresStores } from "@flow-state-dev/store-postgres/host";

const stores = await createPostgresStores({ connectionString: process.env.DATABASE_URL });
await stores.close();
```

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
      primary: postgresStores({
        connectionString: process.env.DATABASE_URL,
        skipSchemaInit: true,
      }),
    },
  },
});

export const handler = createLambdaHandler(flowstate);
```

Run `scripts/migrate.ts` once per deploy, before the first request that uses the new schema. Store options are in the [stores reference](../../reference/stores.md).

### SSE arrives all at once

Confirm the Function URL uses `RESPONSE_STREAM`. A gateway or proxy in front can hold the response until it ends, so test against the Function URL directly.

### Function times out mid-stream

Raise the timeout, or move long flows to a long-lived host.

---

## See also

- [Serving flows](../../concepts/serving-flows.md): when to choose Lambda over the alternatives
- [Choose where to deploy](../deploy.md): streaming and persistence on each host
