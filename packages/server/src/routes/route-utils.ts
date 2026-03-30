/**
 * Shared utilities for route handlers: response builders, parsing, and validation helpers.
 */
import type {
  JsonObject,
  ResourceConfig,
  ResourceCollectionConfig
} from "@flow-state-dev/core/types";
import { matchesPattern, resolveCollectionKey } from "@flow-state-dev/core/types";
import type { OutputItem, RequestStatusEvent, RequestStreamEvent } from "@flow-state-dev/core/items";
import { ValidationError, FlowError } from "../errors/flow-error";
import type { RequestRecord } from "../stores/types";
import { cloneValue } from "../utils/clone";
import { isJsonObject } from "../utils/json-helpers";
import { sortItemsChronologically } from "../utils/sort";

export const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8"
};

export const SSE_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache",
  connection: "keep-alive"
};

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS
  });
}

export function emptyResponse(status: number): Response {
  return new Response(null, { status });
}

export function asObject(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

export function getString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

export function getPositiveInteger(value: string | null): number | undefined {
  if (value === null) {
    return undefined;
  }

  if (!/^\d+$/.test(value)) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed)) {
    return undefined;
  }

  return parsed;
}

export function getBooleanFlag(value: string | null): boolean {
  if (value === null) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1";
}

export type ClientDataScope = "session" | "user" | "project";
export type ClientDataFilter = Partial<Record<ClientDataScope, Set<string>>>;

export function parseClientDataFilter(value: string | null): ClientDataFilter | undefined {
  if (value === null || value.trim().length === 0) {
    return undefined;
  }

  const parsed: ClientDataFilter = {};
  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  for (const entry of entries) {
    const [scopeCandidate, dataName] = entry.split(".", 2);
    const isScoped =
      scopeCandidate === "session" ||
      scopeCandidate === "user" ||
      scopeCandidate === "project";
    const scope: ClientDataScope = isScoped ? scopeCandidate : "session";
    const name = isScoped ? dataName : scopeCandidate;

    if (name === undefined || name.trim().length === 0) {
      continue;
    }

    if (parsed[scope] === undefined) {
      parsed[scope] = new Set<string>();
    }

    parsed[scope]!.add(name.trim());
  }

  if (Object.keys(parsed).length === 0) {
    return undefined;
  }

  return parsed;
}

export function shouldIncludeClientData(
  filter: ClientDataFilter | undefined,
  scope: ClientDataScope,
  name: string
): boolean {
  if (filter === undefined) {
    return true;
  }

  const values = filter[scope];
  if (values === undefined) {
    return false;
  }

  return values.has(name);
}

export function isResourceConfig(value: unknown): value is ResourceConfig {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as { stateSchema?: { safeParse?: unknown } };
  return (
    typeof candidate.stateSchema === "object" &&
    candidate.stateSchema !== null &&
    typeof candidate.stateSchema.safeParse === "function"
  );
}

export function normalizeResourceDefault(config: ResourceConfig): JsonObject {
  if (config.default !== undefined && isJsonObject(config.default)) {
    return cloneValue(config.default);
  }

  const parsedUndefined = config.stateSchema.safeParse(undefined);
  if (parsedUndefined.success && isJsonObject(parsedUndefined.data)) {
    return parsedUndefined.data;
  }

  const parsedEmpty = config.stateSchema.safeParse({});
  if (parsedEmpty.success && isJsonObject(parsedEmpty.data)) {
    return parsedEmpty.data;
  }

  return {};
}

export function normalizeResourceState(config: ResourceConfig, value: unknown): JsonObject {
  const parsed = config.stateSchema.safeParse(value);
  if (parsed.success && isJsonObject(parsed.data)) {
    return parsed.data;
  }

  return normalizeResourceDefault(config);
}

function isCollectionConfig(value: unknown): value is ResourceCollectionConfig {
  return (
    typeof value === "object" &&
    value !== null &&
    "pattern" in value &&
    typeof (value as ResourceCollectionConfig).pattern === "string"
  );
}

