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
import { resolveClientData } from "@flow-state-dev/core/helpers";
import type { FlowRegistry } from "../registry/flow-registry";
import type { InboundTransportHost, PrincipalResolver } from "../transports/types";
import { PrincipalResolutionError } from "../transports/errors";
import { pickPrincipalResolver } from "../transports/auth/pickPrincipalResolver";
import { isDefaultBodyUserIdPrincipalResolver } from "../transports/auth/defaultBodyUserIdPrincipalResolver";
import { pinRejectsCaller } from "../context/instance-pin";
import { isResourceConfig } from "../routes/route-utils";
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
 * disagree on their resolver or client config (409, naming both flows).
 */
export function resolveAddress(
  registry: FlowRegistry,
  hostResolver: PrincipalResolver,
  scope: AddressScope,
  key: string
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
            `Resource "${key}" at ${scope} scope is flow-isolated (flow "${isolated[0]!.flow.id}"): it lives per flow ` +
            `instance, so a scope and key don't name it. Read it through a session of its flow.`
        }
      };
    }
    return { refused: { status: 404, code: "unknown_resource", message: `Unknown resource "${key}" at ${scope} scope` } };
  }
  const resolver = pickPrincipalResolver(registry, first.flow.id, hostResolver);
  for (const other of shared.slice(1)) {
    if (pickPrincipalResolver(registry, other.flow.id, hostResolver) !== resolver) {
      return {
        refused: {
          status: 409,
          code: "declarations_disagree",
          message:
            `Resource "${key}" at ${scope} scope is declared by flows "${first.flow.id}" and "${other.flow.id}" with ` +
            `different sign-in resolvers, so there is no one caller to read or write it as. Give both flows one resolver.`
        }
      };
    }
    if (!sameClientConfig(first.config, other.config)) {
      return {
        refused: {
          status: 409,
          code: "declarations_disagree",
          message:
            `Resource "${key}" at ${scope} scope is declared by flows "${first.flow.id}" and "${other.flow.id}" with ` +
            `different client, runBy or canWrite settings, so there is no one answer to give. Declare it once and share it.`
        }
      };
    }
  }
  if (first.config.client === undefined) {
    return { refused: { status: 404, code: "unknown_resource", message: `Unknown resource "${key}" at ${scope} scope` } };
  }
  return { scope, key, flow: first.flow, config: first.config };
}

/** The verified caller of an addressed resource. */
export type AddressCaller = { userId: string; orgId: string };

/**
 * Resolve the caller through the declaring flow's own resolver. Only the open
 * mode's development resolver reads `claimedUserId` (the request's `userId`, as
 * every route takes it in that mode); a configured resolver never sees it.
 * A pinned instance the caller is outside of answers as an unknown resource.
 */
export async function resolveAddressCaller(options: {
  host: InboundTransportHost;
  registry: FlowRegistry;
  hostResolver: PrincipalResolver;
  request: Request;
  address: ResolvedAddress;
  action: string;
  claimedUserId: string | undefined;
}): Promise<AddressCaller | { refused: AddressRefusal }> {
  const { address } = options;
  const resolver = pickPrincipalResolver(options.registry, address.flow.id, options.hostResolver);
  const open = isDefaultBodyUserIdPrincipalResolver(resolver);
  let caller: AddressCaller;
  try {
    caller = await options.host.resolvePrincipal({
      source: "http",
      request: options.request,
      envelope: {
        flowKind: address.flow.id,
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
  if (pinRejectsCaller(address.flow.ownerPin, caller)) {
    return {
      refused: { status: 404, code: "unknown_resource", message: `Unknown resource "${address.key}" at ${address.scope} scope` }
    };
  }
  return { userId: caller.userId, orgId: caller.orgId };
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

/** What a client may see of `state`: the resource's client projection, secrets dropped. */
export async function projectForClient(config: ResourceConfig, state: JsonObject): Promise<JsonValue> {
  return await resolveClientData(config, state);
}
