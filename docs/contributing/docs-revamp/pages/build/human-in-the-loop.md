---
title: Put a human in the loop
type: tutorial
description: Build an approval gate end to end. A flow stops before a refund goes out, a page lists what is waiting and answers it, and the wait survives a restart.
---

import Figure from "@site/src/components/Figure";
import TheGate from "./figures/the-gate.svg";
import TwoScreens from "./figures/two-screens.svg";

# Put a human in the loop

Some steps should not run until a user says yes: sending money, deleting records, publishing. An approval gate stops a run at one step, writes down where it stopped, and carries on from that step when someone answers, whether that is a minute or a week later.

A waiting run is saved in your app's store, so a wait costs only storage, and a restart or a deploy does not lose it. This page builds one gate: a flow that stops before a refund goes out, a page that lists what is waiting and answers it, and the store settings that keep the wait across a restart.

## What you will build

A support desk has a flow called `support`. A flow is a self-contained system in your app, with actions that clients call and data of its own. Its action here is `refund`, and the action runs a sequencer: a block that runs other blocks in order and records each one's output as it finishes. The refund runs `proposeRefund`, which works out the amount, then `approveRefund`, which asks and waits, then `sendRefund`, which moves the money.

<Figure svg={TheGate} caption="A refund that stops at approveRefund and carries on" description={"A timeline in three columns joined by arrows that mean then. On the left, the first part of the run, in one process, with a dashed outline because it lasts one action run: proposeRefund is hatched because its output is recorded, approveRefund asks whether to refund $250, and sendRefund has not been reached. In the middle, the wait, hatched because it is stored and outlives the request: the finished outputs, the open question and the status suspended, with the note that a restart can happen here. On the right, the second part of the run, in any process, also dashed: proposeRefund reuses its recorded output, approveRefund, highlighted, picks up here, and sendRefund runs once after the answer."} />

By the end, `fsdev run` stops at the question, a page lists it, a click finishes the refund, and the question survives a server restart. You need a project with Flow State installed. [Flows and actions](../concepts/flows-and-actions.md) covers `defineFlow`.

## 1. A flow that proposes a refund

Start with the flow and two of its blocks, with no gate yet. Each block lives in its own file.

```ts title="src/flows/support/blocks/propose-refund.ts"
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

export const proposeRefund = handler({
  name: "propose-refund",
  inputSchema: z.object({ orderId: z.string(), amount: z.number() }),
  outputSchema: z.object({ orderId: z.string(), amount: z.number() }),
  execute: async (input) => ({
    orderId: input.orderId,
    amount: Math.round(input.amount * 100) / 100,
  }),
});
```

```ts title="src/flows/support/blocks/send-refund.ts"
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

export const sendRefund = handler({
  name: "send-refund",
  inputSchema: z.object({ orderId: z.string(), amount: z.number() }),
  outputSchema: z.object({ refunded: z.boolean() }),
  execute: async () => {
    // Your payments call goes here.
    return { refunded: true };
  },
});
```

```ts title="src/flows/support/blocks/handle-refund.ts"
import { sequencer } from "@flow-state-dev/core";
import { proposeRefund } from "./propose-refund";
import { sendRefund } from "./send-refund";

export const handleRefund = sequencer({ name: "handle-refund" })
  .step(proposeRefund)
  .step(sendRefund);
```

```ts title="src/flows/support/flow.ts"
import { defineFlow } from "@flow-state-dev/core";
import { z } from "zod";
import { handleRefund } from "./blocks/handle-refund";

export const supportFlow = defineFlow({
  kind: "support",
  actions: {
    refund: {
      block: handleRefund,
      inputSchema: z.object({ orderId: z.string(), amount: z.number() }),
    },
  },
});

export default supportFlow();
```

`proposeRefund` rounds the amount to cents. In an app it is where a lookup or a model would work out what the customer is owed. `sendRefund` stands in for your payments call. Run the action:

```bash
pnpm fsdev run support refund -i '{"orderId":"order_1042","amount":250}'
```

The run prints its events and ends with a `flow_complete` event whose output is `{"refunded":true}`. Nothing waits.

