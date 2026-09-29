/**
 * GitHub issue / pull-request mapping a customer writes next to a binding.
 *
 * GitHub puts the event name in `X-GitHub-Event` and the sub-event in
 * `payload.action`. Style 2 compiles `when` + `sessionId` from those.
 * Style 1 does not — it matches a prior subscribe, not the payload alone.
 */
import type { WebhookInboundEvent } from "@flow-state-dev/core";

export interface GitHubIssuesEvent {
  action: string;
  issue: { number: number; title: string };
  repository: { full_name: string };
}

export interface GitHubPullRequestEvent {
  action: string;
  pull_request: { number: number; title: string };
  repository: { full_name: string };
}

export function isIssueOpened(event: WebhookInboundEvent<GitHubIssuesEvent>): boolean {
  return event.payload.action === "opened";
}

export function isReviewRequested(
  event: WebhookInboundEvent<GitHubPullRequestEvent>,
): boolean {
  return event.payload.action === "review_requested";
}

export function inboundFromGitHubIssue(event: WebhookInboundEvent<GitHubIssuesEvent>) {
  return {
    provider: event.provider,
    kind: "issue" as const,
    repo: event.payload.repository.full_name,
    number: event.payload.issue.number,
    title: event.payload.issue.title,
    deliveryId: event.deliveryId,
  };
}

export function inboundFromGitHubPullRequest(
  event: WebhookInboundEvent<GitHubPullRequestEvent>,
) {
  return {
    provider: event.provider,
    kind: "pull_request" as const,
    repo: event.payload.repository.full_name,
    number: event.payload.pull_request.number,
    title: event.payload.pull_request.title,
    deliveryId: event.deliveryId,
  };
}

/** Continuity key: one conversation per issue, not a new session per delivery. */
export function issueSessionId(event: WebhookInboundEvent<GitHubIssuesEvent>): string {
  return `${event.payload.repository.full_name}#${event.payload.issue.number}`;
}

export function pullRequestSessionId(
  event: WebhookInboundEvent<GitHubPullRequestEvent>,
): string {
  return `${event.payload.repository.full_name}#pr${event.payload.pull_request.number}`;
}
