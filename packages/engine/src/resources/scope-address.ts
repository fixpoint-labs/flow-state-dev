// FIX-2624; BP-031; epic FIX-2618 ER-3.
/**
 * A user or org resource addressed by scope and key, with no session: who
 * declares it, who the caller is, which cell is theirs, and what they may read.
 *
 * A shared user or org resource belongs to no one flow, so the address names
 * the scope and the storage key, and the registry finds every flow that
 * declares it. The caller is resolved through those flows' own resolver,
 * the governing-flow path a user-kept file is checked by, never the host's fallback, the body, the
 * query or a header. When the declarations disagree on
 * their resolver or their client config there is no one answer to give, so the
 * read or write is refused, naming both flows. Registration still succeeds:
 * a host that runs today keeps starting.
 *
 * Only single resources here; collections are addressed by their entries in a
 * later change.
 */
import type { FlowInstance, JsonObject, JsonValue, ResourceConfig } from "@flow-state-dev/core/types";
import type { FlowRegistry } from "../registry/flow-registry";
import type { InboundTransportHost, PrincipalResolver } from "../transports/types";
import { PrincipalResolutionError } from "../transports/errors";
import { pickPrincipalResolver } from "../transports/auth/pickPrincipalResolver";
import { isDefaultBodyUserIdPrincipalResolver } from "../transports/auth/defaultBodyUserIdPrincipalResolver";
import { pinRejectsCaller } from "../context/instance-pin";
import { buildResourceSnapshot, isResourceConfig } from "../routes/route-utils";
import { isCollectionConfig } from "./is-collection-config";
import { resourceStorageKeys } from "./storage-keys";
import { normalizeResourceState } from "./normalize-resource-state";
import { resolveResourceIsolation, resolveResourceScopeId } from "../stores/scope-keys";
import type { StoreRegistry } from "../stores/types";

/** The two scopes a resource is addressed by without a session. */
export type AddressScope = "user" | "org";

/** One flow's declaration of the addressed resource. */
type ScopeDeclaration = {
  flow: FlowInstance;
  accessor: string;
  config: ResourceConfig;
};

/** The declarations of one address, once they agree. */
export type ResolvedAddress = {
  scope: AddressScope;
  key: string;
  /** The first declaring flow: its resolver and pin govern the caller. */
  flow: FlowInstance;
  config: ResourceConfig;
};

/** Why an address has no one answer. `status` is the HTTP answer to give. */
export type AddressRefusal = { status: number; code: string; message: string };

/** Whether `value` names a scope a resource is addressed by. */
export function isAddressScope(value: string): value is AddressScope {
  return value === "user" || value === "org";
}

/**
 * The flows that declare the single resource stored at `key` in `scope`,
 * shared (not flow-isolated), in registration order.
 */
function declarationsOf(registry: FlowRegistry, scope: AddressScope, key: string): {
  shared: ScopeDeclaration[];
  isolated: ScopeDeclaration[];
} {
  const shared: ScopeDeclaration[] = [];
  const isolated: ScopeDeclaration[] = [];
  for (const flow of registry.list()) {
    const resources = flow.resources as Record<string, unknown> | undefined;
    if (resources === undefined) continue;
    const storageKeys = resourceStorageKeys(resources);
    for (const [accessor, config] of Object.entries(resources)) {
      if (isCollectionConfig(config) || !isResourceConfig(config)) continue;
      if (config.scope !== scope || (storageKeys[accessor] ?? accessor) !== key) continue;
      const entry = { flow, accessor, config };
      if (resolveResourceIsolation(config.flowIsolation, flow, scope)) isolated.push(entry);
      else shared.push(entry);
    }
  }
  return { shared, isolated };
}

/** Whether `flow` declares the shared single resource stored at `key` in `scope`. */
export function flowDeclares(registry: FlowRegistry, flow: FlowInstance, scope: AddressScope, key: string): boolean {
  return declarationsOf(registry, scope, key).shared.some((entry) => entry.flow.id === flow.id);
}

/** Whether two client configs project the same fields for a client. */
function sameClientConfig(a: ResourceConfig, b: ResourceConfig): boolean {
  if (a === b) return true;
  const ca = a.client;
  const cb = b.client;
  if (ca === undefined || cb === undefined) return ca === cb;
  return (
    ca.data === cb.data &&
    JSON.stringify(ca.expose ?? null) === JSON.stringify(cb.expose ?? null) &&
    JSON.stringify(ca.exclude ?? null) === JSON.stringify(cb.exclude ?? null) &&
    JSON.stringify(a.secret ?? null) === JSON.stringify(b.secret ?? null) &&
    JSON.stringify(a.runBy ?? null) === JSON.stringify(b.runBy ?? null) &&
    a.canWrite === b.canWrite
  );
}

