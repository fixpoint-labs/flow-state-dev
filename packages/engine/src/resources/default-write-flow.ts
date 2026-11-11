// FIX-2624.
/**
 * The default write flow, and the write session a client's write runs in.
 *
 * A client writes a user or org resource only through a flow (epic ER-4): the
 * one its `runBy` names, or, for `runBy: "default"`, this one. A write is an
 * ordinary action on the action route, so it records a request naming its
 * writer, and it runs in a session the server finds or makes for that writer:
 * one per tenant, org, user, writing flow and resource. The client never names
 * that session; a client-named session id under {@link WRITE_SESSION_PREFIX}
 * is refused, so nobody can take another writer's.
 *
 * The flow's one action, `set`, checks in order: the schema, the owner (the
 * cell is the caller's own user cell or their org, from the verified sign-in),
 * the resource's `canWrite`, then the version the client read. A stale version
 * is refused (`stale_version`) and the client reads again and re-runs its
 * change. It writes only what the client can read: fields hidden by `expose`,
 * `exclude` or `secret` keep their stored values.
 *
 * Limits, stated: the write goes to the store directly, as the resource routes'
 * writes do, so it publishes the scope's change notice but runs no `reactTo`
 * binding and streams no live delta. Every host and queue worker holds the flow
 * from the start as a built-in instance ({@link installBuiltIns}), never listed.
 */
import { createHash } from "node:crypto";
import { defineFlow, handler } from "@flow-state-dev/core";
import type { FlowInstance, JsonObject, ResourceConfig } from "@flow-state-dev/core/types";
import { z } from "zod";
import { FlowError } from "../errors/flow-error";
import type { FlowRegistry } from "../registry/flow-registry";
import type { StoreRegistry } from "../stores/types";
import type { PrincipalResolver } from "../transports/types";
import { publishScopeChange } from "../bus/scope-changes";
import { parseResourceWriteState } from "./normalize-resource-state";
import { addressCellId, readAddressed, resolveAddress, type AddressScope } from "./scope-address";

/** The default write flow's kind and instance id. */
export const DEFAULT_WRITE_FLOW = "fsd-default-write";

/** Every write session id starts with this; a client may not name one. */
export const WRITE_SESSION_PREFIX = "fsd-write.";

/** Whether `id` (bare, or tenant-namespaced as `tenant:id`) is a write session's. */
export function isWriteSessionId(id: string): boolean {
  return id.startsWith(WRITE_SESSION_PREFIX) || id.includes(`:${WRITE_SESSION_PREFIX}`);
}

/** Marks the server's own resource send on a dispatch envelope; a symbol, so no request input carries it. */
const SERVER_RESOURCE_SEND = Symbol.for("@flow-state-dev/engine/serverResourceSend");

/** `envelope`, marked as the server's own resource send (`scope-routes.ts`). */
export function asServerResourceSend<T extends object>(envelope: T): T {
  return Object.assign(envelope, { [SERVER_RESOURCE_SEND]: true });
}

/** Whether `envelope` is the server's own resource send. */
export function isServerResourceSend(envelope: object): boolean {
  return (envelope as Record<symbol, unknown>)[SERVER_RESOURCE_SEND] === true;
}

/** A client named a write session: only the server finds or makes one. */
export class ReservedSessionIdError extends Error {
  constructor(readonly sessionId: string) {
    super(`Session "${sessionId}" is a write session, the server's to find or make: a client can't name one.`);
    this.name = "ReservedSessionIdError";
  }
}

/** A stored session, request or in-flight entry, as far as its writer goes. */
type RecordFields = { flowKind?: string; flowId?: string | null; sessionId?: string | null; id?: string };

/**
 * Whether a stored record belongs to a write: the default write flow's, or one
 * in a write session. Read from the record's own fields, never from what this
 * process has registered.
 */
export function isWriteRecord(record: RecordFields): boolean {
  if (record.flowKind === DEFAULT_WRITE_FLOW || record.flowId === DEFAULT_WRITE_FLOW) return true;
  const sessionId = "sessionId" in record ? record.sessionId : record.id;
  return typeof sessionId === "string" && isWriteSessionId(sessionId);
}

/**
 * The one owner-of-record rule for writes: the flow whose sign-in governs a
 * write record, the flow that declares the resource its write session names,
 * read from the record's own session id. `undefined` for a record that isn't a
 * write's. `{ flow: undefined }` for a write record no declaring flow governs
 * now (or whose session id names no target), which every caller refuses: a
 * write record never falls through to the host's resolver.
 */