## 2. Pause for a decision

The gate is a handler that calls `ctx.suspend`.

```ts title="src/flows/support/blocks/approve-refund.ts"
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

export const approveRefund = handler({
  name: "approve-refund",
  inputSchema: z.object({ orderId: z.string(), amount: z.number() }),
  outputSchema: z.object({
    orderId: z.string(),
    amount: z.number(),
    approved: z.boolean(),
  }),
  execute: async (input, ctx) => {
    await ctx.suspend!({
      reason: "user_approval",
      message: `Refund $${input.amount} on ${input.orderId}?`,
    });
    return { ...input, approved: true };
  },
});
```

In `handleRefund`, add `.step(approveRefund)` between the two steps, importing it from `./approve-refund`.

The `reason` of `"user_approval"` makes the question one a user can approve or reject, and `message` is the text they read. On this first pass the call never returns: the step stops and the run is saved. The [durable execution reference](../reference/durable-execution.md) covers the other options of `ctx.suspend`, why the example writes `ctx.suspend!`, and `ctx.suspendForUser`, which hands the answer back as a value.

Pause before the work. `sendRefund` is a separate step after the gate, so the money moves once, and only after an approval.

Run the same command again:

```text
[fsdev] waiting for a person: Refund $250 on order_1042?
[fsdev]   suspension susp_... · request req_... · session sess_...
[fsdev]   Answer it in fsdev dev, which reads this store: .fsdev/data/fsdev.db (SQLite).
[fsdev]   Its deadline fires only while a server runs on this store.
```

The command exits 0, because a wait is not a failure. Between this line and an answer the run sits in the store as a request with the status `suspended`. With no `fsdev.config.ts`, `fsdev run` writes to a SQLite file under `.fsdev/data`, so this pause is already stored. Step 6 covers an app with a config of its own. The [durable execution reference](../reference/durable-execution.md) lists what the store holds for a paused request.

## 3. Show what is waiting

Only the user who owns a request can answer it, so in this tutorial both pages are that user's: the refund page sends the refund, and the approvals page lists what waits and answers it.

<Figure svg={TwoScreens} caption="Two pages, one paused run between them" description={"Three columns joined by arrows that mean sends to the run. On the left, the refund page at /support, showing order_1042 for $250 waiting for approval. In the middle, hatched because it is stored and outlives the request, the paused run of support refund, with the status suspended and a suspension item reading Refund $250 on order_1042. On the right, the approvals page at /approvals, which lists the same question beside a Reject button and an Approve button; the Approve button is highlighted as the answer. An arrow numbered 01 runs from the refund page to the run, and an arrow numbered 02 runs from the approvals page to the run. Notes say the refund page sends the action and the run stops at approveRefund, the approvals page reads the session's items and sends the answer, and both pages belong to one signed-in user."} />

The refund page creates a session and sends the action. A session is where a flow keeps many requests together as one record. It shows the session id so you can open the approvals page.

```tsx title="src/lib/request-refund.tsx"
"use client";
import { FlowProvider, useFlow, useSession } from "@flow-state-dev/react";

export function RequestRefund({ userId }: { userId: string }) {
  return (
    <FlowProvider flowKind="support" userId={userId}>
      <Form />
    </FlowProvider>
  );
}

function Form() {
  const flow = useFlow({ autoCreateSession: true });
  const session = useSession(flow.activeSessionId);
  return (
    <div>
      <button
        disabled={!flow.activeSessionId}
        onClick={() => session.sendAction("refund", { orderId: "order_1042", amount: 250 })}
      >
        Ask for a $250 refund
      </button>
      <p>Approvals page: /approvals/{flow.activeSessionId}</p>
    </div>
  );
}
```

When the run stopped, it put a `suspension` item in the session's items, the ordered list of everything the flow emitted into the session. The approvals page reads that list, and `useSuspensions` returns the questions in it that nobody has answered. The page lists only the questions in the session it reads, not every waiting run in the app. The [items reference](../reference/items.md) lists the `suspension` and `suspension_resume` items and their fields.