/**
 * The one declaration an address resolves to, or why there is none: no flow
 * declares it (404), only isolated copies do (400), or two declarations
 * disagree on their resolver or client config (409, naming both flows). Among
 * agreeing declarations, the governing flow is the first `governs` admits:
 * pinned instances of one flow each govern their own callers. None: 404.
 */
export function resolveAddress(
  registry: FlowRegistry,
  hostResolver: PrincipalResolver,
  scope: AddressScope,
  key: string,
  governs: (flow: FlowInstance) => boolean = () => true
): ResolvedAddress | { refused: AddressRefusal } {
  const { shared, isolated } = declarationsOf(registry, scope, key);
  const first = shared[0];
  if (first === undefined) {
    if (isolated.length > 0) {
      return {
        refused: {
          status: 400,
          code: "isolated_resource",
          message:
            `Resource "${key}" at ${scope} scope is flow-isolated: it lives per flow instance, so a scope and key ` +
            `don't name it. Read it through a session of its flow.`
        }
      };
    }
    return { refused: { status: 404, code: "unknown_resource", message: `Unknown resource "${key}" at ${scope} scope` } };
  }
  const disagreement = declarationsAgree(registry, hostResolver, shared, scope, key);
  if (disagreement !== undefined) return { refused: disagreement };
  // The declarations agree, so any of them answers; the one that governs is
  // the first `governs` admits (the caller's or the record owner's instance).
  const governing = shared.find((entry) => governs(entry.flow));
  if (first.config.client === undefined || governing === undefined) {
    return { refused: { status: 404, code: "unknown_resource", message: `Unknown resource "${key}" at ${scope} scope` } };
  }
  return { scope, key, flow: governing.flow, config: first.config };
}

/**
 * Whether every declaration of one address agrees: one resolver (each flow's
 * own, else `hostResolver`, the precedence `pickPrincipalResolver` decides) and
 * one client, `runBy` and `canWrite` setting. `undefined` when they agree, else
 * the 409 naming two flows that don't. The one verdict the route and the
 * default write flow both reach, so they are given the same host resolver.
 */
function declarationsAgree(
  registry: FlowRegistry,
  hostResolver: PrincipalResolver,
  shared: readonly ScopeDeclaration[],
  scope: AddressScope,
  key: string
): AddressRefusal | undefined {
  const first = shared[0];
  if (first === undefined) return undefined;
  const resolver = pickPrincipalResolver(registry, first.flow.id, hostResolver);
  for (const other of shared.slice(1)) {
    if (pickPrincipalResolver(registry, other.flow.id, hostResolver) !== resolver) {
      return {
        status: 409,
        code: "declarations_disagree",
        message:
          `Resource "${key}" at ${scope} scope is declared by flows "${first.flow.id}" and "${other.flow.id}" with ` +
          `different sign-in resolvers, so there is no one caller to read or write it as. Give both flows one resolver.`
      };
    }
    if (!sameClientConfig(first.config, other.config)) {
      return {
        status: 409,
        code: "declarations_disagree",
        message:
          `Resource "${key}" at ${scope} scope is declared by flows "${first.flow.id}" and "${other.flow.id}" with ` +
          `different client, runBy or canWrite settings, so there is no one answer to give. Declare it once and share it.`
      };
    }
  }
  return undefined;
}

/** The verified caller of an addressed resource. */
export type AddressCaller = { userId: string; orgId: string };

/** The answer an unused key gets: no flow named, nothing about why. */
function unknownRefusal(scope: string, key: string): AddressRefusal {
  return { status: 404, code: "unknown_resource", message: `Unknown resource "${key}" at ${scope} scope` };
}

/**
 * The caller as `flow`'s own door resolves them: the one place a no-session
 * route asks who the caller is, always at the address of the flow whose rules
 * apply (the declaring flow for a read or a default write, the writer for a
 * send to `runBy: { flow }`, the path's flow for the identity read), so that
 * flow's resolver, `requireUser` and `defaultUserId` see the request. Only the
 * open mode's development resolver reads `claimedUserId` (the request's
 * `userId`, as every route takes it in that mode); a configured resolver never
 * sees it. `unauthenticated` when the resolver refuses, `outside_pin` when a
 * pinned instance's pin does.
 */