export function writeRecordGovernor(
  registry: FlowRegistry,
  hostResolver: PrincipalResolver,
  record: RecordFields
): { flow: FlowInstance | undefined } | undefined {
  if (!isWriteRecord(record)) return undefined;
  const sessionId = "sessionId" in record ? record.sessionId ?? undefined : record.id;
  return { flow: writeSessionGoverningFlow(registry, hostResolver, sessionId) };
}

/** What a write session is for. Every part is an address, not an identity. */
export type WriteTarget = { scope: AddressScope; key: string; writer: string };

/** Who writes: from the verified sign-in, never the request. */
export type Writer = { userId: string; orgId: string; tenantId?: string };

/**
 * The fixed id of `writer`'s session for `target`. The target is readable in
 * the id (base64url), so the flow that runs in it knows what it writes; the
 * writer is a digest, so the id names no user, and a session another writer
 * holds can't pass as theirs: the default write flow recomputes the id from its
 * own caller and refuses on a mismatch.
 */
export function writeSessionId(target: WriteTarget, writer: Writer): string {
  const encoded = Buffer.from(JSON.stringify([target.scope, target.key, target.writer]), "utf8").toString("base64url");
  const digest = createHash("sha256")
    .update(JSON.stringify([writer.tenantId ?? "", writer.orgId, writer.userId, target.scope, target.key, target.writer]), "utf8")
    .digest("base64url")
    .slice(0, 32);
  return `${WRITE_SESSION_PREFIX}${encoded}.${digest}`;
}

/** The target a write session id names, or `undefined` for any other id. */
function writeTargetOf(sessionId: string): WriteTarget | undefined {
  if (!sessionId.startsWith(WRITE_SESSION_PREFIX)) return undefined;
  const encoded = sessionId.slice(WRITE_SESSION_PREFIX.length).split(".")[0] ?? "";
  try {
    const parts = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as unknown;
    if (!Array.isArray(parts) || parts.length !== 3 || !parts.every((part) => typeof part === "string")) return undefined;
    const [scope, key, writer] = parts as [string, string, string];
    if (scope !== "user" && scope !== "org") return undefined;
    return { scope, key, writer };
  } catch {
    return undefined;
  }
}

/**
 * The flow whose sign-in governs a write session's records: the flow that
 * declares the resource it writes. The default write flow has no resolver of
 * its own, so without this its sessions and requests would answer to the
 * host's fallback, the bug class of a route with no flow behind it. `undefined` when `sessionId` is no
 * write session, or its resource is declared nowhere now.
 */
function writeSessionGoverningFlow(
  registry: FlowRegistry,
  hostResolver: PrincipalResolver,
  sessionId: string | undefined
): FlowInstance | undefined {
  if (sessionId === undefined) return undefined;
  const at = sessionId.indexOf(WRITE_SESSION_PREFIX);
  const target = at < 0 ? undefined : writeTargetOf(sessionId.slice(at));
  if (target === undefined) return undefined;
  const address = resolveAddress(registry, hostResolver, target.scope, target.key);
  return "refused" in address ? undefined : address.flow;
}

/** A refused write, with a code the client branches on. */
class ResourceWriteRefusedError extends FlowError {
  constructor(code: "stale_version" | "write_refused" | "not_writable", message: string, details?: Record<string, unknown>) {
    super(message, { code, retryable: false, details });
    this.name = "ResourceWriteRefusedError";
  }
}

/**
 * The next stored state from the client's: the fields the client can read come
 * from it, every other field keeps its stored value.
 */
function mergeClientWrite(config: ResourceConfig, stored: JsonObject, incoming: JsonObject): JsonObject {
  const hidden = new Set<string>(config.secret ?? []);
  for (const field of config.client?.exclude ?? []) hidden.add(field);
  const exposed = config.client?.expose;
  const next: JsonObject = {};
  for (const [field, value] of Object.entries(stored)) {
    if (hidden.has(field) || (exposed !== undefined && !exposed.includes(field))) next[field] = value;
  }
  for (const [field, value] of Object.entries(incoming)) {
    if (hidden.has(field) || (exposed !== undefined && !exposed.includes(field))) continue;
    next[field] = value;
  }
  return next;
}