```tsx title="src/lib/pending-refunds.tsx"
"use client";
import { FlowProvider, useSession, useSuspensions } from "@flow-state-dev/react";

export function PendingRefunds({ sessionId, userId }: { sessionId: string; userId: string }) {
  return (
    <FlowProvider flowKind="support" userId={userId}>
      <Queue sessionId={sessionId} />
    </FlowProvider>
  );
}

function Queue({ sessionId }: { sessionId: string }) {
  const session = useSession(sessionId, { live: true });
  const { pending } = useSuspensions(session, { reasons: ["user_approval"] });
  return (
    <ul>
      {pending.map(({ item }) => (
        <li key={item.suspensionId}>{item.message}</li>
      ))}
    </ul>
  );
}
```

`live: true` makes the page hear requests it did not send, such as one started in another tab; the [client reference](../reference/client.md) lists the options of `useSession`. `item.message` is the string `approveRefund` passed to `ctx.suspend`.

Render `PendingRefunds` at `/approvals/[sessionId]`. Request the refund on the refund page, then open that address. The page lists `Refund $250 on order_1042?`.

## 4. Approve or reject from the page

Give each row a card that answers. `useApproval` takes one `suspension` item and returns the click handlers and the state to draw.

```tsx title="src/lib/refund-card.tsx"
import { useApproval, type SuspensionView } from "@flow-state-dev/react";

export function RefundCard({ view }: { view: SuspensionView }) {
  const { item } = view;
  const a = useApproval(item, {
    isResolved: !view.pending,
    resolution: view.pending ? undefined : view.status,
  });
  if (a.resolved) {
    return <p>{a.outcome.icon} {a.outcome.label}</p>;
  }
  return (
    <div>
      <p>{item.message}</p>
      <button disabled={!a.canApprove || a.isResolving} onClick={a.approve}>
        Approve
      </button>
      <button disabled={!a.canReject || a.isResolving} onClick={a.reject}>
        Reject
      </button>
      {a.error && <p role="alert">{a.error}</p>}
    </div>
  );
}
```

In `Queue`, list `suspensions` instead of `pending`, so an answered row stays on the page. Render `<RefundCard view={view} />` for each `view` in place of `{item.message}`, and wrap the list in `<SuspensionResolverProvider resolve={session.answerSuspension}>`, imported from `@flow-state-dev/react`. The provider answers through the session, so after a click the card shows the rest of the run as it happens. The [durable execution reference](../reference/durable-execution.md) lists the four ways to answer.

A list can answer without cards. `useSuspensions` also returns `approve(suspensionId)` and `reject(suspensionId)`, one call each.

Click Approve. The card turns into its outcome, and the refund goes out.

Who may answer depends on sign-in. This tutorial's app has none, so the server cannot tell callers apart: anyone who can reach its API can answer the question, and the log records the request's owner as the one who answered. That is fine on your own machine and not for anything shared.

With sign-in on, the approvals page has to be the same signed-in user, in another tab or on a phone. A support manager who logs in as a different user and opens the customer's session cannot approve the refund: the answer comes back 404, the same as for a request that does not exist, and the run stays suspended. The log records who answered from the signed-in caller, so a `resumedBy` field in the request body changes nothing either way. [Auth and tenancy](../concepts/auth-and-tenancy.md) covers turning sign-in on, and the [durable execution reference](../reference/durable-execution.md) lists who may answer and what a refused answer gets back.

## 5. Resume, and what runs again

Approving continues the same request under the same id, and the items after the pause join the ones before it.

On resume, a block that finished is not run again. Its recorded output is reused.

- `proposeRefund` is not run again.
- `approveRefund` runs again from its top, because it is the block that paused. This time `ctx.suspend` returns the answer.
- `sendRefund` runs once, after the answer.

So anything `approveRefund` did before its `ctx.suspend` call would happen twice. Keep work after the gate, as `sendRefund` does. The [durable execution reference](../reference/durable-execution.md) lists the guard for work that has to come first.

Reject takes the other path. `ctx.suspend` throws `SuspensionRejectedError` inside `approveRefund`, and with nothing to catch it the request ends in an error. The [durable execution reference](../reference/durable-execution.md) shows how to catch it with `.rescue`, for example to tell the customer.

