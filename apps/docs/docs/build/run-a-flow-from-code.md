---
title: Run a flow from your own code
type: recipe
description: "Call a flow's action from a cron job, job processor or script with runAction."
---

# Run a flow from your own code

A nightly job needs to send a reply through the `support` flow. A job processor runs one flow per queued message. A script reacts to a webhook your own code already received. None of these is an HTTP request, so none of them can call the flow through a client.

Work a user triggers belongs on HTTP. `runAction` checks no credentials and builds no HTTP response, so a user's request should reach the flow through your server.

`runAction` runs a flow's action the same way an HTTP request does. You give it the flow, the action name, the input and who is running it, and it resolves with the result.

It runs actions, not blocks. To run a single block, use [`@flow-state-dev/testing`](/docs/reference/api/testing). If you want a timer or a queue and not your own code, `@flow-state-dev/scheduled` and `@flow-state-dev/bullmq` call `runAction` for you; see [Background jobs with BullMQ](./background-jobs-bullmq.md).

The example is the support desk from [Flows and actions](../concepts/flows-and-actions.md): a `support` flow with a `reply` action.

## 1. Get the flow, the stores and the runtime config

`support` is the flow the server registers, the default export of `src/flows/support/flow.ts`. The stores hold sessions and requests, and `runtimeConfig` holds instance-level settings such as the model resolver. Take both from the app, so your script and your server see the same sessions.

```ts title="scripts/send-reply.ts"
import app from "../fsdev.config";

const runtime = await app.getRuntime();
// runtime.stores and runtime.runtimeConfig are what the server uses
```

A standalone script with no `fsdev.config.ts` builds its own with `createInMemoryStores()` from `@flow-state-dev/engine/host`, and passes `runtimeConfig: {}` if no block calls a model. Nothing in memory outlives the process. A flow with a generator block needs a `modelResolver` in `runtimeConfig`.

## 2. Call runAction

`flow`, `actionName`, `input`, `userId`, `orgId`, `stores` and `runtimeConfig` are required. `userId` and `orgId` are the user and organization the run belongs to. Nothing checks them, so pass ones your own code has verified. For single-organization development, use `DEFAULT_ORG_ID`.

`sessionId` is optional. Pass the same one on every call and the runs share one session, so the second `reply` sees the state the first one left. Leave it out and each call gets a new session. A session belongs to one user, one organization and one flow. Reusing it from another user, organization or flow rejects before anything runs.

Pass `onItem(item, kind)` to watch items as they arrive. `kind` says where the item is in its lifecycle: `"added"`, `"updated"` or `"done"`. Transient items arrive here too, though they are never saved; [Items](../reference/items.md) says which those are. An error thrown in `onItem` doesn't fail the run.

## 3. Check the result

A call fails in one of two ways. A call that is wrong before the run starts rejects: an unknown action name, no `orgId`, or a session that belongs to someone else. A run that starts and fails resolves with `result.error` set and `result.output` undefined. Input the action's schema refuses is the second kind: `{ message: 5 }` for a string field resolves with `result.error.code` equal to `"validation_error"`, and the request record is marked `failed`. So catch the rejection, and check `result.error` on what resolves.

Otherwise `result.output` holds what the action returned, and `result.items` holds the items the run produced, in order. Those include trace items such as `block_trace` and `state_change`, so filter to the types you want. [Items](../reference/items.md) lists them. The reply a user would see is a `message` item, with its text in the `output_text` parts of `content`:

```ts title="scripts/send-reply.ts"
if (result.error) throw result.error;
let replyText = "";
for (const item of result.items) {
  if (item.type !== "message") continue;
  for (const part of item.content) {
    if (part.type === "output_text") replyText += part.text;
  }
}
```

`result.requestId` is the run's id. `runtime.stores.request.get(requestId)` returns its stored record later, with `status`, `items` and `result`. That record leaves out transient items, which only `onItem` sees.

## 4. Start a run without waiting

To start a run and return before it finishes, drop the `await` and pass your own `requestId`, so you have the id to look it up later. Items are saved to your stores whether you wait or not, and a failed run resolves with `result.error` and does not reject. Attach a `.catch` for the calls that reject, and read the outcome from the request record.

```ts title="scripts/enqueue-reply.ts"
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { runAction } from "@flow-state-dev/engine";
import app from "../fsdev.config";
import support from "../src/flows/support/flow";

export async function enqueueReply(userId: string, message: string) {
  const runtime = await app.getRuntime();
  const requestId = crypto.randomUUID();
  void runAction({
    flow: support,
    actionName: "reply",
    input: { message },
    userId,
    orgId: DEFAULT_ORG_ID,
    requestId,
    stores: runtime.stores,
    runtimeConfig: runtime.runtimeConfig,
  }).catch((error) => console.error("reply was not started", error));
  return requestId;
}

export async function replyStatus(requestId: string) {
  const runtime = await app.getRuntime();
  const record = await runtime.stores.request.get(requestId);
  return record?.status;
}
```

## The finished code

```ts title="scripts/send-reply.ts"
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { runAction } from "@flow-state-dev/engine";
import app from "../fsdev.config";
import support from "../src/flows/support/flow";

export async function sendReply(userId: string, message: string) {
  const runtime = await app.getRuntime();
  const result = await runAction({
    flow: support,
    actionName: "reply",
    input: { message },
    userId, // a userId your job has verified
    orgId: DEFAULT_ORG_ID,
    sessionId: `reply-${userId}`,
    stores: runtime.stores,
    runtimeConfig: runtime.runtimeConfig, // add a modelResolver if the flow has generators
    onItem: (item, kind) => {
      if (kind === "done" && item.type === "message") console.log("message", item.id);
    },
  });
  if (result.error) throw result.error;
  return result.output;
}
```

## Next

- [Flows and actions](../concepts/flows-and-actions.md): what a flow, an action and a flow instance are.
- [Flows reference](../reference/flows.md): lifecycle hooks, session binding, the request record and what `runAction` stores.
- [Errors](../reference/errors.md): the codes `result.error` carries.
