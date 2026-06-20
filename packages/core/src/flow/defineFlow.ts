/**
 * defineFlow — assembles a flow definition into a callable factory.
 *
 * FIX-435: resources are intrinsic to their definition (`scope`,
 * `flowIsolation`) and live in a single flat `flow.resources` map. Block
 * declarations bubble up via `declaredResources` and are merged into that
 * flat map; `(scope, ref, flowIsolation)` collisions are surfaced at
 * build time. Conflict detection across flows still lives in the cross-flow
 * schema registry path (FIX-431).
 */
import { generator, type GeneratorConfig } from "../blocks/generator";
import { mergeDeclaredResources } from "../blocks/internal/build-block";
import type { AuthenticationConfig } from "../types/auth";
import type { BlockDefinition, DeclaredResourceEntry, DeclaredResources } from "../types/block";
import type {
  ActionConfig,
  FlowDefinition,
  FlowInstance,
  FlowInstanceOptions,
  FlowType,
  McpConfig,
  OrgConfig,
  RequestConfig,
  ScopeClientConfig,
  SessionConfig,
  ToolsConfig,
  UserConfig,
  WorkConfig
} from "../types/flow";
import type { ResourceScope } from "../types/resource";
import { isDefinedResourceCollection } from "../types/resource-collection";
import { validateSchedulesConfig } from "../types/schedules";
import { validateChatConfig, type ChatConfig, type ChatEventBinding } from "../types/chat";
import {
  validateWebhookConfig,
  type WebhookConfig,
  type WebhookEventBinding
} from "../types/webhooks";
import { warnDeprecated } from "../helpers/deprecation";
import { introspectStateKeys } from "../helpers/zod-introspect";

type ScopeKind = "session" | "user" | "org";

type ScopeWithClient = {
  stateSchema?: unknown;
  client?: ScopeClientConfig;
  clientData?: Record<string, unknown>;
};

/**
 * Collapse a scope's `{ client, clientData }` inputs into the canonical
 * `client` shape the runtime consumes. Throws on conflicting input
 * (both fields set, name collision, unknown `expose` key) so authors
 * see one clear error at definition time. Emits a one-shot deprecation
 * warning when only the legacy `clientData` is set.
 */
function normalizeScopeClientConfig(
  flowKind: string,
  scope: ScopeKind,
  config: ScopeWithClient | undefined
): ScopeClientConfig | undefined {
  if (config === undefined) return undefined;

  const hasClient = config.client !== undefined;
  const hasClientData = config.clientData !== undefined && Object.keys(config.clientData).length > 0;

  if (hasClient && hasClientData) {
    throw new Error(
      `Flow "${flowKind}" sets both ${scope}.client and ${scope}.clientData. ` +
      `Pick one — clientData is the legacy shape; move its entries under client.derived.`
    );
  }

  let normalized: ScopeClientConfig | undefined;
  if (hasClient) {
    normalized = config.client;
  } else if (hasClientData) {
    warnDeprecated(
      `clientData:${flowKind}:${scope}`,
      `${flowKind}.${scope}.clientData is deprecated. ` +
      `Replace with ${scope}.client: { derived: { ... } } (or expose: [...] for verbatim passthrough).`
    );
    normalized = { derived: config.clientData as ScopeClientConfig["derived"] };
  } else {
    return undefined;
  }

  if (normalized === undefined) return undefined;

  const exposeNames = normalized.expose ?? [];
  const derivedNames = normalized.derived === undefined ? [] : Object.keys(normalized.derived);

  if (exposeNames.length > 0 && derivedNames.length > 0) {
    const exposeSet = new Set(exposeNames);
    const collisions = derivedNames.filter((n) => exposeSet.has(n));
    if (collisions.length > 0) {
      throw new Error(
        `Flow "${flowKind}" ${scope}.client has overlapping names in expose and derived: ` +
        `${collisions.join(", ")}. Pick one per name.`
      );
    }
  }

  if (exposeNames.length > 0) {
    const knownKeys = introspectStateKeys(config.stateSchema);
    if (knownKeys !== undefined) {
      const unknown = exposeNames.filter((n) => !knownKeys.has(n));
      if (unknown.length > 0) {
        const valid = [...knownKeys].sort().join(", ") || "(none)";
        throw new Error(
          `Flow "${flowKind}" ${scope}.client.expose names key(s) not on ${scope}.stateSchema: ` +
          `${unknown.join(", ")}. Valid keys: ${valid}.`
        );
      }
    }
  }

  return normalized;
}

