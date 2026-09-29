/**
 * Compile `route:` on a WORKER.md into today's `webhooks.on`.
 *
 * SKETCH — not a loader change. Hire does not call this. GitHub rows
 * become `defineWebhookBinding` (`when` + `sessionId` + a dispatcher hop).
 * Channel rows are leftovers. Unknown events stay leftovers — no guessed
 * mapper.
 *
 * This is compile-to, not a new FlowDefinition field.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  defineWebhookBinding,
  type WebhookConfig,
} from "@flow-state-dev/core";
import { parseFrontmatterYaml, splitFrontmatter } from "@flow-state-dev/orchestration";
import type { BlockDefinition } from "@flow-state-dev/core";
import {
  inboundFromGitHubIssue,
  inboundFromGitHubPullRequest,
  isIssueOpened,
  isReviewRequested,
  issueSessionId,
  pullRequestSessionId,
} from "../../../shared/github-events";
import { GITHUB_PROVIDER } from "../../../shared/scenario";

export type RouteLeftover = {
  id: string;
  event: string;
  reason: string;
};

export type CompiledDeskRoutes = {
  webhooks: WebhookConfig;
  leftovers: RouteLeftover[];
  declaredWithoutRoute: Record<string, unknown>;
};

type HopCatalog = Record<string, BlockDefinition<any, any>>;

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`WORKER.md ${label} must be a mapping.`);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`WORKER.md ${label} must be a non-empty string.`);
  }
  return value;
}

function resolveHop(seat: string, hops: HopCatalog): BlockDefinition<any, any> {
  const hop = hops[seat];
  if (hop === undefined) {
    throw new Error(
      `WORKER.md route seat ${JSON.stringify(seat)} is not in the hop catalog ` +
        `(${Object.keys(hops).join(", ") || "(empty)"}).`,
    );
  }
  return hop;
}

/**
 * Parse a desk WORKER.md and compile GitHub route rows to `webhooks`.
 */
export function compileRouteRules(markdown: string, hops: HopCatalog): CompiledDeskRoutes {
  const { yaml } = splitFrontmatter(markdown);
  if (yaml.trim().length === 0) {
    throw new Error("WORKER.md has no frontmatter.");
  }

  const declared = parseFrontmatterYaml(yaml);
  const { route, subscribe, autoSubscribe, wakes, ...rest } = declared;
  const leftovers: RouteLeftover[] = [];

  if (subscribe != null || autoSubscribe != null) {
    leftovers.push({
      id: "subscribe",
      event: "subscribe",
      reason: "Style 2 does not compile per-session subscribe. That is style 1.",
    });
  }
  if (wakes != null) {
    leftovers.push({
      id: "wakes",
      event: "wakes",
      reason: "`wakes:` is the #2369 authoring sketch. Not this tree.",
    });
  }

  if (route == null) {
    return { webhooks: {}, leftovers, declaredWithoutRoute: rest };
  }
  if (!Array.isArray(route)) {
    throw new Error("WORKER.md `route:` must be a list of mappings.");
  }

  const webhooks: WebhookConfig = {};

  for (const raw of route) {
    const row = asRecord(raw, "route row");
    const id = asString(row.id, "route id");
    const event = asString(row.event, `route "${id}" event`);

    if (event === "channel") {
      leftovers.push({
        id,
        event,
        reason:
          "Channel poke is Workforce Layer 2 (CHANNEL.md members + " +
          "onChannelPost / wakeMemberSeats). There is no L1 webhook binding to compile to.",
      });
      continue;
    }

    const seat = asString(row.seat, `route "${id}" seat`);
    const when = row.when;
    const session = row.session;
    const hop = resolveHop(seat, hops);

    if (event === "issues") {
      if (when !== undefined && when !== "opened") {
        leftovers.push({
          id,
          event,
          reason: `No compile mapper for issues when ${JSON.stringify(when)}.`,
        });
        continue;
      }
      if (session !== undefined && session !== "issue") {
        leftovers.push({
          id,
          event,
          reason: `No compile mapper for session ${JSON.stringify(session)}.`,
        });
        continue;
      }
      const on = (webhooks[GITHUB_PROVIDER] ??= { on: {} }).on;
      on[event] = defineWebhookBinding({
        block: hop,
        when: when === "opened" ? isIssueOpened : undefined,
        input: inboundFromGitHubIssue,
        sessionId: session === "issue" ? issueSessionId : undefined,
      });
      continue;
    }

    if (event === "pull_request") {
      if (when !== undefined && when !== "review_requested") {
        leftovers.push({
          id,
          event,
          reason: `No compile mapper for pull_request when ${JSON.stringify(when)}.`,
        });
        continue;
      }
      if (session !== undefined && session !== "pull_request") {
        leftovers.push({
          id,
          event,
          reason: `No compile mapper for session ${JSON.stringify(session)}.`,
        });
        continue;
      }
      const on = (webhooks[GITHUB_PROVIDER] ??= { on: {} }).on;
      on[event] = defineWebhookBinding({
        block: hop,
        when: when === "review_requested" ? isReviewRequested : undefined,
        input: inboundFromGitHubPullRequest,
        sessionId: session === "pull_request" ? pullRequestSessionId : undefined,
      });
      continue;
    }

    leftovers.push({
      id,
      event,
      reason:
        `No compile mapper for event ${JSON.stringify(event)}. ` +
        "This sketch maps `issues`, `pull_request`, and `channel` (leftover).",
    });
  }

  return { webhooks, leftovers, declaredWithoutRoute: rest };
}

export function readDeskWorkerMarkdown(): string {
  return readFileSync(join(dirname(fileURLToPath(import.meta.url)), "WORKER.md"), "utf8");
}