export function createScopeResources(options: {
  configs: Record<string, unknown> | undefined;
  persisted: Record<string, unknown> | undefined;
  persistedContent?: Record<string, string> | undefined;
}): Record<string, Record<string, unknown>> {
  const handles: Record<string, Record<string, unknown>> = {};
  const contentMap = options.persistedContent ?? {};

  for (const [resourceName, maybeConfig] of Object.entries(options.configs ?? {})) {
    if (isCollectionConfig(maybeConfig)) {
      // Build a lightweight read-only collection ref for clientData computation.
      // Instances are stored as path-keyed entries in the persisted resources map.
      const pattern = maybeConfig.pattern;
      const persisted = options.persisted ?? {};

      function makeInstanceRef(key: string, value: unknown) {
        return {
          name: key,
          get state() { return isJsonObject(value) ? value : {}; },
          async readContent() { return contentMap[key] ?? null; },
          async readContentRaw() { return contentMap[key] ?? null; }
        };
      }

      handles[resourceName] = {
        pattern,
        config: maybeConfig,
        list() {
          return Object.entries(persisted)
            .filter(([key]) => matchesPattern(pattern, key))
            .map(([key, value]) => makeInstanceRef(key, value));
        },
        count() {
          return Object.keys(persisted).filter((key) => matchesPattern(pattern, key)).length;
        },
        get(key: string | Record<string, string>) {
          const storageKey = resolveCollectionKey(pattern, key);
          const value = persisted[storageKey];
          if (value === undefined) {
            throw new Error(`Resource instance "${storageKey}" not found in collection "${pattern}"`);
          }
          return makeInstanceRef(storageKey, value);
        },
        getOptional(key: string | Record<string, string>) {
          const storageKey = resolveCollectionKey(pattern, key);
          const value = persisted[storageKey];
          if (value === undefined) return undefined;
          return makeInstanceRef(storageKey, value);
        }
      };
      continue;
    }

    if (!isResourceConfig(maybeConfig)) {
      continue;
    }

    const readState = (): JsonObject =>
      cloneValue(
        normalizeResourceState(
          maybeConfig,
          options.persisted?.[resourceName]
        )
      );

    handles[resourceName] = {
      name: resourceName,
      config: maybeConfig,
      get state() {
        return readState();
      }
    };
  }

  return handles;
}

export async function computeClientData(options: {
  definitions: Record<string, unknown> | undefined;
  scope: ClientDataScope;
  filter: ClientDataFilter | undefined;
  state: JsonObject;
  resources: Record<string, Record<string, unknown>>;
}): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};

  for (const [name, compute] of Object.entries(options.definitions ?? {})) {
    if (typeof compute !== "function") {
      continue;
    }

    if (!shouldIncludeClientData(options.filter, options.scope, name)) {
      continue;
    }

    out[name] = await (
      compute as (ctx: { state: JsonObject; resources: Record<string, unknown> }) => unknown
    )({
      state: options.state,
      resources: options.resources
    });
  }

  return out;
}

export function sortItems(items: OutputItem[] | undefined): OutputItem[] {
  if (!Array.isArray(items)) {
    return [];
  }

  return sortItemsChronologically(items);
}

export function requestStatusEventType(status: RequestRecord["status"]): RequestStatusEvent["type"] {
  if (status === "completed") {
    return "request.completed";
  }

  if (status === "failed") {
    return "request.failed";
  }

  if (status === "incomplete") {
    return "request.incomplete";
  }

  return "request.in_progress";
}

export function buildReplayEvents(record: RequestRecord): RequestStreamEvent[] {
  const createdAt = record.startedAtMs ?? record.createdAt;
  const statusTs =
    record.completedAtMs ??
    record.failedAtMs ??
    record.updatedAt ??
    createdAt;

  const events: RequestStreamEvent[] = [
    {
      stream: "request",
      type: "request.created",
      requestId: record.id,
      sequence_number: 1,
      status: "in_progress",
      ts: createdAt
    }
  ];

  let seq = 2;
  if (record.items !== undefined) {
    for (const item of record.items) {
      events.push({
        stream: "request",
        type: "item.added",
        requestId: record.id,
        sequence_number: seq++,
        ts: item.ts ?? createdAt,
        item
      });
      events.push({
        stream: "request",
        type: "item.done",
        requestId: record.id,
        sequence_number: seq++,
        ts: item.ts ?? createdAt,
        item
      });
    }
  }

  events.push({
    stream: "request",
    type: requestStatusEventType(record.status),
    requestId: record.id,
    sequence_number: seq,
    status: record.status,
    ts: statusTs
  });

  return events;
}

export function errorStatus(error: Error): number {
  if (error instanceof ValidationError) {
    return 400;
  }

  if (error instanceof FlowError && error.code === "validation_error") {
    return 400;
  }

  return 500;
}

export async function parseJsonBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.trim().length === 0) {
    return {};
  }

  const parsed = JSON.parse(text);
  const object = asObject(parsed);
  if (object === undefined) {
    throw new ValidationError("Request body must be a JSON object", {
      scope: "request"
    });
  }

  return object;
}