function applyNormalizedClient<TConfig extends ScopeWithClient | undefined>(
  config: TConfig,
  normalized: ScopeClientConfig | undefined
): TConfig {
  if (config === undefined) return config;
  // Drop the legacy `clientData` field from the runtime object so consumers
  // can't accidentally read it; carry the normalized result on `client`.
  const { clientData: _drop, ...rest } = config as ScopeWithClient;
  return { ...(rest as object), client: normalized } as TConfig;
}

type AnyActions = Record<string, ActionConfig>;

type AnySession = SessionConfig | undefined;
type AnyRequest = RequestConfig | undefined;
type AnyUser = UserConfig | undefined;
type AnyOrg = OrgConfig | undefined;
type AnyWork = WorkConfig | undefined;

type AnyResources = Record<string, DeclaredResourceEntry> | undefined;

type AnyFlowDefinition = FlowDefinition<AnyActions, AnySession, AnyRequest, AnyUser, AnyOrg, AnyWork>;
type AnyFlowInstanceOptions = FlowInstanceOptions<AnyActions, AnySession, AnyRequest, AnyUser, AnyOrg, AnyWork>;

function mergeToolsConfig(base: ToolsConfig | undefined, override: ToolsConfig | undefined): ToolsConfig | undefined {
  if (base === undefined && override === undefined) {
    return undefined;
  }

  const defaults =
    base?.defaults === undefined
      ? override?.defaults
      : override?.defaults === undefined
        ? base.defaults
        : {
            ...base.defaults,
            ...override.defaults
          };

  return {
    defaults,
    onToolStarted: override?.onToolStarted ?? base?.onToolStarted,
    onToolCompleted: override?.onToolCompleted ?? base?.onToolCompleted,
    onToolErrored: override?.onToolErrored ?? base?.onToolErrored
  };
}

function mergeConfig<TConfig extends object | undefined>(base: TConfig, override: TConfig): TConfig {
  if (base === undefined) {
    return override;
  }

  if (override === undefined) {
    return base;
  }

  return {
    ...base,
    ...override
  } as TConfig;
}

function withFlowTools(
  block: BlockDefinition,
  flowTools: ToolsConfig | undefined
): BlockDefinition {
  if (flowTools === undefined || block.kind !== "generator") {
    return block;
  }

  const generatorConfig = block.config as unknown as GeneratorConfig;
  const mergedTools = mergeToolsConfig(flowTools, generatorConfig.flowTools);
  return generator({
    ...generatorConfig,
    flowTools: mergedTools
  });
}

function mergeActions(
  baseActions: AnyActions,
  overrideActions: AnyFlowInstanceOptions["actions"],
  flowTools: ToolsConfig | undefined
): AnyActions {
  const merged: AnyActions = {
    ...baseActions
  };

  if (overrideActions !== undefined) {
    for (const [actionName, overrideAction] of Object.entries(overrideActions)) {
      if (overrideAction === undefined) {
        continue;
      }

      const existing = merged[actionName];
      merged[actionName] =
        existing === undefined
          ? overrideAction
          : {
              ...existing,
              ...overrideAction
            };
    }
  }

  for (const [actionName, action] of Object.entries(merged)) {
    merged[actionName] = {
      ...action,
      block: withFlowTools(action.block, flowTools)
    };
  }

  return merged;
}

/**
 * The action map augmented with one internal action per inline-`block`
 * binding, plus the transport configs rewritten so those bindings reference
 * their synthesized action by name.
 */
