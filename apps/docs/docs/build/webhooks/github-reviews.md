---
title: Hear GitHub reviews in a coding run
type: recipe
description: "Mount workforce's GitHub service flow so a coding run hears reviews, comments and CI on the pull request it opened, from trusted reviewers only, until it merges or closes."
---

# Hear GitHub reviews in a coding run

A coding run opens a pull request, and a teammate leaves a review requesting a change. You want
the run to hear that review, in its own session, without anyone pasting it back in. By the end,
GitHub posts to your server, and each run's session gets the reviews, comments and CI results on
the pull request it opened, until that pull request merges or closes.

Anyone can comment on a public repository, and a run acts on what it hears. So the run only hears
accounts on one stored list, its trusted reviewers. A bot on the list is heard as it is. A user
on the list is heard only while they can also push to the repository.

This page builds on a server with workforce and the harness kit installed, as
[Coding harnesses](../../catalog/harnesses/index.md) sets up.

## 1. Build the list and GitHub

```ts title="fsdev.config.ts"
import { claudeCode } from "@flow-state-dev/claude-code";
import { createFlowState, createWebhookTransportAdapter, githubWebhookVerifier } from "@flow-state-dev/engine";
import { codingDrainBudgetMs, harnesses } from "@flow-state-dev/harness-manager/kit";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import { githubTrustedReviewers, operatorGitHub, operatorGitHubToken } from "@flow-state-dev/workforce";
import { workforce } from "@flow-state-dev/workforce/kit";
import { localWorkspaceHost } from "@flow-state-dev/workspace";
import { signedInUser } from "./src/lib/auth";

const operator = "maya";
const repo = "/work/acme-shop";

const workspace = localWorkspaceHost({
  root: "./runs",
  remotes: { allow: [] },
  localRepositories: [repo],
  source: () => ({ kind: "repo", repo }),
});

// The one list of trusted reviewers, and the tool that changes it.
const reviewers = githubTrustedReviewers({
  operator,
  judgeModel: "openai/gpt-6-luna",
  holders: ["engineering.lead"],
});

// GitHub, read with the operator's token, with the list's screen declared.
const github = operatorGitHub({ operator, token: operatorGitHubToken(), reviewers });

export default createFlowState({
  kits: [
    workforce({
      agent: { model: "openai/gpt-6-luna", uses: [reviewers.capability] },
      // Mounts the GitHub service flow, at /api/flows/github-service/webhooks/github.
      github: { provider: github },
    }),
    // Each pull request a run opens is followed through the list.
    harnesses({ workspace, onPullRequestRecorded: reviewers.follow(github) }),
    claudeCode(),
  ],
  adapters: [
    createWebhookTransportAdapter({
      providers: {
        github: {
          verify: githubWebhookVerifier(() => process.env.GITHUB_WEBHOOK_SECRET!),
          eventType: (_payload, headers) => headers.get("x-github-event"),
          deliveryId: (_payload, headers) => headers.get("x-github-delivery") ?? undefined,
        },
      },
    }),
  ],
  resolvePrincipal: ({ source, request }) =>
    source === "webhook" ? { userId: "github", orgId: "acme" } : signedInUser(request),
  stores: { default: { primary: sqliteStores({ filename: ".fsdev/acme-shop.sqlite" }) } },
  dispatchDrainTimeoutMs: codingDrainBudgetMs({}),
});
```

`githubTrustedReviewers` holds the list. Until someone saves it, the list is whatever
`GITHUB_REVIEWERS` held when the server started: comma-separated logins, a bot as `name[bot]`.

```bash title=".env.local"
GITHUB_REVIEWERS=octocat,github-actions[bot]
GITHUB_WEBHOOK_SECRET=a-long-random-string
```

`operatorGitHub` reads GitHub as one user, the operator, with `GITHUB_TOKEN` or what
`gh auth token` prints. Each time a listed user reviews or comments, it checks with GitHub that they can push. Only the
operator's runs follow their pull requests. Another user's run shows the note
`The pull request <url> is not being followed: <reason>` in its session.

`workforce({ github })` serves the GitHub service flow. It turns each signed delivery into events
and hands each one to the sessions that follow that pull request, once. `reviewers.follow(github)`
is the follower the harness kit gives each run: from the moment a run opens a pull request, its
session hears that pull request's reviews, comments and checks. A merge or close always reaches
the session, whoever made it, and ends the follow, so a task waiting on its pull request wakes.
A task that fails or is cancelled ends its follow too.

`resolvePrincipal` names the organization a delivery belongs to. It runs after the signature
check, so `source === "webhook"` means the delivery is genuine. Use the same organization your
users sign in to. `signedInUser` is your own resolver for everyone else, in `src/lib/auth.ts`.

## 2. Give one worker the list's tool

Nothing in the app writes the list except its tool, `setGitHubReviewers`. A worker named in
`holders` picks it in its file:

```md title="workforce/teams/engineering/workers/lead/WORKER.md"
---
description: Plans the shop's work with you.
capabilities:
  githubReviewers: [tool]
---

Plan the work with the user. Change the trusted reviewers only when they say so.
```

Tell the lead, in your own words, *"Also trust greptile-apps[bot] as a reviewer."* The
change lands only when the operator typed the message and it names each account. An evaluator
reads the message first, and then you approve the exact change in Inbox. Once saved, the list
wins over `GITHUB_REVIEWERS`, an empty list included: emptying it means no run hears anyone.

## 3. Register the webhook on GitHub

In the repository settings, add a webhook:

- **Payload URL:** `https://your-app.example.com/api/flows/github-service/webhooks/github`
- **Content type:** `application/json`
- **Secret:** the same value as `GITHUB_WEBHOOK_SECRET`
- **Events:** Pull requests, Pull request reviews, Pull request review comments, Issue comments
  and Check runs.

A check run is sent by the app that ran it. To hear GitHub Actions, list `github-actions[bot]`.

## 4. Check it worked

Have a run open a pull request, then comment on it as a listed user. The comment shows up in the
run's session. GitHub's "Recent Deliveries" tab shows the answer:
`202 { status: "accepted", provider, eventType, events, ownerRuns, refused }`. A comment from
someone not on the list is accepted too, and reaches no session.

- **401 `invalid_signature`:** the Secret on GitHub differs from `GITHUB_WEBHOOK_SECRET`.
- **404 `flow_not_found`:** the URL's flow segment isn't `github-service`.
- **503:** the server didn't record the delivery. Redeliver it from Recent Deliveries.

The [webhook receivers reference](../../reference/webhooks.md#service-routes) has every response.
To run a block of your own on a GitHub event instead, a flow declares a binding, which the same
page covers.