export async function resolveFlowCaller(options: {
  host: InboundTransportHost;
  registry: FlowRegistry;
  hostResolver: PrincipalResolver;
  request: Request;
  flow: FlowInstance;
  action: string;
  claimedUserId: string | undefined;
}): Promise<AddressCaller | { refused: AddressRefusal }> {
  const { flow } = options;
  const resolver = pickPrincipalResolver(options.registry, flow.id, options.hostResolver);
  const open = isDefaultBodyUserIdPrincipalResolver(resolver);
  let caller: AddressCaller;
  try {
    caller = await options.host.resolvePrincipal({
      source: "http",
      request: options.request,
      envelope: {
        flowKind: flow.id,
        action: options.action,
        metadata: open && options.claimedUserId !== undefined ? { body: { userId: options.claimedUserId } } : {},
        input: undefined
      }
    });
  } catch (error) {
    if (error instanceof PrincipalResolutionError) {
      return { refused: { status: error.status, code: "unauthenticated", message: error.message } };
    }
    throw error;
  }
  if (pinRejectsCaller(flow.ownerPin, caller)) {
    return { refused: { status: 404, code: "outside_pin", message: `Unknown flow "${flow.id}"` } };
  }
  return { userId: caller.userId, orgId: caller.orgId };
}

/**
 * The address `key` in `scope` names and its verified caller, or the refusal
 * to give. The caller must pass every declaring flow's resolver (isolated
 * declarations included; agreeing ones share one) and the pin of at least one
 * declaring instance before any answer but an unused key's is given: until
 * then a real key, one only isolated copies hold, and one whose declarations
 * disagree all answer as an unused key does. The instance that governs is the
 * first shared declarer whose pin admits the caller, so instances pinned to
 * different users each serve their own; a refusal after that names a flow only
 * when every declaring instance admits the caller.
 */
export async function admitAddress(options: {
  host: InboundTransportHost;
  registry: FlowRegistry;
  hostResolver: PrincipalResolver;
  request: Request;
  scope: AddressScope;
  key: string;
  action: string;
  claimedUserId: string | undefined;
}): Promise<{ address: ResolvedAddress; caller: AddressCaller } | { refused: AddressRefusal }> {
  const { scope, key } = options;
  const { shared, isolated } = declarationsOf(options.registry, scope, key);
  const flows = new Map<string, FlowInstance>();
  for (const entry of [...shared, ...isolated]) flows.set(entry.flow.id, entry.flow);
  const callers = new Map<string, AddressCaller>();
  let pinnedOut = false;
  for (const flow of flows.values()) {
    const caller = await resolveFlowCaller({ ...options, flow });
    if (!("refused" in caller)) callers.set(flow.id, caller);
    else if (caller.refused.code === "outside_pin") pinnedOut = true;
    else return { refused: unknownRefusal(scope, key) };
  }
  if (callers.size === 0) return { refused: unknownRefusal(scope, key) };
  const address = resolveAddress(options.registry, options.hostResolver, scope, key, (flow) => callers.has(flow.id));
  if ("refused" in address) {
    if (address.refused.status === 404 || !pinnedOut) return address;
    return { refused: { ...address.refused, message: `Resource "${key}" at ${scope} scope can't be read or written by scope.` } };
  }
  return { address, caller: callers.get(address.flow.id)! };
}

/** The storage cell of the caller's copy: their user cell in their org, or their org. */
export function addressCellId(address: ResolvedAddress, caller: AddressCaller): string {
  return resolveResourceScopeId(caller, address.flow, address.scope, false);
}

/** The stored state of the caller's copy, the schema's default when none, and its version (0: none). */
export async function readAddressed(
  stores: Pick<StoreRegistry, "resourceState">,
  address: ResolvedAddress,
  caller: AddressCaller
): Promise<{ state: JsonObject; version: number }> {
  const stored = await stores.resourceState.get(address.scope, addressCellId(address, caller), address.key);
  return {
    state: normalizeResourceState(address.config, stored?.state),
    version: stored?.version ?? 0
  };
}

/**
 * What a client may see of a single resource's `state`: its entry in the
 * session snapshot, built by the snapshot's own builder (`buildResourceSnapshot`),
 * so a direct read and the session's snapshot project one resource one way.
 * `undefined` when the snapshot carries no state for it (a resource with no
 * state projection, such as a content-only one).
 */
export async function projectForClient(address: ResolvedAddress, state: JsonObject): Promise<JsonValue | undefined> {
  const snapshot = await buildResourceSnapshot({
    configs: { [address.key]: { ...address.config, ref: address.key } },
    persisted: { [address.key]: state }
  });
  return (snapshot?.[address.key] as { clientData?: JsonValue } | undefined)?.clientData;
}