interface SynthesizedTransports {
  actions: AnyActions;
  chat: ChatConfig | undefined;
  webhooks: WebhookConfig | undefined;
}

/**
 * Lower inline `block` bindings (`chat.on[*].block`,
 * `webhooks[provider].on[*].block`) into synthesized internal actions.
 *
 * For each binding that carries a `block` instead of an `action`, mint an
 * internal `ActionConfig` (`{ block, internal: true }`) under a reserved,
 * collision-checked name and rewrite the binding to reference it. The
 * synthesized action joins `flow.actions`, so it inherits the entire dispatch
 * runtime (lifecycle, state, items, request records, resource prefetch) for
 * free, while `internal: true` keeps it off the public HTTP and MCP surface —
 * a webhook/chat-only handler can only be reached through its verified
 * transport, never the public action endpoint.
 *
 * No-op (returns the inputs unchanged) when no binding declares a `block`.
 * Assumes `validateChatConfig`/`validateWebhookConfig` already ran, so every
 * binding declares exactly one of `action`/`block` and each `block` is an
 * object. Throws when a synthesized name collides with an existing action.
 */
function synthesizeTransportActions(
  flowKind: string,
  actions: AnyActions,
  chat: ChatConfig | undefined,
  webhooks: WebhookConfig | undefined
): SynthesizedTransports {
  const synthesized: AnyActions = {};

  const register = (name: string, block: BlockDefinition): void => {
    if (name in actions || name in synthesized) {
      throw new Error(
        `Flow "${flowKind}" cannot synthesize internal action "${name}" for an inline ` +
          `binding block — an action with that name already exists. Rename the conflicting action.`
      );
    }
    synthesized[name] = { block, internal: true };
  };

  // Validation guarantees `action` XOR `block`, so a present `block` is always
  // the inline form. Rewrite each such binding to reference its synthesized
  // action; pass action-form bindings through untouched.
  let nextChat = chat;
  if (chat?.on !== undefined) {
    const rewrittenOn: Record<string, ChatEventBinding> = {};
    for (const [eventKey, binding] of Object.entries(chat.on)) {
      if (binding.block !== undefined) {
        const name = `__chat.${eventKey}`;
        register(name, binding.block);
        const { block: _block, action: _action, ...rest } = binding;
        rewrittenOn[eventKey] = { ...rest, action: name };
      } else {
        rewrittenOn[eventKey] = binding;
      }
    }
    nextChat = { ...chat, on: rewrittenOn };
  }

  let nextWebhooks = webhooks;
  if (webhooks !== undefined) {
    const rewrittenProviders: WebhookConfig = {};
    for (const [provider, sub] of Object.entries(webhooks)) {
      if (sub.on === undefined) {
        rewrittenProviders[provider] = sub;
        continue;
      }
      const rewrittenOn: Record<string, WebhookEventBinding> = {};
      for (const [eventKey, binding] of Object.entries(sub.on)) {
        if (binding.block !== undefined) {
          const name = `__wh.${provider}.${eventKey}`;
          register(name, binding.block);
          const { block: _block, action: _action, ...rest } = binding;
          rewrittenOn[eventKey] = { ...rest, action: name };
        } else {
          rewrittenOn[eventKey] = binding;
        }
      }
      rewrittenProviders[provider] = { ...sub, on: rewrittenOn };
    }
    nextWebhooks = rewrittenProviders;
  }

  // Nothing synthesized → return the inputs unchanged so flows without inline
  // blocks are wholly unaffected (the rewritten copies above are discarded).
  if (Object.keys(synthesized).length === 0) {
    return { actions, chat, webhooks };
  }
  return { actions: { ...actions, ...synthesized }, chat: nextChat, webhooks: nextWebhooks };
}

/**
 * Collect declaredResources from all action blocks in the flow and merge
 * them together. Returns the union of all block-declared resources.
 * Same accessor key + same `defineResource()` reference deduplicates;
 * different references at the same accessor key throw at this layer.
 */
