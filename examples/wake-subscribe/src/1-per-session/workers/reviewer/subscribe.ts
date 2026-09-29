/**
 * Compile `subscribe:` / `autoSubscribe:` on a WORKER.md.
 *
 * SKETCH — not a loader change. Hire does not call this. The rows are a
 * fictional subscribe table. They do **not** become `FlowDefinition.webhooks`.
 * Today's adapter routes by `:flowKind` + `on[event]` + optional `sessionId`,
 * and never asks "which sessions already subscribed?"
 *
 * YAML cannot hold functions. `resource: session` means "the PR this
 * session already named." Unknown keys become leftovers.
 */
import { parseFrontmatterYaml, splitFrontmatter } from "@flow-state-dev/orchestration";

export type SubscribeLeftover = {
  id: string;
  reason: string;
};

export type SessionResource = {
  type: "issue" | "pull_request";
  repo: string;
  number: number;
};

/** FICTIONAL row. No adapter reads this today. */
export type SessionSubscription = {
  sessionKey: string;
  provider: string;
  events: string[];
  resource: SessionResource;
};

export type CompiledWorkerSubscribe = {
  provider: string | null;
  events: string[];
  resource: "session" | null;
  autoSubscribe: "on-review-started" | null;
  leftovers: SubscribeLeftover[];
  declaredWithoutSubscribe: Record<string, unknown>;
};

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

/**
 * Parse a WORKER.md subscribe block. Channel-shaped keys are leftovers.
 * Nothing here writes `webhooks` or `schedules`.
 */
export function compileWorkerSubscribe(markdown: string): CompiledWorkerSubscribe {
  const { yaml } = splitFrontmatter(markdown);
  if (yaml.trim().length === 0) {
    throw new Error("WORKER.md has no frontmatter.");
  }

  const declared = parseFrontmatterYaml(yaml);
  const { subscribe, autoSubscribe, route, wakes, ...rest } = declared;
  const leftovers: SubscribeLeftover[] = [];

  if (route != null) {
    leftovers.push({
      id: "route",
      reason: "Style 1 does not compile route rules. That is style 2.",
    });
  }
  if (wakes != null) {
    leftovers.push({
      id: "wakes",
      reason: "`wakes:` is the #2369 authoring sketch. Not this tree.",
    });
  }

  if (subscribe == null) {
    return {
      provider: null,
      events: [],
      resource: null,
      autoSubscribe: null,
      leftovers,
      declaredWithoutSubscribe: rest,
    };
  }

  const row = asRecord(subscribe, "subscribe");
  const provider = asString(row.provider, "subscribe.provider");
  const resource = asString(row.resource, "subscribe.resource");
  if (resource !== "session") {
    leftovers.push({
      id: "subscribe.resource",
      reason: `No compile mapper for resource ${JSON.stringify(resource)}. This sketch only maps \`session\`.`,
    });
  }

  const eventsRaw = row.events;
  if (!Array.isArray(eventsRaw) || eventsRaw.some((event) => typeof event !== "string")) {
    throw new Error("WORKER.md subscribe.events must be a list of strings.");
  }

  let auto: "on-review-started" | null = null;
  if (autoSubscribe != null) {
    const value = asString(autoSubscribe, "autoSubscribe");
    if (value === "on-review-started") {
      auto = value;
    } else {
      leftovers.push({
        id: "autoSubscribe",
        reason: `No compile mapper for autoSubscribe ${JSON.stringify(value)}.`,
      });
    }
  }

  return {
    provider,
    events: eventsRaw as string[],
    resource: resource === "session" ? "session" : null,
    autoSubscribe: auto,
    leftovers,
    declaredWithoutSubscribe: rest,
  };
}

/**
 * SKETCH of auto-subscribe. Not `session.subscribe(...)` — that API
 * does not exist. A review-started handler would record this row.
 */
export function autoSubscribeFromReview(input: {
  sessionKey: string;
  repo: string;
  number: number;
  events: string[];
}): SessionSubscription {
  return {
    sessionKey: input.sessionKey,
    provider: "github",
    events: input.events,
    resource: {
      type: "pull_request",
      repo: input.repo,
      number: input.number,
    },
  };
}

export type MatchableGitHubEvent = {
  provider: string;
  eventType: string | null;
  payload: {
    action?: string;
    repository?: { full_name?: string };
    issue?: { number?: number };
    pull_request?: { number?: number };
  };
};

/**
 * FICTIONAL matcher. Today's webhook adapter does not call this.
 * A delivery reaches a session only when that session already subscribed
 * to this repo + number + event.
 */
export function matchSubscriptions(
  event: MatchableGitHubEvent,
  table: SessionSubscription[],
): SessionSubscription[] {
  const repo = event.payload.repository?.full_name;
  const number =
    event.payload.pull_request?.number ?? event.payload.issue?.number;
  if (repo == null || number == null || event.eventType == null) return [];

  const type = event.payload.pull_request != null ? "pull_request" : "issue";
  return table.filter(
    (row) =>
      row.provider === event.provider &&
      row.events.includes(event.eventType as string) &&
      row.resource.repo === repo &&
      row.resource.number === number &&
      row.resource.type === type,
  );
}
