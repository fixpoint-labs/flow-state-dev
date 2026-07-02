---
sidebar_position: 10
title: Deploying to AWS Lambda
---

# Deploying to AWS Lambda

How to deploy a flow-state-dev application to AWS Lambda with a Function URL, using the portable Hono app and Lambda's response streaming so SSE works.

Lambda is a serverless target: functions spin up on demand and stop when idle. That suits short-to-medium flows and bursty traffic. The tradeoffs are cold starts and a per-invocation time limit, both covered below. For long-running agents that stream for minutes, a long-lived host (see [Deploying to Railway](/guides/deploying-to-railway)) is a better fit.

---

## Prerequisites

- A Node.js 20+ project with flow-state-dev
- An AWS account and the [AWS CLI](https://docs.aws.amazon.com/cli/) configured
- `@flow-state-dev/node` installed
- An external store (Lambda's filesystem is ephemeral — see step 4)
- At least one LLM provider API key

---

## 1. Write the handler

`@flow-state-dev/node/aws-lambda` wraps your app in Lambda's streaming runtime. `createLambdaHandler` takes a `FlowState` (or a built router) and returns the function you export.

```ts title="src/handler.ts"
import { createLambdaHandler } from "@flow-state-dev/node/aws-lambda";
import { createFlowState } from "@flow-state-dev/engine";
import { vercelPostgresStores } from "@flow-state-dev/vercel/store"; // any external store
import myFlow from "./flows/my-flow/flow.js";

const flowstate = createFlowState({
  flows: { myFlow },
  models: { default: "openai/gpt-5.4-mini" },
  stores: { default: { primary: vercelPostgresStores() } },
});

export const handler = createLambdaHandler(flowstate);
```

The same `/api/flows` routes and `/healthz` endpoint you get from `serve()` are served here too — it is the same app, wrapped for Lambda instead of a long-lived process.

---

## 2. Enable response streaming

SSE only works on Lambda when the function streams its response. Two things make that happen:

- The handler uses Lambda's streaming runtime. `createLambdaHandler` does this for you (it is built on `hono/aws-lambda`'s `streamHandle`).
- The function is invoked in streaming mode. Configure a **Function URL** with `InvokeMode: RESPONSE_STREAM`.

```bash
aws lambda create-function-url-config \
  --function-name my-flow-app \
  --auth-type NONE \
  --invoke-mode RESPONSE_STREAM
```

Without `RESPONSE_STREAM`, Lambda buffers the whole response and SSE events arrive only after the flow finishes.

`--auth-type NONE` is for the smoke test only. The flow API reads `userId` from the request body, so a fully public URL lets any caller act as any user and run billed model calls. For production, put IAM auth, an API Gateway authorizer, or your own auth proxy in front of the function.

---

## 3. Configure memory and timeout

- **Memory:** 256 MB is a reasonable floor; raise it if your flows hold large context. Memory also scales CPU, which shortens cold starts.
- **Timeout:** set it to your longest expected flow plus headroom (for example 60s). The function runs — and bills — until the flow completes or the timeout fires.

A client disconnecting does not stop the function on Lambda. It keeps running to completion or timeout. Keep timeouts conservative so an abandoned stream doesn't bill for minutes.

---

## 4. Choose a store

Lambda's filesystem is per-invocation and discarded, so the filesystem and SQLite stores don't fit. Use an external database the function connects to over the network — for example a managed Postgres. Open the connection at module scope (as in step 1) so warm invocations reuse it.

---

## 5. Deploy

Bundle `src/handler.ts` and its dependencies (esbuild or your bundler of choice), zip it, and create the function. A minimal AWS CLI flow:

```bash
# after bundling to dist/handler.js and zipping to function.zip
aws lambda create-function \
  --function-name my-flow-app \
  --runtime nodejs20.x \
  --handler handler.handler \
  --zip-file fileb://function.zip \
  --role arn:aws:iam::ACCOUNT_ID:role/my-lambda-role \
  --timeout 60 \
  --memory-size 256 \
  --environment "Variables={OPENAI_API_KEY=sk-...,DATABASE_URL=postgres://...}"
```

For anything beyond a first deploy, manage this with SAM, CDK, or Terraform rather than raw CLI calls. The pieces are the same: a Node 20 function, a Function URL in `RESPONSE_STREAM` mode, and your environment variables.

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

# 4. Stream the response — events should arrive incrementally, not in one burst
curl -N https://YOUR_URL.lambda-url.REGION.on.aws/api/flows/hello-chat/requests/REQUEST_ID/stream
```

If step 4 returns everything at once, the function isn't streaming — recheck `InvokeMode: RESPONSE_STREAM` on the Function URL.

---

## Troubleshooting

### Cold starts

The first request after idle pays initialization: loading the bundle, opening the store connection. Provisioned concurrency removes it at a cost. For most apps, a 1–2s cold start on the occasional request is acceptable.

### SSE arrives all at once

The function is buffering. Confirm the Function URL uses `RESPONSE_STREAM`, and that you're calling the Function URL directly rather than going through an API Gateway stage that re-buffers.

### Function times out mid-stream

Raise the timeout, or move long-running flows to a long-lived host. Lambda is a poor fit for flows that stream for minutes.

---

## See also

- [Host adapters](/docs/server/host-adapters) — when to choose Lambda over the alternatives
- [Deployment overview](/guides/deployment) — SSE and persistence fundamentals