function collectBlockResources(actions: AnyActions): DeclaredResources | undefined {
  let collected: DeclaredResources | undefined;
  for (const action of Object.values(actions)) {
    collected = mergeDeclaredResources(collected, action.block.declaredResources);
  }
  return collected;
}

/** True when any action's root block (or any of its descendants) opted into `requireOrg`. */
function collectRequiresOrg(actions: AnyActions): boolean {
  for (const action of Object.values(actions)) {
    if (action.block.requiresOrg) return true;
  }
  return false;
}

/**
 * Effective storage tuple for a resource installed in a given flow.
 *
 * - `scope` and `ref` come from the resource definition.
 * - `flowIsolation` defaults to `false`; flow-level `isolateUserState` /
 *   `isolateOrgState` flags promote unset user/org-scoped resources to
 *   isolated. Resource-level declarations always win.
 * - `flowKind` participates only when the effective `flowIsolation` is true.
 */
function effectiveStorageTuple(
  entry: DeclaredResourceEntry,
  accessorKey: string,
  flowKind: string,
  flowIsolateUserState: boolean,
  flowIsolateOrgState: boolean
): { scope: ResourceScope; ref: string; flowIsolation: boolean; flowKind?: string } {
  const scope = entry.scope as ResourceScope;
  const ref = (entry as { ref?: string; pattern?: string }).ref
    ?? (isDefinedResourceCollection(entry) ? entry.pattern : accessorKey);

  let flowIsolation = entry.flowIsolation === true;
  if (entry.flowIsolation === undefined) {
    if (scope === "user" && flowIsolateUserState) flowIsolation = true;
    if (scope === "org" && flowIsolateOrgState) flowIsolation = true;
  }

  return {
    scope,
    ref,
    flowIsolation,
    flowKind: flowIsolation ? flowKind : undefined
  };
}

function tupleKey(t: { scope: ResourceScope; ref: string; flowIsolation: boolean; flowKind?: string }): string {
  // JSON-encoded tuple avoids false collisions where adjacent fields could
  // otherwise concatenate ambiguously (e.g. ref="x" + flowIsolation=true +
  // flowKind="y0" colliding with ref="x1y" + flowIsolation=false).
  return JSON.stringify([t.scope, t.ref, t.flowIsolation, t.flowKind ?? null]);
}

/**
 * Validate the flat resource set on a flow at build time. Detects:
 *   - Distinct accessor keys pointing at the same effective storage key
 *     (always a hard error — would silently share storage).
 *   - `flowIsolation: true` on a session-scoped resource (semantically
 *     meaningless; almost certainly a confused author).
 *
 * Same-accessor-key collisions are caught at the `mergeDeclaredResources`
 * layer; this layer only inspects effective tuples.
 */
function validateFlowResources(
  resources: DeclaredResources,
  flowKind: string,
  flowIsolateUserState: boolean,
  flowIsolateOrgState: boolean
): void {
  const seen = new Map<string, { accessor: string; entry: DeclaredResourceEntry }>();

  for (const [accessor, entry] of Object.entries(resources)) {
    if (entry.scope === undefined) {
      throw new Error(
        `Resource "${accessor}" declared in flow "${flowKind}" has no intrinsic scope. ` +
        `Set scope: "session" | "user" | "org" via defineResource().`
      );
    }

    if (entry.flowIsolation === true && entry.scope === "session") {
      throw new Error(
        `Resource "${accessor}" in flow "${flowKind}" sets flowIsolation: true on a ` +
        `session-scoped resource. Sessions are intrinsically flow-bound — drop the flag.`
      );
    }

    const tuple = effectiveStorageTuple(
      entry,
      accessor,
      flowKind,
      flowIsolateUserState,
      flowIsolateOrgState
    );
    const key = tupleKey(tuple);
    const prior = seen.get(key);
    if (prior !== undefined && prior.entry !== entry) {
      throw new Error(
        `Resource collision in flow "${flowKind}": accessor keys "${prior.accessor}" and ` +
        `"${accessor}" resolve to the same effective storage key (` +
        `scope=${tuple.scope}, ref=${tuple.ref}, flowIsolation=${tuple.flowIsolation}` +
        (tuple.flowKind === undefined ? "" : `, flowKind=${tuple.flowKind}`) +
        `). Pick distinct refs or flowIsolation settings.`
      );
    }
    seen.set(key, { accessor, entry });
  }
}