## 6. Survive a restart

The wait lives in whatever store the app uses. A store that persists keeps it across a restart or a deploy, and any process on the same store can pick it up. Name one in the app's config:

```ts title="fsdev.config.ts"
import { createFlowState } from "@flow-state-dev/engine";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import support from "./src/flows/support/flow";

export default createFlowState({
  flows: [support],
  stores: sqliteStores({ filename: "support.db" }),
});
```

SQLite, Postgres and the filesystem store all keep a pause. With no `stores`, `createFlowState` keeps everything in memory, and the run fails at the gate. The [runtime reference](../reference/runtime.md) lists which stores hold a pause and the defaults for `fsdev dev` and `fsdev run`.

Start `fsdev dev` and ask for a refund. Stop the server, start it again, and open the approvals page. The refund is listed, and approving it completes the same request. A pause with no deadline waits until it is answered. The [durable execution reference](../reference/durable-execution.md) covers deadlines and clean-up.

## 7. Let a model or a router ask too

A gate does not have to be a step of your own. A model asks through a tool, which is a block the model can call. `issueRefund` pauses the way `approveRefund` does.

```ts title="src/flows/support/tools/issue-refund.ts"
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

export const issueRefund = handler({
  name: "issue-refund",
  description: "Refund an order. Use it when the customer asks for their money back.",
  inputSchema: z.object({ orderId: z.string(), amount: z.number() }),
  outputSchema: z.object({ refunded: z.boolean() }),
  execute: async (input, ctx) => {
    await ctx.suspend!({
      reason: "user_approval",
      message: `Refund $${input.amount} on ${input.orderId}?`,
    });
    // Your payments call goes here, after the answer.
    return { refunded: true };
  },
});
```

Suppose the support flow has a generator, `draftReply` in `blocks/draft-reply.ts`, that writes the reply to the customer. Add `tools: [issueRefund]` to it, importing the tool from `../tools/issue-refund`. When the model calls the tool, the request stops the way step 2 did: `fsdev run` prints `waiting for a person: Refund $250 on order_1042?` with the amount and order the model chose, the same `suspension` item reaches the approvals page, and the same card answers it. After approval the tool carries on past the call and returns its real result to the model. The [durable execution reference](../reference/durable-execution.md) covers what a rejection and a resume mean for the model.

A router picks one block to run, and the block it picks can pause. The router has no pause call of its own.

```ts title="src/flows/support/blocks/triage.ts"
import { router } from "@flow-state-dev/core";
import { approveRefund } from "./approve-refund";
import { autoRefund } from "./auto-refund";

export const triage = router({
  name: "triage",
  routes: [autoRefund, approveRefund],
  execute: (input) => (input.amount > 100 ? approveRefund : autoRefund),
});
```

`autoRefund` passes a small refund on without asking. It returns the same shape as `approveRefund`, because a router's branches share one output.

```ts title="src/flows/support/blocks/auto-refund.ts"
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

export const autoRefund = handler({
  name: "auto-refund",
  inputSchema: z.object({ orderId: z.string(), amount: z.number() }),
  outputSchema: z.object({
    orderId: z.string(),
    amount: z.number(),
    approved: z.boolean(),
  }),
  execute: async (input) => ({ ...input, approved: true }),
});
```

In `handleRefund`, `triage` takes the place of `approveRefund`. Keep the selector a pure function of its input, so it picks the same branch after a wait. The [durable execution reference](../reference/durable-execution.md) lists what happens when it does not.

## Next

- [Pausing, resuming and surviving a crash](../concepts/pausing-resuming-and-surviving-a-crash.md) explains the idea behind the gate and how a crash differs from a pause.
- [Durable execution reference](../reference/durable-execution.md) lists every option of `ctx.suspend`, the four ways to answer, refusals, deadlines and retention.
- [Generators and tools](../concepts/generators-and-tools.md) covers the model and the tools it calls.
- [Tasks and boards](../concepts/tasks-and-boards.md) covers a task on a board waiting for a user, which shows up in an Inbox.