// FIX-2624.
/**
 * Hold the framework's own flows (the default write flow) in `registry`, over
 * `stores`. Every runtime entry that resolves flows from a registry calls it:
 * the inbound host and a queue worker, so a write never depends on which
 * process runs it. `hostResolver` is the host-level resolver that entry's host
 * is given (the development resolver when none is): the default write flow
 * decides whether two declarations agree with it, as the route does. Idempotent.
 */
export function installBuiltIns(registry: FlowRegistry, stores: StoreRegistry, hostResolver: PrincipalResolver): void {
  if (registry.registerBuiltIn === undefined || registry.get(DEFAULT_WRITE_FLOW) !== undefined) return;
  registry.registerBuiltIn(createDefaultWriteFlow({ registry, stores, hostResolver }));
}

const setInput = z.object({
  /** The whole state the client wants stored, as it reads it. */
  state: z.record(z.string(), z.unknown()),
  /** The version the client read: 0 when nothing was stored. */
  version: z.number().int().min(0)
});

/**
 * Build the default write flow's instance over a host's registry and stores.
 * The host holds it as a built-in (`createInboundTransportHost`).
 */
function createDefaultWriteFlow(options: {
  registry: FlowRegistry;
  stores: StoreRegistry;
  hostResolver: PrincipalResolver;
}): FlowInstance {
  // The host resolver only decides whether the declarations agree, never who the
  // caller is: that is the session binding the action route admitted.
  const { registry, stores, hostResolver } = options;
  const set = handler({
    name: "fsd-default-write-set",
    inputSchema: setInput,
    outputSchema: z.object({ version: z.number() }),
    execute: async (input, ctx) => {
      const sessionId = ctx.session.identity.id;
      const target = writeTargetOf(sessionId);
      // The session record's binding: the caller the action route resolved and admitted.
      const userId = ctx.session.identity.userId;
      const orgId = ctx.session.identity.orgId;
      const tenantId = ctx.session.identity.tenantId;
      if (target === undefined || userId === undefined || orgId === undefined || target.writer !== DEFAULT_WRITE_FLOW) {
        throw new ResourceWriteRefusedError("not_writable", "The default write flow runs only in a write session the server made.");
      }
      // The session must be this caller's for this target: an id is an address.
      if (writeSessionId(target, { userId, orgId, tenantId }) !== sessionId) {
        throw new ResourceWriteRefusedError("not_writable", "This write session is not the caller's.");
      }
      const address = resolveAddress(registry, hostResolver, target.scope, target.key);
      if ("refused" in address) throw new ResourceWriteRefusedError("not_writable", address.refused.message);
      if (address.config.runBy !== "default") {
        throw new ResourceWriteRefusedError(
          "not_writable",
          `Resource "${target.key}" at ${target.scope} scope is not written by the default write flow.`
        );
      }
      const caller = { userId, orgId };
      const current = await readAddressed(stores, address, caller);
      if (input.version !== current.version) {
        throw new ResourceWriteRefusedError(
          "stale_version",
          `Resource "${target.key}" is at version ${current.version}, not ${input.version}: read it again and re-apply the change.`,
          { currentVersion: current.version }
        );
      }
      const next = parseResourceWriteState(
        address.config.stateSchema,
        mergeClientWrite(address.config, current.state, input.state as JsonObject),
        target.key
      );
      const canWrite = address.config.canWrite;
      if (canWrite !== undefined && !(await canWrite({ prev: current.state, next, userId, orgId }))) {
        throw new ResourceWriteRefusedError("write_refused", `Resource "${target.key}" refused this write (canWrite).`);
      }
      const written = await stores.resourceState.set(
        target.scope,
        addressCellId(address, caller),
        target.key,
        next,
        input.version
      );
      if (!written.ok) {
        throw new ResourceWriteRefusedError(
          "stale_version",
          `Resource "${target.key}" changed while this write ran: read it again and re-apply the change.`,
          { currentVersion: written.conflict.currentVersion }
        );
      }
      publishScopeChange(stores.bus, {
        scope: target.scope,
        id: target.scope === "user" ? userId : orgId,
        tenantId,
        kind: "resource",
        resource: target.key,
        requestId: ctx.request.identity.id
      });
      return { version: written.version };
    }
  });
  return defineFlow({
    kind: DEFAULT_WRITE_FLOW,
    actions: { set: { block: set } }
  } as never)() as unknown as FlowInstance;
}