/**
 * Merge block-declared resources with the flow's own `resources` map.
 *
 * Flow-level declarations always win on accessor-key dedup — the consumer
 * explicitly picked a definition for that name, so a block's declaration
 * for the same name is overridden silently. Across the *block* layer
 * itself, a same-accessor conflict between two different definitions still
 * errors via `mergeDeclaredResources`.
 */
function mergeFlowResourceMap(
  flowResources: AnyResources,
  blockResources: DeclaredResources | undefined
): DeclaredResources | undefined {
  if (flowResources === undefined && blockResources === undefined) return undefined;
  if (flowResources === undefined) return { ...blockResources };
  if (blockResources === undefined) return { ...flowResources };
  // Block resources first, flow overrides on top.
  return { ...blockResources, ...flowResources };
}

/**
 * `requireUser: false` is a build-time opt-out from the framework's user-
 * scope identity. Flows that opt out must not declare any user-scope state,
 * clientData, or resources — otherwise the runtime would have nowhere to
 * route the read/write. We catch the conflict at registration so authors
 * see one clear error at startup rather than a confusing runtime failure on
 * the first request.
 */
function validateRequireUserFalseConsistency(
  flowKind: string,
  user: UserConfig | undefined,
  resources: DeclaredResources | undefined
): void {
  if (user?.stateSchema !== undefined) {
    throw new Error(
      `Flow "${flowKind}" sets requireUser: false but declares user.stateSchema. ` +
      `Drop the user-scope state or set requireUser: true.`
    );
  }
  const userClient = user?.client;
  const userHasClient =
    userClient !== undefined &&
    ((userClient.expose?.length ?? 0) > 0 ||
      Object.keys(userClient.derived ?? {}).length > 0);
  if (userHasClient) {
    throw new Error(
      `Flow "${flowKind}" sets requireUser: false but declares user.client. ` +
      `Drop user.client or set requireUser: true.`
    );
  }
  if (resources !== undefined) {
    for (const [accessor, entry] of Object.entries(resources)) {
      if (entry.scope === "user") {
        throw new Error(
          `Flow "${flowKind}" sets requireUser: false but the resource "${accessor}" ` +
          `is scope: "user". Drop the user-scope resource or set requireUser: true.`
        );
      }
    }
  }
}

/**
 * Combine `definition.authentication` with an instance override. Field-level
 * merge — instance values win on each individual key but unset keys fall
 * through to the definition. Returns `undefined` only when neither side is
 * set so we don't materialize empty config objects on every flow.
 */
function mergeAuthentication(
  base: AuthenticationConfig | undefined,
  override: AuthenticationConfig | undefined
): AuthenticationConfig | undefined {
  if (base === undefined && override === undefined) return undefined;
  if (base === undefined) return { ...override };
  if (override === undefined) return { ...base };
  return {
    resolvePrincipal: override.resolvePrincipal ?? base.resolvePrincipal,
    defaultUserId: override.defaultUserId ?? base.defaultUserId,
    requireUser: override.requireUser ?? base.requireUser,
    requireOrg: override.requireOrg ?? base.requireOrg
  };
}

/**
 * When `mcp.enabled === true`, every action that will be exposed via the
 * MCP adapter must carry a non-empty `description`. The MCP package
 * converts actions into LLM-facing tools; an empty description ships an
 * unusable tool. Catching the omission at registration is preferable to
 * discovering it when an MCP client connects.
 *
 * Per-action exclusion is set on the action itself via
 * `action.mcp.enabled: false`.
 */
