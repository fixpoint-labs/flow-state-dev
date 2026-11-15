---
title: Receive a GitHub webhook
type: recipe
description: "Run a block in a flow when a GitHub pull request opens, with a verified signature and the event type read from a header."
---

# Receive a GitHub webhook

When someone opens a pull request on your repository, you want it reviewed.
GitHub signs every delivery, so the server checks the signature before anything
runs. By the end you have an endpoint GitHub can POST to and a `repo` flow that
runs a review block for each opened pull request.

GitHub sends every webhook for a repository to one URL. It puts the event type
(`pull_request`, `push`, `issues`) in the `X-GitHub-Event` header, not in the
body. The sub-event (`opened`, `closed`, `synchronize`) is the body's `action`
field. You tell the server where to find the event type with an `eventType`
function, and narrow to `opened` with a `when` predicate on the binding.

## 1. The flow declares routing

The flow says which GitHub event runs which block. The secret and the signature
check go on the server, in step 2.

`reviewPullRequest` is the block that does the work. `reviews` is your own
helper that starts a review.

```ts title="src/flows/repo/blocks/review-pull-request.ts"
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { reviews } from "../../../lib/reviews";

export const reviewPullRequest = handler({
  name: "review-pull-request",
  inputSchema: z.object({
    repo: z.string(),
    prNumber: z.number(),
    title: z.string(),
    url: z.string(),
    headSha: z.string(),
  }),
  execute: async (input) => {
    // Idempotent write keyed on repo and PR number: GitHub can deliver twice.
    await reviews.start(`${input.repo}#${input.prNumber}`, input);
  },
});
```

```ts title="src/flows/repo/flow.ts"
import { defineFlow, defineWebhookBinding } from "@flow-state-dev/core";
import { reviewPullRequest } from "./blocks/review-pull-request";

interface PullRequestEvent {
  action: string; // "opened" | "closed" | "synchronize" | ...
  number: number;
  pull_request: { title: string; html_url: string; head: { sha: string } };
  repository: { full_name: string };
}

export const repoFlow = defineFlow({
  kind: "repo",
  actions: {}, // no caller-facing actions: webhooks are the only way in
  authentication: { defaultUserId: "github-bot", requireUser: false },
  webhooks: {
    github: {
      on: {
        // Keyed by the X-GitHub-Event value, narrowed to the "opened" action.
        pull_request: defineWebhookBinding<PullRequestEvent>({
          block: reviewPullRequest,
          when: (e) => e.payload.action === "opened",
          input: (e) => ({
            repo: e.payload.repository.full_name,
            prNumber: e.payload.number,
            title: e.payload.pull_request.title,
            url: e.payload.pull_request.html_url,
            headSha: e.payload.pull_request.head.sha,
          }),
          sessionId: (e) => `${e.payload.repository.full_name}#${e.payload.number}`,
        }),
      },
    },
  },
});
```

The `on` key is `pull_request`, the value of `X-GitHub-Event`. It is never
`pull_request.opened`, because `opened` is the body's `action` and `when`
handles it. A closed or synchronized pull request fails the predicate, and the
delivery is acknowledged and ignored. `sessionId` gives each pull request its
own session. `requireUser: false` with a `defaultUserId` runs each delivery as
a bot user, since no signed-in user sends a webhook.

## 2. The server verifies and reads the header

You set up the signature check and the header lookup on
`createWebhookTransportAdapter`, under the same `github` name the flow used.

```ts title="src/lib/flowstate.ts"
import {
  createFlowState,
  createWebhookTransportAdapter,
  githubWebhookVerifier,
  inMemoryStores,
} from "@flow-state-dev/engine";
import { repoFlow } from "../flows/repo/flow";

export const flowstate = createFlowState({
  flows: [repoFlow()],
  stores: { default: { primary: inMemoryStores() } },
  adapters: [
    createWebhookTransportAdapter({
      providers: {
        github: {
          verify: githubWebhookVerifier(() => process.env.GITHUB_WEBHOOK_SECRET!),
          // The event type is in a header, not the body.
          eventType: (_payload, headers) => headers.get("x-github-event"),
          deliveryId: (_payload, headers) => headers.get("x-github-delivery") ?? undefined,
        },
      },
    }),
  ],
});
```

```ts title="src/app/api/flows/[...path]/route.ts"
import { flowstate } from "../../../../lib/flowstate";
import { createVercelNextHandler } from "@flow-state-dev/vercel/next";

export const { GET, POST, PATCH, DELETE } = createVercelNextHandler(flowstate);
```

The endpoint is `POST /api/flows/repo/webhooks/github`.
`githubWebhookVerifier` checks the `X-Hub-Signature-256` header against the raw
body and your secret. A delivery that fails the check gets a 401 and nothing
runs.

`deliveryId` puts GitHub's `X-GitHub-Delivery` id on `metadata.webhook.deliveryId`
as a record of where the run came from. The framework does not deduplicate on
it, which is why the block above keys its write on the repo and PR number.

## 3. Register the webhook on GitHub

In the repository (or organization) settings, add a webhook:

- **Payload URL:** `https://your-app.example.com/api/flows/repo/webhooks/github`
- **Content type:** `application/json`
- **Secret:** the same value as `GITHUB_WEBHOOK_SECRET`
- **Events:** select "Pull requests". Or select "Send me everything" and let
  `when` filter; an event with no binding is acknowledged and ignored.

A delivery the server accepts gets a 202. GitHub's webhook settings page has a
"Recent Deliveries" tab that shows each request and response, with a redeliver
button. Open a pull request, then check the tab for a 202 and your review block
running.

The [webhook receivers reference](/docs/server/webhooks) covers the other
response codes, the delivery id, and the `when` predicate in full.
