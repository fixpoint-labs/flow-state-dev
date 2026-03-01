import { generator, type GeneratorConfig } from "../blocks/generator";
import { mergeDeclaredResources } from "../blocks/internal/build-block";
import type { BlockDefinition, DeclaredResources } from "../types/block";
import type {
  ActionConfig,
  FlowDefinition,
  FlowInstance,
  FlowInstanceOptions,
  FlowType,
  ProjectConfig,
  RequestConfig,
  SessionConfig,
  ToolsConfig,
  UserConfig,
  WorkConfig
} from "../types/flow";
import type { ResourceConfig } from "../types/resource";

type AnyActions = Record<string, ActionConfig>;

type AnySession = SessionConfig | undefined;
type AnyRequest = RequestConfig | undefined;
type AnyUser = UserConfig | undefined;
type AnyProject = ProjectConfig | undefined;
type AnyWork = WorkConfig | undefined;

type AnyFlowDefinition = FlowDefinition<AnyActions, AnySession, AnyRequest, AnyUser, AnyProject, AnyWork>;
type AnyFlowInstanceOptions = FlowInstanceOptions<AnyActions, AnySession, AnyRequest, AnyUser, AnyProject, AnyWork>;

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

type ScopeResources = Record<string, ResourceConfig>;

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

/**
 * Merge block-declared resources into a flow's scope config resources.
 * Flow-level declarations take priority over block-declared resources.
 */
function mergeBlockResourcesIntoScope(
  flowResources: ScopeResources | undefined,
  blockResources: Record<string, ResourceConfig> | undefined
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
  project: AnyProject,
  blockResources: DeclaredResources | undefined
): { session: AnySession; user: AnyUser; project: AnyProject } {
  if (blockResources === undefined) {
    return { session, user, project };
  }

  const mergedSession = blockResources.session !== undefined
    ? { ...session, resources: mergeBlockResourcesIntoScope(session?.resources, blockResources.session) }
    : session;

  const mergedUser = blockResources.user !== undefined
    ? { ...user, resources: mergeBlockResourcesIntoScope(user?.resources, blockResources.user) }
    : user;

  const mergedProject = blockResources.project !== undefined
    ? { ...project, resources: mergeBlockResourcesIntoScope(project?.resources, blockResources.project) }
    : project;

  return {
    session: mergedSession as AnySession,
    user: mergedUser as AnyUser,
    project: mergedProject as AnyProject
  };
}

function createFlowInstance(
  definition: AnyFlowDefinition,
  options: AnyFlowInstanceOptions | undefined
): FlowInstance<AnyActions, AnySession, AnyRequest, AnyUser, AnyProject, AnyWork> {
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
  const project = mergeConfig(definition.project, options?.project);

  // Collect block-declared resources and merge into scope configs
  // Flow-level declarations take priority over block-declared ones
  const blockResources = collectBlockResources(actions);
  const merged = mergeFlowResources(session, user, project, blockResources);

  return {
    id: options?.id ?? kind,
    kind,
    requireUser,
    actions,
    session: merged.session,
    request: mergeConfig(definition.request, options?.request),
    user: merged.user,
    project: merged.project,
    work: mergeConfig(definition.work, options?.work),
    tools
  };
}

export function defineFlow<
  const TActions extends Record<string, ActionConfig>,
  const TSession extends SessionConfig | undefined = SessionConfig | undefined,
  const TRequest extends RequestConfig | undefined = RequestConfig | undefined,
  const TUser extends UserConfig | undefined = UserConfig | undefined,
  const TProject extends ProjectConfig | undefined = ProjectConfig | undefined,
  const TWork extends WorkConfig | undefined = WorkConfig | undefined
>(
  definition: FlowDefinition<TActions, TSession, TRequest, TUser, TProject, TWork>
): FlowType<TActions, TSession, TRequest, TUser, TProject, TWork> {
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
    TProject,
    TWork
  >;

  const baseInstance = createFlowInstance(normalizedDefinition, undefined);
  return Object.assign(flowFactory, {
    kind: normalizedDefinition.kind,
    requireUser: baseInstance.requireUser,
    actions: baseInstance.actions as TActions,
    session: baseInstance.session as TSession,
    request: baseInstance.request as TRequest,
    user: baseInstance.user as TUser,
    project: baseInstance.project as TProject,
    work: baseInstance.work as TWork,
    tools: baseInstance.tools
  });
}
