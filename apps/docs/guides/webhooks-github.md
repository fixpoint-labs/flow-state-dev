---
title: Receiving GitHub webhooks
sidebar_label: GitHub
---

# Receiving GitHub webhooks

This guide wires a GitHub "pull request opened" event to a review action.
GitHub is a useful second example because it puts the event type in a header,
not the body — which is exactly why the host's `eventType` extractor exists.

**What we're building:** when a pull request opens, our `repo` flow runs a
`reviewPullRequest` action. GitHub signs each delivery; we verify it, read the
event name off the `X-GitHub-Event` header, and narrow to the `opened` action
with a `when` predicate.

## The header discriminator

GitHub sends every webhook for a repository to the same URL. It does not put the
event name in the body — it puts it in the `X-GitHub-Event` header
(`pull_request`, `push`, `issues`, …). The actual sub-event (opened, closed,
synchronized) lives in the body's `action` field.

So routing happens in two steps:

1. The host's `eventType` reads `X-GitHub-Event` → `"pull_request"`.
2. The binding's `when` narrows on `payload.action === "opened"`.

## 1. The flow declares routing

```ts title="flows/repo.ts"
import { defineFlow, defineWebhookBinding, sequencer } from "@flow-state-dev/core";

interface PullRequestEvent {
  action: string; // "opened" | "closed" | "synchronize" | ...
  number: number;
  pull_request: { title: string; html_url: string; head: { sha: string } };
  repository: { full_name: string };
}

export const repoFlow = defineFlow({
  kind: "repo",
  authentication: { defaultUserId: "github-bot", requireUser: false },
  webhooks: {
    github: {
      on: {
        // Keyed by X-GitHub-Event, narrowed to the "opened" action.
        pull_request: defineWebhookBinding<PullRequestEvent>({
          block: reviewPipeline,
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

The `on` key is `pull_request` — the value of `X-GitHub-Event` — not
`pull_request.opened`. The `opened` part is the body's `action`, and `when`
handles it. A closed or synchronized PR fails the predicate, so the event is
acknowledged and ignored.

Deriving the session from `repo#number` keeps every event for one PR in the same
session, so a re-review picks up where the last left off.

## 2. The host verifies and reads the header

```ts title="lib/flowstate.ts"
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import {
  createWebhookTransportAdapter,
  githubWebhookVerifier,
} from "@flow-state-dev/engine";
import { repoFlow } from "@/flows/repo";

export const flowstate = createFlowState({
  flows: { repoFlow },
  stores: { default: { primary: inMemoryStores() } },
  adapters: [
    createWebhookTransportAdapter({
      providers: {
        github: {
          verify: githubWebhookVerifier(() => process.env.GITHUB_WEBHOOK_SECRET!),
          // The event type is in a HEADER, not the body.
          eventType: (_payload, headers) => headers.get("x-github-event"),
          deliveryId: (_payload, headers) => headers.get("x-github-delivery") ?? undefined,
        },
      },
    }),
  ],
});
```

`githubWebhookVerifier` reads `X-Hub-Signature-256` (`sha256=<hex>`) and signs
the raw body — the scheme GitHub documents under "Securing your webhooks". The
`eventType` function pulls the discriminator from the header instead of the
payload, the one place GitHub diverges from a body-typed provider like Stripe.
GitHub's per-delivery `X-GitHub-Delivery` id flows onto `metadata.webhook` for
deduplication.

```ts title="app/api/flows/[...path]/route.ts"
import { flowstate } from "@/lib/flowstate";
import { createVercelNextHandler } from "@flow-state-dev/vercel/next";

export const { GET, POST, PATCH, DELETE } = createVercelNextHandler(flowstate);
```

## 3. Register the webhook on GitHub

In the repository (or organization) settings, add a webhook:

- **Payload URL** — `https://your-app.example.com/api/flows/repo/webhooks/github`
- **Content type** — `application/json`
- **Secret** — the same value as `GITHUB_WEBHOOK_SECRET`
- **Events** — select "Pull requests" (or "Send me everything" and let `when`
  filter)

GitHub's webhook settings page has a "Recent Deliveries" tab. Each delivery
shows the request, the response, and a redeliver button — the fastest way to
confirm a 202 came back and to replay a payload while iterating.

## What you have

- A verified GitHub endpoint at `POST /api/flows/repo/webhooks/github`.
- `pull_request` deliveries narrowed to opened PRs, routed to
  `reviewPullRequest`, keyed per PR.
- The header-based event type handled by the host's `eventType` extractor.

For the full surface, see the [webhook receivers reference](/docs/server/webhooks).