function validateMcpConfig(
  flowKind: string,
  mcp: McpConfig | undefined,
  actions: AnyActions
): void {
  if (mcp?.enabled !== true) return;

  for (const [actionName, action] of Object.entries(actions)) {
    // Internal actions (e.g. synthesized inline-binding handlers) are never
    // exposed via MCP, so they carry no description and must be skipped here.
    if (action.internal) continue;
    if (action.mcp?.enabled === false) continue;

    if (typeof action.description !== "string" || action.description.trim().length === 0) {
      throw new Error(
        `Flow "${flowKind}" exposes action "${actionName}" via MCP but the action has no ` +
        `description. Set actions.${actionName}.description to a non-empty string — it ` +
        `becomes the LLM-facing MCP tool description.`
      );
    }
  }
}

function createFlowInstance(
  definition: AnyFlowDefinition,
  options: AnyFlowInstanceOptions | undefined
): FlowInstance<AnyActions, AnySession, AnyRequest, AnyUser, AnyOrg, AnyWork> {
  const authentication = mergeAuthentication(
    definition.authentication,
    options?.authentication
  );

  // `authentication.requireUser` wins over the top-level shorthand. Top-level
  // `requireUser` stays as the legacy entry point so existing flows keep
  // working unchanged. Both can coexist and a passed instance override on
  // either field is applied as expected.
  const requireUser =
    options?.authentication?.requireUser ??
    definition.authentication?.requireUser ??
    options?.requireUser ??
    definition.requireUser ??
    true;

  const tools = mergeToolsConfig(definition.tools, options?.tools);
  const kind = options?.kind ?? definition.kind;
  const baseActions = mergeActions(definition.actions, options?.actions, tools);

  // Validate the author-declared transport configs against the public action
  // set BEFORE synthesizing internal actions. This enforces the `action` XOR
  // `block` rule on the original bindings and resolves `action` references
  // against real declared actions, not the synthesized internal ones.
  const declaredChat = definition.chat;
  validateChatConfig(kind, declaredChat, baseActions);

  const declaredWebhooks = definition.webhooks;
  validateWebhookConfig(kind, declaredWebhooks, baseActions);

  // Lower inline `block` bindings into internal actions and rewrite those
  // bindings to reference them. No-op when no binding carries a `block`, so
  // flows without inline handlers are unaffected.
  const synthesized = synthesizeTransportActions(kind, baseActions, declaredChat, declaredWebhooks);
  const actions = synthesized.actions;
  const chat = synthesized.chat;
  const webhooks = synthesized.webhooks;

  const sessionMerged = mergeConfig(definition.session, options?.session);
  const userMerged = mergeConfig(definition.user, options?.user);
  const orgMerged = mergeConfig(definition.org, options?.org);

  const session = applyNormalizedClient(
    sessionMerged,
    normalizeScopeClientConfig(kind, "session", sessionMerged as ScopeWithClient | undefined)
  );
  const user = applyNormalizedClient(
    userMerged,
    normalizeScopeClientConfig(kind, "user", userMerged as ScopeWithClient | undefined)
  );
  const org = applyNormalizedClient(
    orgMerged,
    normalizeScopeClientConfig(kind, "org", orgMerged as ScopeWithClient | undefined)
  );

  const isolateUserState = options?.isolateUserState ?? definition.isolateUserState ?? false;
  const isolateOrgState = options?.isolateOrgState ?? definition.isolateOrgState ?? false;

  const blockResources = collectBlockResources(actions);
  const flowOwnResources = options?.resources ?? definition.resources;
  // Accessor keys declared in the flow's OWN `resources` map, captured before
  // block-tree/capability resources bubble up and merge in (FIX-688). The
  // block-dispatch prefetch hook uses this to distinguish flow-level
  // declarations (no per-block load trigger) from block-level ones.
  const flowLevelResourceKeys: ReadonlySet<string> = new Set(
    Object.keys(flowOwnResources ?? {})
  );
  // A lazy single resource has no per-block load trigger at flow level — its
  // load can only be driven by the block that declares it. Reject it here so
  // the misconfiguration surfaces at build time, not as a silently-never-loaded
  // resource at runtime. Lazy collections are allowed at flow level.
  for (const [key, entry] of Object.entries(flowOwnResources ?? {})) {
    if (
      !isDefinedResourceCollection(entry) &&
      (entry as { prefetchMode?: string }).prefetchMode === "lazy"
    ) {
      throw new Error(
        `Single-resource '${key}' declared at flow level cannot be prefetchMode: 'lazy' — flow-level declarations have no per-block load trigger. Declare it on the specific block that needs it, or use prefetchMode: 'eager'.`
      );
    }
  }
  const mergedResources = mergeFlowResourceMap(flowOwnResources, blockResources);

  if (mergedResources !== undefined) {
    validateFlowResources(mergedResources, kind, isolateUserState, isolateOrgState);
  }

  if (!requireUser) {
    validateRequireUserFalseConsistency(kind, user, mergedResources);
  }

  const mcp = definition.mcp;
  validateMcpConfig(kind, mcp, actions);

  const schedules = definition.schedules;
  validateSchedulesConfig(kind, schedules, actions);

  return {
    id: options?.id ?? kind,
    kind,
    requireUser,
    requiresOrg: collectRequiresOrg(actions),
    authentication,
    actions,
    session,
    request: mergeConfig(definition.request, options?.request),
    user,
    org,
    work: mergeConfig(definition.work, options?.work),
    resources: mergedResources,
    flowLevelResourceKeys,
    tools,
    voice: options?.voice ?? definition.voice,
    middleware: options?.middleware ?? definition.middleware,
    mcp,
    chat,
    webhooks,
    schedules,
    tokenCounter: options?.tokenCounter ?? definition.tokenCounter,
    costEstimator: options?.costEstimator ?? definition.costEstimator,
    isolateUserState,
    isolateOrgState
  };
}

