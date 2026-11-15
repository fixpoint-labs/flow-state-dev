---
title: Receive a GitHub webhook
type: recipe
description: "Run a block in a flow when a GitHub pull request opens, with a verified signature and the event type read from a header."
---

# Receive a GitHub webhook

When someone opens a pull request on your repository, you want it reviewed.
GitHub signs every delivery, and the server checks the signature before anything
runs. By the end, GitHub can POST to an endpoint and a `repo` flow runs a review
block for each opened pull request.

GitHub sends every webhook for a repository to one URL, with the event type
(`pull_request`, `push`) in the `X-GitHub-Event` header. The sub-event
(`opened`, `closed`) is the body's `action` field. An `eventType` function reads
the header, and a `when` predicate on the binding narrows to `opened`.

## 1. The flow declares routing

The flow says which GitHub event runs which block. The secret and signature
check go on the server, in step 2. `reviews` is your own helper that starts a
review. This stub stands in for it.

```ts title="src/lib/reviews.ts"
export const reviews = {
  async start(key: string, data: unknown): Promise<void> {
    // Replace with your review logic. Calling twice with the same key must be safe.
    console.log("review started", key, data);
  },
};
```

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
  authentication: {
    // Only deliveries that passed the signature check get an identity.
    // Every other request, such as a read of these sessions, gets a 401.
    resolvePrincipal: ({ source }) =>
      source === "webhook" ? { orgId: "acme" } : null,
    defaultUserId: "github-bot",
    requireUser: false,
  },
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
delivery is acknowledged and ignored.

`resolvePrincipal` decides who a request runs as. It runs after the signature
check, so `source === "webhook"` means the delivery is genuine. It returns your
organization's id (`acme` here), and `defaultUserId` names the user, since no
signed-in user sends a webhook. Any other request gets `null`, which the server
answers with a 401. Without a resolver, anyone who can reach the server could
list these sessions and read each request's input, the repo, title and URL.

`sessionId` gives each pull request its own session. PRs 42 and 43 on `acme/api`
make two sessions, `acme/api#42` and `acme/api#43`. The first delivery for a key
creates its session and later ones reuse it, even if two first deliveries
arrive at once. `github-bot` owns the sessions, and they live in the `stores`
profile's session store, so `inMemoryStores()` loses them on restart. Without
`sessionId`, every delivery gets a fresh ephemeral session.

## 2. The server verifies and reads the header

`createWebhookTransportAdapter` holds the signature check and the header
lookup, under the same `github` name.

```ts title="src/lib/flowstate.ts"
import { after } from "next/server";
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
  // Keep the function alive until the block finishes. The 202 goes out first.
  onBackgroundWork: (work) => after(() => work),
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
body and your secret. A failed check gets a 401 and nothing runs.

`deliveryId` records GitHub's `X-GitHub-Delivery` id on
`metadata.webhook.deliveryId`. The framework does not deduplicate on it, so the
block above keys its write on the repo and PR number.

The server answers before the block finishes, and Vercel can freeze the
function once the answer is sent. `onBackgroundWork` hands each run to Next's
`after()`, which keeps the function alive until the run ends. Without it, a
delivery can get its `202` and never finish, and GitHub has no reason
to send it again.

## 3. Register the webhook on GitHub

In the repository (or organization) settings, add a webhook:

- **Payload URL:** `https://your-app.example.com/api/flows/repo/webhooks/github`
- **Content type:** `application/json`
- **Secret:** the same value as `GITHUB_WEBHOOK_SECRET`
- **Events:** "Pull requests". An event with no binding is acknowledged and
  ignored, so selecting more is safe.

## 4. Check it worked

Open a pull request, then open the webhook's "Recent Deliveries" tab on GitHub.
It shows each request and response, and can redeliver a payload. Success is
`202 { status: "accepted", provider, eventType, requestId }`, sent before the
block finishes. An error inside the block is recorded on the request that
`requestId` names, not in the response.

A failed delivery tells you what to fix:

- **401 `invalid_signature`:** the Secret on GitHub differs from what
  `GITHUB_WEBHOOK_SECRET` returns, or the body was altered.
- **400 `invalid_payload`:** the body isn't JSON. Set Content type to
  `application/json`.
- **404 `flow_not_found`:** the flow id in the URL is wrong. **404
  `webhook_not_found`:** the last URL segment isn't `github`.

The [webhook receivers reference](../../reference/webhooks.md) covers every response
code.
