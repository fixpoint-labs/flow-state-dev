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
 * Its `set` action writes a single resource, or one entry of a collection;
 * `delete` deletes one entry. Each checks in order: the schema, the owner (the
 * cell is the caller's own user cell or their org, from the verified sign-in,
 * and an owner-keyed entry is written only by its owner, `ownerWriteRefusal`),
 * the resource's `canWrite`, then the version the client read. A stale version
 * is refused (`stale_version`) and the client reads again and re-runs its
 * change. It writes only what the client can read: fields hidden by `expose`,
 * `exclude` or `secret` keep their stored values. A collection's entries share
 * one write session per writer: the session is the collection's cell's.
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
import { noticePathFor, publishScopeChange } from "../bus/scope-changes";
import { pinRejectsCaller } from "../context/instance-pin";
import { parseResourceWriteState } from "./normalize-resource-state";
import { ownerWriteRefusal } from "./owner-private";
import { isProjectedResourceCollection } from "./internal";
import {
  addressCellId,
  entryStorageKey,
  readAddressed,
  readEntries,
  resolveAddress,
  type AddressScope,
  type ResolvedAddress
} from "./scope-address";

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
type RecordFields = {
  flowKind?: string;
  flowId?: string | null;
  sessionId?: string | null;
  id?: string;
  userId?: string | null;
  orgId?: string | null;
};

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
  return { flow: writeSessionGoverningFlow(registry, hostResolver, sessionId, record) };
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
  sessionId: string | undefined,
  owner: { userId?: string | null; orgId?: string | null }
): FlowInstance | undefined {
  if (sessionId === undefined) return undefined;
  const at = sessionId.indexOf(WRITE_SESSION_PREFIX);
  const target = at < 0 ? undefined : writeTargetOf(sessionId.slice(at));
  if (target === undefined) return undefined;
  // The declaring instance whose pin admits the record's owner: instances
  // pinned to different users each govern their own writers' records.
  const address = resolveAddress(registry, hostResolver, target.scope, target.key, (flow) =>
    !pinRejectsCaller(flow.ownerPin, { userId: owner.userId ?? "", orgId: owner.orgId ?? "" })
  );
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
function mergeClientWrite(
  config: Pick<ResourceConfig, "secret"> & { client?: { expose?: readonly string[]; exclude?: readonly string[] } },
  stored: JsonObject,
  incoming: JsonObject
): JsonObject {
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
  /** A collection's entry: its bare topic or storage key. Only for a collection. */
  entry: z.string().min(1).optional(),
  /** The whole state the client wants stored, as it reads it. */
  state: z.record(z.string(), z.unknown()),
  /** The version the client read: 0 when nothing was stored. */
  version: z.number().int().min(0)
});

const deleteInput = z.object({
  /** The collection entry to delete: its bare topic or storage key. */
  entry: z.string().min(1),
  /** The version the client read. */
  version: z.number().int().min(0)
});

