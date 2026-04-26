import { generator, type GeneratorConfig } from "../blocks/generator";
import { mergeDeclaredResources } from "../blocks/internal/build-block";
import type { BlockDefinition, DeclaredResources } from "../types/block";
import type {
  ActionConfig,
  FlowDefinition,
  FlowInstance,
  FlowInstanceOptions,
  FlowType,
  OrgConfig,
  RequestConfig,
  SessionConfig,
  ToolsConfig,
  UserConfig,
  WorkConfig
} from "../types/flow";
import type { ResourceConfig } from "../types/resource";
import type { ResourceCollectionConfig } from "../types/resource-collection";
import type { ScopeResourceConfig } from "../types/flow";

type AnyActions = Record<string, ActionConfig>;

type AnySession = SessionConfig | undefined;
type AnyRequest = RequestConfig | undefined;
type AnyUser = UserConfig | undefined;
type AnyOrg = OrgConfig | undefined;
type AnyWork = WorkConfig | undefined;

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

type ScopeResources = Record<string, ScopeResourceConfig>;

/**
 * Collect declaredResources from all action blocks in the flow and merge
 * them together. Returns the union of all block-declared resources.
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
 * Merge block-declared resources into a flow's scope config resources.
 * Flow-level declarations take priority over block-declared resources.
 */
function mergeBlockResourcesIntoScope(
  flowResources: ScopeResources | undefined,
  blockResources: Record<string, ScopeResourceConfig> | undefined
): ScopeResources | undefined {
  if (blockResources === undefined) return flowResources;
  if (flowResources === undefined) return { ...blockResources };

  // Block resources form the base; flow resources override
  return { ...blockResources, ...flowResources };
}

/**
 * Merge block-declared resources from all actions into the flow's scope configs.
 * Flow-level resource declarations always win over block-declared ones.
 */
function mergeFlowResources(
  session: AnySession,
  user: AnyUser,
  org: AnyOrg,
  blockResources: DeclaredResources | undefined
): { session: AnySession; user: AnyUser; org: AnyOrg } {
  if (blockResources === undefined) {
    return { session, user, org };
  }

  const mergedSession = blockResources.session !== undefined
    ? { ...session, resources: mergeBlockResourcesIntoScope(session?.resources, blockResources.session) }
    : session;

  const mergedUser = blockResources.user !== undefined
    ? { ...user, resources: mergeBlockResourcesIntoScope(user?.resources, blockResources.user) }
    : user;

  const mergedOrg = blockResources.org !== undefined
    ? { ...org, resources: mergeBlockResourcesIntoScope(org?.resources, blockResources.org) }
    : org;

  return {
    session: mergedSession as AnySession,
    user: mergedUser as AnyUser,
    org: mergedOrg as AnyOrg
  };
}

function createFlowInstance(
  definition: AnyFlowDefinition,
  options: AnyFlowInstanceOptions | undefined
): FlowInstance<AnyActions, AnySession, AnyRequest, AnyUser, AnyOrg, AnyWork> {
  const requireUser = options?.requireUser ?? definition.requireUser ?? true;
  if (!requireUser) {
    throw new Error(`Flow "${definition.kind}" must set requireUser=true in Phase 1`);
  }

  const tools = mergeToolsConfig(definition.tools, options?.tools);
  const kind = options?.kind ?? definition.kind;
  const actions = mergeActions(definition.actions, options?.actions, tools);

  // Merge scope configs from definition + options first
  const session = mergeConfig(definition.session, options?.session);
  const user = mergeConfig(definition.user, options?.user);
  const org = mergeConfig(definition.org, options?.org);

  // Collect block-declared resources and merge into scope configs
  // Flow-level declarations take priority over block-declared ones
  const blockResources = collectBlockResources(actions);
  const merged = mergeFlowResources(session, user, org, blockResources);

  return {
    id: options?.id ?? kind,
    kind,
    requireUser,
    requiresOrg: collectRequiresOrg(actions),
    actions,
    session: merged.session,
    request: mergeConfig(definition.request, options?.request),
    user: merged.user,
    org: merged.org,
    work: mergeConfig(definition.work, options?.work),
    tools,
    voice: options?.voice ?? definition.voice,
    middleware: options?.middleware ?? definition.middleware,
    tokenCounter: options?.tokenCounter ?? definition.tokenCounter,
    costEstimator: options?.costEstimator ?? definition.costEstimator,
    isolateUserState: options?.isolateUserState ?? definition.isolateUserState ?? false,
    isolateOrgState: options?.isolateOrgState ?? definition.isolateOrgState ?? false
  };
}

export function defineFlow<
  const TActions extends Record<string, ActionConfig>,
  const TSession extends SessionConfig | undefined = SessionConfig | undefined,
  const TRequest extends RequestConfig | undefined = RequestConfig | undefined,
  const TUser extends UserConfig | undefined = UserConfig | undefined,
  const TOrg extends OrgConfig | undefined = OrgConfig | undefined,
  const TWork extends WorkConfig | undefined = WorkConfig | undefined
>(
  definition: FlowDefinition<TActions, TSession, TRequest, TUser, TOrg, TWork>
): FlowType<TActions, TSession, TRequest, TUser, TOrg, TWork> {
  const normalizedDefinition: AnyFlowDefinition = {
    ...definition,
    requireUser: definition.requireUser ?? true
  };

  if (!normalizedDefinition.requireUser) {
    throw new Error(`Flow "${definition.kind}" must set requireUser=true in Phase 1`);
  }

  const flowFactory = ((options?: AnyFlowInstanceOptions) =>
    createFlowInstance(normalizedDefinition, options)) as FlowType<
    TActions,
    TSession,
    TRequest,
    TUser,
    TOrg,
    TWork
  >;

  const baseInstance = createFlowInstance(normalizedDefinition, undefined);
  return Object.assign(flowFactory, {
    kind: normalizedDefinition.kind,
    requireUser: baseInstance.requireUser,
    requiresOrg: baseInstance.requiresOrg,
    actions: baseInstance.actions as TActions,
    session: baseInstance.session as TSession,
    request: baseInstance.request as TRequest,
    user: baseInstance.user as TUser,
    org: baseInstance.org as TOrg,
    work: baseInstance.work as TWork,
    tools: baseInstance.tools,
    voice: baseInstance.voice,
    middleware: baseInstance.middleware,
    tokenCounter: baseInstance.tokenCounter,
    costEstimator: baseInstance.costEstimator,
    isolateUserState: baseInstance.isolateUserState,
    isolateOrgState: baseInstance.isolateOrgState
  });
}