export function defineFlow<
  const TActions extends Record<string, ActionConfig>,
  const TSession extends SessionConfig | undefined = SessionConfig | undefined,
  const TRequest extends RequestConfig | undefined = RequestConfig | undefined,
  const TUser extends UserConfig | undefined = UserConfig | undefined,
  const TOrg extends OrgConfig | undefined = OrgConfig | undefined,
  const TWork extends WorkConfig | undefined = WorkConfig | undefined,
  const TResources extends Record<string, DeclaredResourceEntry> = Record<string, DeclaredResourceEntry>
>(
  definition: FlowDefinition<TActions, TSession, TRequest, TUser, TOrg, TWork, TResources>
): FlowType<TActions, TSession, TRequest, TUser, TOrg, TWork, TResources> {
  const normalizedDefinition: AnyFlowDefinition = {
    ...definition
  };

  const flowFactory = ((options?: AnyFlowInstanceOptions) =>
    createFlowInstance(normalizedDefinition, options)) as FlowType<
    TActions,
    TSession,
    TRequest,
    TUser,
    TOrg,
    TWork,
    TResources
  >;

  const baseInstance = createFlowInstance(normalizedDefinition, undefined);
  return Object.assign(flowFactory, {
    kind: normalizedDefinition.kind,
    requireUser: baseInstance.requireUser,
    requiresOrg: baseInstance.requiresOrg,
    authentication: baseInstance.authentication,
    actions: baseInstance.actions as TActions,
    session: baseInstance.session as TSession,
    request: baseInstance.request as TRequest,
    user: baseInstance.user as TUser,
    org: baseInstance.org as TOrg,
    work: baseInstance.work as TWork,
    resources: baseInstance.resources as TResources | undefined,
    tools: baseInstance.tools,
    voice: baseInstance.voice,
    middleware: baseInstance.middleware,
    mcp: baseInstance.mcp,
    chat: baseInstance.chat,
    webhooks: baseInstance.webhooks,
    schedules: baseInstance.schedules,
    tokenCounter: baseInstance.tokenCounter,
    costEstimator: baseInstance.costEstimator,
    isolateUserState: baseInstance.isolateUserState,
    isolateOrgState: baseInstance.isolateOrgState,
    flowLevelResourceKeys: baseInstance.flowLevelResourceKeys
  });
}