/** What every write of the default write flow is admitted with. */
type AdmittedWrite = {
  target: WriteTarget;
  address: ResolvedAddress;
  caller: { userId: string; orgId: string };
  tenantId: string | undefined;
  cell: string;
};

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

  /** The write's target, address and caller, from the write session and its binding; refused otherwise. */
  const admit = (session: { id: string; userId?: string; orgId?: string; tenantId?: string }): AdmittedWrite => {
    const target = writeTargetOf(session.id);
    // The session record's binding: the caller the action route resolved and admitted.
    const { userId, orgId, tenantId } = session;
    if (target === undefined || userId === undefined || orgId === undefined || target.writer !== DEFAULT_WRITE_FLOW) {
      throw new ResourceWriteRefusedError("not_writable", "The default write flow runs only in a write session the server made.");
    }
    // The session must be this caller's for this target: an id is an address.
    if (writeSessionId(target, { userId, orgId, tenantId }) !== session.id) {
      throw new ResourceWriteRefusedError("not_writable", "This write session is not the caller's.");
    }
    // The declaring instance whose pin admits this writer governs.
    const address = resolveAddress(registry, hostResolver, target.scope, target.key, (flow) =>
      !pinRejectsCaller(flow.ownerPin, { userId, orgId })
    );
    if ("refused" in address) throw new ResourceWriteRefusedError("not_writable", address.refused.message);
    if (address.config.runBy !== "default") {
      throw new ResourceWriteRefusedError(
        "not_writable",
        `Resource "${target.key}" at ${target.scope} scope is not written by the default write flow.`
      );
    }
    const caller = { userId, orgId };
    return { target, address, caller, tenantId, cell: addressCellId(address, caller) };
  };

  /** Publish the write's change on its scope's topic, as any action write does. */
  const publish = (write: AdmittedWrite, resource: string | undefined, requestId: string): void => {
    publishScopeChange(stores.bus, {
      scope: write.target.scope,
      id: write.target.scope === "user" ? write.caller.userId : write.caller.orgId,
      tenantId: write.tenantId,
      kind: "resource",
      ...(resource !== undefined ? { resource } : {}),
      requestId
    });
  };

  const stale = (key: string, currentVersion: number, read: number) =>
    new ResourceWriteRefusedError(
      "stale_version",
      `Resource "${key}" is at version ${currentVersion}, not ${read}: read it again and re-apply the change.`,
      { currentVersion }
    );

  const raced = (key: string, currentVersion: number) =>
    new ResourceWriteRefusedError(
      "stale_version",
      `Resource "${key}" changed while this write ran: read it again and re-apply the change.`,
      { currentVersion }
    );

  /** The storage key a collection write names, checked against the pattern and the owner fence. */
  const entryKeyOf = (write: AdmittedWrite & { address: { collection: true } }, entry: string | undefined): string => {
    const config = write.address.config;
    if (entry === undefined) {
      throw new ResourceWriteRefusedError("not_writable", `"${write.target.key}" is a collection: a write names its entry.`);
    }
    if (isProjectedResourceCollection(config)) {
      throw new ResourceWriteRefusedError("not_writable", `"${write.target.key}" is read from its app source; the default write flow can't write it.`);
    }
    const storageKey = entryStorageKey(config, entry);
    if (storageKey === undefined) {
      throw new ResourceWriteRefusedError("not_writable", `Entry "${entry}" does not match "${config.pattern}".`);
    }
    const refusal = ownerWriteRefusal(config, storageKey, write.caller.userId);
    if (refusal !== undefined) throw new ResourceWriteRefusedError("write_refused", refusal);
    return storageKey;
  };

  const writeSingle = async (
    write: AdmittedWrite & { address: { collection: false } },
    input: z.infer<typeof setInput>,
    requestId: string
  ): Promise<{ version: number }> => {
    const { address, target, caller } = write;
    if (input.entry !== undefined) {
      throw new ResourceWriteRefusedError("not_writable", `"${target.key}" is a single resource: a write names no entry.`);
    }
    const current = await readAddressed(stores, address, caller);
    if (input.version !== current.version) throw stale(target.key, current.version, input.version);
    const next = parseResourceWriteState(
      address.config.stateSchema,
      mergeClientWrite(address.config, current.state, input.state as JsonObject),
      target.key
    );
    const canWrite = address.config.canWrite;
    if (canWrite !== undefined && !(await canWrite({ prev: current.state, next, ...caller }))) {
      throw new ResourceWriteRefusedError("write_refused", `Resource "${target.key}" refused this write (canWrite).`);
    }
    const written = await stores.resourceState.set(target.scope, write.cell, target.key, next, input.version);
    if (!written.ok) throw raced(target.key, written.conflict.currentVersion);
    publish(write, target.key, requestId);
    return { version: written.version };
  };

  const writeEntry = async (
    write: AdmittedWrite & { address: { collection: true } },
    input: z.infer<typeof setInput>,
    requestId: string
  ): Promise<{ version: number }> => {
    const { address, target, caller } = write;
    const config = address.config;
    const storageKey = entryKeyOf(write, input.entry);
    const current = await stores.resourceState.get(target.scope, write.cell, storageKey);
    const currentVersion = current?.version ?? 0;
    if (input.version !== currentVersion) throw stale(storageKey, currentVersion, input.version);
    if (current === undefined && config.maxInstances !== undefined) {
      const held = await readEntries(stores, address, caller);
      if (held.length >= config.maxInstances) {
        throw new ResourceWriteRefusedError(
          "write_refused",
          `Collection "${config.pattern}" holds its ${config.maxInstances} entries: delete one first.`
        );
      }
    }
    const merged = mergeClientWrite(config, current?.state ?? {}, input.state as JsonObject);
    // The org is the server's to stamp: the stored one on an update, the caller's on a create.
    if (config.stampOrgId === true) merged.orgId = (current?.state.orgId as string | undefined) ?? caller.orgId;
    const next = parseResourceWriteState(config.stateSchema, merged, storageKey);
    const canWrite = config.canWrite;
    if (canWrite !== undefined && !(await canWrite({ key: storageKey, prev: current?.state, next, ...caller }))) {
      throw new ResourceWriteRefusedError("write_refused", `Entry "${storageKey}" refused this write (canWrite).`);
    }
    const written = await stores.resourceState.set(target.scope, write.cell, storageKey, next, input.version);
    if (!written.ok) throw raced(storageKey, written.conflict.currentVersion);
    publish(write, noticePathFor(config, storageKey), requestId);
    return { version: written.version };
  };

  const set = handler({
    name: "fsd-default-write-set",
    inputSchema: setInput,
    outputSchema: z.object({ version: z.number() }),
    execute: async (input, ctx) => {
      const write = admit(ctx.session.identity);
      return write.address.collection
        ? writeEntry(write as AdmittedWrite & { address: { collection: true } }, input, ctx.request.identity.id)
        : writeSingle(write as AdmittedWrite & { address: { collection: false } }, input, ctx.request.identity.id);
    }
  });

  const remove = handler({
    name: "fsd-default-write-delete",
    inputSchema: deleteInput,
    outputSchema: z.object({ version: z.number() }),
    execute: async (input, ctx) => {
      const write = admit(ctx.session.identity);
      if (!write.address.collection) {
        throw new ResourceWriteRefusedError(
          "not_writable",
          `"${write.target.key}" is a single resource: set it to its default instead of deleting it.`
        );
      }
      const entryWrite = write as AdmittedWrite & { address: { collection: true } };
      const config = entryWrite.address.config;
      const storageKey = entryKeyOf(entryWrite, input.entry);
      const current = await stores.resourceState.get(write.target.scope, write.cell, storageKey);
      const currentVersion = current?.version ?? 0;
      if (input.version !== currentVersion) throw stale(storageKey, currentVersion, input.version);
      // Nothing stored at the version read: already deleted, nothing to publish.
      if (current === undefined) return { version: 0 };
      const canWrite = config.canWrite;
      if (canWrite !== undefined && !(await canWrite({ key: storageKey, prev: current.state, next: undefined, ...write.caller }))) {
        throw new ResourceWriteRefusedError("write_refused", `Entry "${storageKey}" refused this delete (canWrite).`);
      }
      const deleted = await stores.resourceState.delete(write.target.scope, write.cell, storageKey, input.version);
      if (!deleted.ok) throw raced(storageKey, deleted.conflict.currentVersion);
      publish(write, noticePathFor(config, storageKey), ctx.request.identity.id);
      return { version: deleted.version };
    }
  });

  return defineFlow({
    kind: DEFAULT_WRITE_FLOW,
    actions: { set: { block: set }, delete: { block: remove } }
  } as never)() as unknown as FlowInstance;
}
