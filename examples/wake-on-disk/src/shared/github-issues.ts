/**
 * GitHub `issues` mapping a customer writes next to the webhook binding.
 *
 * GitHub puts the event name in `X-GitHub-Event` (`issues`) and the sub-event
 * in `payload.action`. The flow key is `issues`; `when` narrows to `opened`.
 */
import type { WebhookInboundEvent } from "@flow-state-dev/core";

export interface GitHubIssuesEvent {
  action: string;
  issue: { number: number; title: string };
  repository: { full_name: string };
}

export function isIssueOpened(event: WebhookInboundEvent<GitHubIssuesEvent>): boolean {
  return event.payload.action === "opened";
}

export function inboundFromGitHubIssue(event: WebhookInboundEvent<GitHubIssuesEvent>) {
  return {
    provider: event.provider,
    repo: event.payload.repository.full_name,
    issueNumber: event.payload.issue.number,
    title: event.payload.issue.title,
    deliveryId: event.deliveryId,
  };
}

/** Continuity key: one conversation per issue, not a new session per delivery. */
export function issueSessionId(event: WebhookInboundEvent<GitHubIssuesEvent>): string {
  return `${event.payload.repository.full_name}#${event.payload.issue.number}`;
}
