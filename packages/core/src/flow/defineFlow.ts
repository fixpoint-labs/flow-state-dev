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
import {
  taskBindingOf,
  type InternalEntry,
  type TaskEntry,
} from "../types/dispatch";
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
} from "../types/flow";
import type { ResourceScope } from "../types/resource";
import { isDefinedResourceCollection } from "../types/resource-collection";
import { validateSchedulesConfig, type ScheduleConfig, type SchedulesConfig } from "../types/schedules";
import { validateConcurrencyConfig } from "../types/concurrency";
import { validateChatConfig, type ChatConfig, type ChatEventBinding } from "../types/chat";
import { validateWebhookConfig, type WebhookConfig, type WebhookEventBinding } from "../types/webhooks";
import { introspectStateKeys } from "../helpers/zod-introspect";

type ScopeKind = "session" | "user" | "org";

type ScopeWithClient = {
  stateSchema?: unknown;
  client?: ScopeClientConfig;
};

/**
 * Validate a scope's `client` config. Throws on a leftover `clientData`
 * key, an `expose`/`derived` name collision, or an `expose` key that
 * isn't on the scope state schema.
 *
 * Validation only — nothing is rewritten, so the merged config the caller
 * already holds is the one the instance carries.
 */
function validateScopeClientConfig(
  flowKind: string,
  scope: ScopeKind,
  config: ScopeWithClient | undefined
): void {
  if (config === undefined) return;

  rejectRemovedClientData(config, flowKind, scope);

  const client = config.client;
  if (client === undefined) return;

  const exposeNames = client.expose ?? [];
  const derivedNames = client.derived === undefined ? [] : Object.keys(client.derived);

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
}

type AnyActions = Record<string, ActionConfig>;

type AnySession = SessionConfig | undefined;
type AnyRequest = RequestConfig | undefined;
type AnyUser = UserConfig | undefined;
type AnyOrg = OrgConfig | undefined;

type AnyResources = Record<string, DeclaredResourceEntry> | undefined;

type AnyFlowDefinition = FlowDefinition<AnyActions, AnySession, AnyRequest, AnyUser, AnyOrg>;
type AnyFlowInstanceOptions = FlowInstanceOptions<AnyActions, AnySession, AnyRequest, AnyUser, AnyOrg>;

function rejectRemovedMiddleware(value: object | undefined, location: string): void {
  if (value !== undefined && Object.hasOwn(value, "middleware")) {
    throw new Error(
      `${location} uses the removed "middleware" option. ` +
      "Middleware is not executed; move policy checks to the HTTP authentication layer or block logic."
    );
  }
}

/**
 * Reject the removed flow-level `work` option.
 *
 * `work` declared four lifecycle hooks (`onStarted` / `onCompleted` /
 * `onErrored` / `onFinished`) that the engine never invoked — nothing read
 * `flow.work` to dispatch them. They are gone from `FlowDefinition` and
 * `FlowInstanceOptions` (FIX-766), so a TypeScript caller passing a fresh
 * object literal now fails to compile; this is the runtime half, for plain JS
 * and for a non-fresh object TypeScript lets through.
 *
 * Failing loudly matters even though the hooks never fired. Silently dropping
 * the key would take the resource declarations with it: the hooks WERE walked
 * for declaration discovery, so a resource declared only on one of them was
 * registered, and after the removal it is not. That is a real behaviour change
 * hiding behind a dead contract, and it is exactly the case BP-030 has in mind
 * when it says to reject removed keys loudly.
 */
function rejectRemovedWork(value: object | undefined, location: string): void {
  if (value !== undefined && Object.hasOwn(value, "work")) {
    throw new Error(
      `${location} uses the removed "work" option. ` +
      "Its four hooks were never invoked, so no lifecycle behaviour is lost — but they were walked for " +
      "resource declaration, so any resource declared only there is no longer registered. " +
      "Move those declarations onto a block that runs, and dispatch background steps with `.sideChain()`."
    );
  }
}

/**
 * Reject the removed scope-config `clientData` option.
 *
 * `clientData` was the legacy authoring shape for a scope's client-facing
 * projection. It is gone from `SessionConfig` / `UserConfig` / `OrgConfig`
 * in favour of `client: { derived, expose }`, so a TypeScript caller passing
 * a fresh object literal now fails to compile; this is the runtime half, for
 * plain JS and for a non-fresh object TypeScript lets through.
 *
 * Failing loudly is the point: accepting-and-ignoring the key would silently
 * stop publishing data the frontend still reads, with no error anywhere near
 * the flow that authored it.
 *
 * Only the authoring key moved — the wire shape is unchanged, and clients
 * still read `snapshot.clientData.<scope>.<name>`.
 */
function rejectRemovedClientData(value: object | undefined, flowKind: string, scope: ScopeKind): void {
  if (value !== undefined && Object.hasOwn(value, "clientData")) {
    throw new Error(
      `Flow "${flowKind}" ${scope}.clientData was removed. ` +
      `Use ${scope}.client: { derived: { ... } } (or expose: [...] for verbatim passthrough).`
    );
  }
}

/** The definition-only options {@link rejectDefinitionOnlyOptions} refuses. */
const DEFINITION_ONLY_INSTANCE_OPTIONS = [
  "webhooks",
  "chat",
  "schedules",
  "mcp",
  "internal",
  "tasks",
] as const;

/**
 * Reject transport configs that are declared on the flow DEFINITION only.
 *
 * Passing one as an instance option used to type-check and then do nothing at
 * all — the instance carried the definition's values either way, so
 * `flow({ webhooks })` looked configured and was not (FIX-1048). They are gone
 * from {@link FlowInstanceOptions}, so a TypeScript caller now fails to compile;
 * this guard is the runtime half, for the caller who reaches past the types
 * (plain JS, or an `as any` cast): fail loudly rather than accept-and-ignore.
 *
 * Being definition-only is also what makes the transport validation in
 * `createFlowInstance` complete rather than partial: `validateChatConfig` /
 * `validateWebhookConfig` / `validateSchedulesConfig` read `definition.*` rather
 * than a merge, and with no instance-side source left there is no config that
 * could slip past them.
 */
function rejectDefinitionOnlyOptions(value: object | undefined, flowKind: string): void {
  if (value === undefined) return;

  for (const key of DEFINITION_ONLY_INSTANCE_OPTIONS) {
    if (Object.hasOwn(value, key)) {
      throw new Error(
        `Flow "${flowKind}" instance options set "${key}", which is not an instance option. ` +
        `Per-instance ${DEFINITION_ONLY_INSTANCE_OPTIONS.join("/")} were never applied — the instance ` +
        `always used the definition's. Declare "${key}" on defineFlow(...) instead.`
      );
    }
  }
}

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
  // `generator()` recomputes `declaredResources` and `childBlocks` from the
  // config it is handed (rescue handlers ride `config.rescue`), so a dispatcher
  // behind a generator's failure path stays reachable across the rebuild.
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
 * Apply the flow's `tools` config to every webhook handler block, mirroring
 * `mergeActions` for caller actions. A webhook binding is an action in webhook
 * form, so a generator handler must see the flow-level `tools` (tool
 * timeout/concurrency/retry defaults, `onToolStarted`/`onToolCompleted`
 * observers) exactly as it would as a caller action. `withFlowTools` only
 * rewrites a root generator block (a no-op otherwise), so non-generator
 * handlers pass through. Returns the input unchanged when the flow declares no
 * webhooks or no flow-level tools — those flows are wholly unaffected (same
 * object identity). Assumes `validateWebhookConfig` already ran, so every
 * binding has a real `block`.
 */
function withFlowToolsEntries(
  entries: Record<string, InternalEntry> | undefined,
  flowTools: ToolsConfig | undefined
): Record<string, InternalEntry> | undefined {
  if (entries === undefined || flowTools === undefined) return entries;
  const result: Record<string, InternalEntry> = {};
  for (const [name, entry] of Object.entries(entries)) {
    result[name] = { ...entry, block: withFlowTools(entry.block, flowTools) };
  }
  return result;
}

function withFlowToolsWebhooks(
  webhooks: WebhookConfig | undefined,
  flowTools: ToolsConfig | undefined
): WebhookConfig | undefined {
  if (webhooks === undefined || flowTools === undefined) return webhooks;
  const result: WebhookConfig = {};
  for (const [provider, sub] of Object.entries(webhooks)) {
    const on: Record<string, WebhookEventBinding> = {};
    for (const [eventKey, binding] of Object.entries(sub.on)) {
      on[eventKey] = { ...binding, block: withFlowTools(binding.block, flowTools) };
    }
    result[provider] = { ...sub, on };
  }
  return result;
}

/**
 * Apply the flow's `tools` config to every chat handler block, mirroring
 * `withFlowToolsWebhooks`. A chat binding is an action in chat form, so a
 * generator handler must see the flow-level `tools` exactly as a caller action
 * would. No-op when the flow declares no chat subscriptions or no tools (same
 * object identity). Assumes `validateChatConfig` already ran.
 */
function withFlowToolsChat(
  chat: ChatConfig | undefined,
  flowTools: ToolsConfig | undefined
): ChatConfig | undefined {
  if (chat?.on === undefined || flowTools === undefined) return chat;
  const on: Record<string, ChatEventBinding> = {};
  for (const [eventKey, binding] of Object.entries(chat.on)) {
    on[eventKey] = { ...binding, block: withFlowTools(binding.block, flowTools) };
  }
  return { ...chat, on };
}

/**
 * Apply the flow's `tools` config to every static schedule handler block,
 * mirroring `withFlowToolsWebhooks`. Dynamic schedules (`resolve`) produce
 * their block at dispatch time and are not rewritten here — consistent with
 * the dynamic path's other limitations. No-op when the flow declares no static
 * schedules or no tools. Assumes `validateSchedulesConfig` already ran.
 */
function withFlowToolsSchedules(
  schedules: SchedulesConfig | undefined,
  flowTools: ToolsConfig | undefined
): SchedulesConfig | undefined {
  if (schedules?.static === undefined || flowTools === undefined) return schedules;
  const staticEntries: Record<string, ScheduleConfig> = {};
  for (const [id, schedule] of Object.entries(schedules.static)) {
    staticEntries[id] = { ...schedule, block: withFlowTools(schedule.block, flowTools) };
  }
  return { ...schedules, static: staticEntries };
}

/**
 * Every executable block the flow declares: each caller-addressed action's
 * block plus each event-addressed binding's handler block (webhook, chat,
 * static schedule). Every event binding is an action in transport form,
 * carrying its handler inline, so its block must participate in resource and
 * `requireOrg` aggregation exactly like a `flow.actions` block — otherwise
 * event-declared resources never prefetch and their `requireOrg` is never
 * detected. Dynamic schedule blocks are produced at dispatch time and cannot
 * be walked here.
 */
/**
 * Every block one `ActionCore` statically declares: the root, plus the
 * lifecycle observers `runAction` executes alongside it.
 *
 * The observers are collected for the same reason the root is. They run as real
 * blocks in the request, so whatever they declare — resources, `requireOrg`,
 * detached worker bindings — is as load-bearing as the root's. A board mounted
 * under `onCompleted` is a board this flow has to be able to route to, and a
 * resource it needs is one the registry has to install.
 */
function actionCoreBlocks(core: {
  block: BlockDefinition;
  onCompleted?: BlockDefinition<any, any>;
  onErrored?: BlockDefinition<any, any>;
}): BlockDefinition[] {
  const blocks: BlockDefinition[] = [core.block];
  if (core.onCompleted !== undefined) blocks.push(core.onCompleted);
  if (core.onErrored !== undefined) blocks.push(core.onErrored);
  return blocks;
}

/**
 * Every statically-declared block in the flow.
 *
 * Six entry families all carry the shared `ActionCore` (caller actions,
 * internal and task entries, and the webhook, chat and static schedule
 * bindings), so each contributes its root and its observers. The flow-level
 * `request` hooks are blocks too, and are declared once for the whole flow
 * rather than per entry.
 *
 * Dynamic schedules (`schedules.resolve`) are deliberately absent: their blocks
 * do not exist until a resolver runs, so there is nothing to collect at
 * definition time.
 */
function actionBlocks(
  actions: AnyActions,
  internal: Record<string, InternalEntry> | undefined,
  tasks: Record<string, TaskEntry> | undefined,
  webhooks: WebhookConfig | undefined,
  chat: ChatConfig | undefined,
  schedules: SchedulesConfig | undefined,
  request?: { onStarted?: BlockDefinition<any, any>; onCompleted?: BlockDefinition<any, any>; onErrored?: BlockDefinition<any, any>; onFinished?: BlockDefinition<any, any>; onStepErrored?: BlockDefinition<any, any> }
): BlockDefinition[] {
  const blocks: BlockDefinition[] = [];
  for (const action of Object.values(actions)) blocks.push(...actionCoreBlocks(action));
  if (internal !== undefined) {
    for (const entry of Object.values(internal)) blocks.push(...actionCoreBlocks(entry));
  }
  if (tasks !== undefined) {
    for (const entry of Object.values(tasks)) blocks.push(...actionCoreBlocks(entry));
  }
  if (webhooks !== undefined) {
    for (const sub of Object.values(webhooks)) {
      for (const binding of Object.values(sub.on)) blocks.push(...actionCoreBlocks(binding));
    }
  }
  if (chat?.on !== undefined) {
    for (const binding of Object.values(chat.on)) blocks.push(...actionCoreBlocks(binding));
  }
  if (schedules?.static !== undefined) {
    for (const schedule of Object.values(schedules.static)) blocks.push(...actionCoreBlocks(schedule));
  }
  for (const hook of [
    request?.onStarted,
    request?.onCompleted,
    request?.onErrored,
    request?.onFinished,
    request?.onStepErrored
  ]) {
    if (hook !== undefined) blocks.push(hook);
  }
  return blocks;
}

/**
 * Collect declaredResources from every action block in the flow (caller +
 * webhook + chat + static schedule) and merge them together. Returns the union
 * of all block-declared resources. Same accessor key + same `defineResource()`
 * reference deduplicates; different references at the same accessor key throw
 * at this layer.
 */
function collectBlockResources(
  blocks: readonly BlockDefinition[]
): DeclaredResources | undefined {
  let collected: DeclaredResources | undefined;
  for (const block of blocks) {
    collected = mergeDeclaredResources(collected, block.declaredResources);
  }
  return collected;
}

/**
 * A generator's **statically declared** tools, or nothing (FIX-1074).
 *
 * `tools` is a `ToolsSlot` — an array, or a function resolved per call with the
 * input and context in hand. Only the array is knowable here, and the function
 * form is genuinely unknowable rather than merely inconvenient: what it returns
 * depends on runtime values that do not exist at definition time.
 */
function staticTools(block: BlockDefinition): readonly BlockDefinition[] {
  const tools = (block.config as { tools?: unknown }).tools;
  return Array.isArray(tools) ? (tools as BlockDefinition[]) : [];
}

/**
 * Walk the flow's block graph once and return every reachable block — through
 * composition AND through a generator's static `tools` array. What the
 * dispatch-address assertion checks.
 *
 * **The tool edge is here because a board can be handed to a model as a tool**
 * (`tools: [board.drain]`, the shape FIX-925 shipped): a dispatcher reached only
 * that way must still be found by the address check, or the first time the
 * model called the tool the board would hand off to an entry the flow never
 * declared. Reachability is the only thing the tool edge feeds: a generator
 * bubbles none of its tools' declarations, so a tool block contributes no
 * resources through this walk (FIX-1074).
 *
 * A block is visited once: blocks are shared freely (one handler across several
 * actions) and a router route may point back up the tree, so revisits and cycles
 * are ordinary rather than exceptional.
 */
function walkFlowGraph(roots: readonly BlockDefinition[]): BlockDefinition[] {
  const seen = new Set<BlockDefinition>();
  const queue: BlockDefinition[] = [...roots];
  while (queue.length > 0) {
    const block = queue.pop()!;
    if (seen.has(block)) continue;
    seen.add(block);
    // Rescue handlers installed via `config.rescue` are already folded into
    // `childBlocks` by `buildBlock`.
    for (const child of block.childBlocks ?? []) queue.push(child);
    for (const tool of staticTools(block)) queue.push(tool);
  }
  return [...seen];
}

/** True when any declared block (root or lifecycle observer) opted into `requireOrg`. */
function collectRequiresOrg(blocks: readonly BlockDefinition[]): boolean {
  for (const block of blocks) {
    if (block.requiresOrg) return true;
  }
  return false;
}

/**
 * Validate the `internal` and `tasks` entry maps at definition time.
 *
 * One refusal, by name: an entry with no block cannot be dispatched to, and the
 * failure would otherwise surface as a property read on `undefined` inside the
 * runtime. Whether a task entry is reached through a board's claim gate is the
 * walk's question (`resolveDispatchTargets`), not the map's.
 */
function validateEntryMaps(
  kind: string,
  internal: Record<string, InternalEntry> | undefined,
  tasks: Record<string, TaskEntry> | undefined
): void {
  for (const [name, entry] of Object.entries(internal ?? {})) {
    if (typeof entry?.block?.name !== "string") {
      throw new Error(
        `Flow "${kind}" internal entry "${name}" has no block. An internal entry is ` +
          `\`{ block, ...policy }\`, the same shape as an action.`
      );
    }
    validateConcurrencyConfig(`Flow "${kind}" internal entry "${name}"`, entry.concurrency);
  }
  for (const [name, entry] of Object.entries(tasks ?? {})) {
    if (typeof entry?.block?.name !== "string") {
      throw new Error(
        `Flow "${kind}" task entry "${name}" has no block. A task entry is ` +
          `\`{ block, ...policy }\`, the same shape as an action.`
      );
    }
    validateConcurrencyConfig(`Flow "${kind}" task entry "${name}"`, entry.concurrency);
  }
}

/**
 * Resolve every dispatcher reachable from this flow's declared blocks against
 * the entries the flow declares, and put each task entry behind the claim gate
 * of the board that hands off to it.
 *
 * This is the definition-time half of the no-fallback rule. A dispatcher's
 * address is static — `(type, target)` on the block definition — so the check
 * is a lookup, not an inference: `internal:"wake"` must be
 * `flow.internal.wake`; `task:"implement"` must be `flow.tasks.implement`.
 * Caught here, the author sees the block and the address; caught at run time,
 * a claimed row would be handed off to nothing and wait out its lease.
 *
 * A task entry is declared as a plain block, and a `task` dispatch may only
 * ever reach it through its board's gate — the row re-read, the claim verified,
 * the task scope marked, the ticket re-minted. The board cannot install that
 * gate itself, because the flow owns the entry, so it binds the gate onto the
 * hand-off it holds at the seat ({@link bindTaskDispatcher}) and this walk
 * applies it: the returned map carries `gate(entry)` in place of each entry a
 * board addresses. A task dispatcher no board holds, an entry no board
 * addresses, and two boards addressing one entry are each refused by name —
 * every one of them is a worker that could run against a row nothing verified.
 *
 * Checkable at all only because `BlockDefinition.childBlocks` retains the
 * sequencer's children — a board's drain IS a sequencer — and because the seam
 * is reachable only from blocks that carry an address: `dispatcher()` and the
 * board's hand-off both stamp one, and nothing on `ctx` lets a handler body
 * dispatch without it.
 */
function resolveDispatchTargets(
  kind: string,
  reachable: readonly BlockDefinition[],
  internal: Record<string, InternalEntry> | undefined,
  tasks: Record<string, TaskEntry> | undefined
): Record<string, TaskEntry> | undefined {
  const gated: Record<string, TaskEntry> = {};
  const gatedBy = new Map<string, string>();

  for (const block of reachable) {
    const address = block.dispatch;
    if (address === undefined) continue;
    const label = `${address.type}:"${address.target}"`;

    if (address.type === "internal") {
      if (internal !== undefined && Object.hasOwn(internal, address.target)) continue;
      throw new Error(
        `Flow "${kind}" reaches block "${block.name}", which dispatches to ${label}, but the ` +
          `flow declares no such entry. Add \`internal: { ${address.target}: { block } }\` to ` +
          `the flow, or point the dispatcher at an entry it declares. A dispatch never resolves ` +
          `another type's map, so this dispatch could not run.`
      );
    }

    if (address.type === "task") {
      const entry = tasks !== undefined && Object.hasOwn(tasks, address.target)
        ? tasks[address.target]
        : undefined;
      if (entry === undefined) {
        throw new Error(
          `Flow "${kind}" reaches block "${block.name}", which hands off to ${label}, but the ` +
            `flow declares no such task entry. Add \`tasks: { ${address.target}: { block } }\` ` +
            `to the flow — the block that runs each row this seat hands off.`
        );
      }
      const binding = taskBindingOf(block);
      if (binding === undefined) {
        throw new Error(
          `Flow "${kind}" reaches block "${block.name}", which hands off to ${label}, but no ` +
            `task board holds it. A task dispatcher is a seat: put it under a board's ` +
            `\`workers\`, which is the only place a claim on a durable row is minted.`
        );
      }
      const holder = gatedBy.get(address.target);
      if (holder !== undefined && holder !== binding.boardId) {
        throw new Error(
          `Flow "${kind}" task entry "${address.target}" is handed off to by two boards, ` +
            `"${holder}" and "${binding.boardId}". One entry settles against one ledger; ` +
            `declare a second entry for the second board.`
        );
      }
      if (holder === undefined) {
        gatedBy.set(address.target, binding.boardId);
        gated[address.target] = binding.gate(entry, address.target);
      }
      continue;
    }

    throw new Error(
      `Flow "${kind}" reaches block "${block.name}", which dispatches type ` +
        `"${String((address as { type: string }).type)}". A block may dispatch only the types ` +
        `whose trust it can supply — "internal" and "task".`
    );
  }

  if (tasks === undefined) return undefined;
  for (const name of Object.keys(tasks)) {
    if (gatedBy.has(name)) continue;
    throw new Error(
      `Flow "${kind}" declares task entry "${name}", but no task board reachable from the ` +
        `flow hands off to it. Only a board can dispatch a task — it mints the claim the entry ` +
        `runs under — so an entry without one could never be reached. Add a ` +
        `\`dispatcher({ type: "task", target: "${name}" })\` seat to a board the flow ` +
        `reaches, or remove the entry.`
    );
  }
  return gated;
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
 *   - `sharedToLineage: true` outside session scope (same reason: user and
 *     org scope already span every session in a lineage).
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

    if (entry.sharedToLineage === true && entry.scope !== "session") {
      throw new Error(
        `Resource "${accessor}" in flow "${flowKind}" sets sharedToLineage: true on a ` +
        `${entry.scope}-scoped resource. That scope already spans every session in a ` +
        `lineage — drop the flag.`
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
  blockResources: DeclaredResources | undefined,
  flowKind: string
): DeclaredResources | undefined {
  if (flowResources === undefined && blockResources === undefined) return undefined;
  if (flowResources === undefined) return { ...blockResources };
  if (blockResources === undefined) return { ...flowResources };

  // An override that silently changes WHERE a resource stores is never what an
  // author meant (FIX-1068). `sharedToLineage` decides whether a
  // session-scoped resource resolves against the running session or against the
  // lineage, and a block that declared it — a task board binding its ledger, for
  // instance — built its durability on that answer. Overriding the flag through
  // an accessor-name collision leaves the block claiming rows in one place while
  // the work that must read them looks in another: a parent claims a task in its
  // own session and the child session resolves an empty ledger, which is a
  // silent loop rather than an error. Refused by name, so the author can see
  // which two declarations disagree.
  for (const [accessor, blockEntry] of Object.entries(blockResources)) {
    const flowEntry = (flowResources as DeclaredResources)[accessor];
    if (flowEntry === undefined || flowEntry === blockEntry) continue;
    const blockShared = (blockEntry as { sharedToLineage?: boolean }).sharedToLineage === true;
    const flowShared = (flowEntry as { sharedToLineage?: boolean }).sharedToLineage === true;
    if (blockShared === flowShared) continue;
    throw new Error(
      `Resource "${accessor}" in flow "${flowKind}": the flow-level declaration sets ` +
        `sharedToLineage: ${flowShared}, but a block declared the same accessor with ` +
        `sharedToLineage: ${blockShared}. A flow-level declaration overrides a block's, so ` +
        `this would move the resource between the running session and the lineage without the ` +
        `block knowing — a task board would claim rows in one place while the child session ` +
        `it hands off to reads an empty ledger and loops. Make the two agree, or give one a ` +
        `distinct accessor name.`
    );
  }

  // Block resources first, flow overrides on top.
  return { ...blockResources, ...flowResources };
}

/**
 * `requireUser: false` is a build-time opt-out from the framework's user-
 * scope identity. Flows that opt out must not declare any user-scope state,
 * `client` projection, or resources — otherwise the runtime would have
 * nowhere to route the read/write. We catch the conflict at registration so
 * authors see one clear error at startup rather than a confusing runtime
 * failure on the first request.
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
): FlowInstance<AnyActions, AnySession, AnyRequest, AnyUser, AnyOrg> {
  rejectRemovedMiddleware(definition, `Flow "${definition.kind}"`);
  rejectRemovedMiddleware(options, `Flow "${definition.kind}" instance options`);
  rejectRemovedWork(definition, `Flow "${definition.kind}"`);
  rejectRemovedWork(options, `Flow "${definition.kind}" instance options`);
  rejectDefinitionOnlyOptions(options, definition.kind);

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
  const actions = mergeActions(definition.actions, options?.actions, tools);

  const session = mergeConfig(definition.session, options?.session);
  const user = mergeConfig(definition.user, options?.user);
  const org = mergeConfig(definition.org, options?.org);

  validateScopeClientConfig(kind, "session", session as ScopeWithClient | undefined);
  validateScopeClientConfig(kind, "user", user as ScopeWithClient | undefined);
  validateScopeClientConfig(kind, "org", org as ScopeWithClient | undefined);

  const isolateUserState = options?.isolateUserState ?? definition.isolateUserState ?? false;
  const isolateOrgState = options?.isolateOrgState ?? definition.isolateOrgState ?? false;

  // Validate transport configs before any aggregation walks their blocks: an
  // event binding's handler block participates in resource/`requireOrg`
  // collection, so a malformed binding must be rejected here with a clear
  // message rather than crashing the aggregation (or the tools wrap below).
  //
  // Reading `definition.*` rather than a merge is complete, not a gap — see
  // `rejectDefinitionOnlyOptions`.
  validateChatConfig(kind, definition.chat);
  validateWebhookConfig(kind, definition.webhooks);
  validateSchedulesConfig(kind, definition.schedules);

  // Apply flow-level `tools` to each event handler block the same way
  // `mergeActions` does for caller actions, so an event generator handler runs
  // identically to its caller-action twin. Runs after validation (which
  // guarantees a real `block`); a no-op when the flow declares no tools.
  const webhooks = withFlowToolsWebhooks(definition.webhooks, tools);
  const chat = withFlowToolsChat(definition.chat, tools);
  const schedules = withFlowToolsSchedules(definition.schedules, tools);

  // The two entry maps a caller cannot name. Validated before any aggregation
  // walks their blocks, like the transport maps above; both get the flow's
  // `tools` like a caller action does. A task entry is then put behind its
  // board's claim gate by the address walk below, so the map the instance
  // carries is not the map the author wrote.
  validateEntryMaps(kind, definition.internal, definition.tasks);
  const internal = withFlowToolsEntries(definition.internal, tools);
  const declaredTasks = withFlowToolsEntries(definition.tasks, tools);

  // Enumerated once and shared by every collector below. Three separate
  // walks was how a lifecycle observer's dispatcher could reach `runAction`
  // while being invisible to the address check.
  // Merged before collection, not after: `FlowInstanceOptions` can replace a
  // `request` lifecycle observer, and the instance returned below runs the
  // merged one. Collecting from `definition.*` would read the blocks the flow was
  // authored with rather than the blocks it will execute — missing an override's
  // declarations, and keeping a replaced block's.
  const requestMerged = mergeConfig(definition.request, options?.request);

  // The address check runs over the reachable closure: every dispatcher the
  // flow can reach — through composition, a rescue handler, or a tool edge —
  // must name an entry the flow declares. It also produces the task map the
  // instance carries: each task entry rebuilt behind the claim gate of the
  // board whose hand-off addresses it. The roots below are collected from
  // THAT map, so the gate's own declarations (the board's ledger) count.
  const tasks = resolveDispatchTargets(
    kind,
    walkFlowGraph(
      actionBlocks(actions, internal, declaredTasks, webhooks, chat, schedules, requestMerged)
    ),
    internal,
    declaredTasks
  );

  // Every entry is a root here — including a task entry, whose block is now
  // the board's claim gate around the handed-off worker. The worker is
  // therefore NOT a child of the drain that hands it off (the drain holds a
  // dispatcher in that seat), and it is reached for resources and
  // `requiresOrg` through its entry instead. Resources are collected from the
  // roots and deliberately not from every reachable block: a generator bubbles
  // none of its tools' declarations (FIX-1074), and nothing that runs as its
  // own root is left undeclared — a dispatcher can only name an entry declared
  // above.
  const declaredBlocks = actionBlocks(
    actions,
    internal,
    tasks,
    webhooks,
    chat,
    schedules,
    requestMerged
  );

  const blockResources = collectBlockResources(declaredBlocks);
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
  const mergedResources = mergeFlowResourceMap(flowOwnResources, blockResources, kind);

  if (mergedResources !== undefined) {
    validateFlowResources(mergedResources, kind, isolateUserState, isolateOrgState);
  }

  if (!requireUser) {
    validateRequireUserFalseConsistency(kind, user, mergedResources);
  }

  const mcp = definition.mcp;
  validateMcpConfig(kind, mcp, actions);

  // Reject reserved/unknown concurrency policies at definition time, the same
  // way schedules reject a reserved `onOverlap`. Validate the flow-level
  // default (merged with any instance override) and every per-action override.
  // `actions` is already the merged map, so per-action overrides supplied via
  // `options.actions` are covered by the loop.
  validateConcurrencyConfig(`Flow "${kind}" request default`, requestMerged?.concurrency);
  for (const [actionName, action] of Object.entries(actions)) {
    validateConcurrencyConfig(`Flow "${kind}" action "${actionName}"`, action.concurrency);
  }

  return {
    id: options?.id ?? kind,
    kind,
    requireUser,
    requiresOrg: collectRequiresOrg(declaredBlocks),
    authentication,
    actions,
    ...(internal !== undefined ? { internal } : {}),
    ...(tasks !== undefined ? { tasks } : {}),
    session,
    request: requestMerged,
    user,
    org,
    resources: mergedResources,
    flowLevelResourceKeys,
    tools,
    voice: options?.voice ?? definition.voice,
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
  const TResources extends Record<string, DeclaredResourceEntry> = Record<string, DeclaredResourceEntry>
>(
  definition: FlowDefinition<TActions, TSession, TRequest, TUser, TOrg, TResources>
): FlowType<TActions, TSession, TRequest, TUser, TOrg, TResources> {
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
    TResources
  >;

  const baseInstance = createFlowInstance(normalizedDefinition, undefined);
  return Object.assign(flowFactory, {
    kind: normalizedDefinition.kind,
    requireUser: baseInstance.requireUser,
    requiresOrg: baseInstance.requiresOrg,
    authentication: baseInstance.authentication,
    actions: baseInstance.actions as TActions,
    // Mirrored for the same reason `requiresOrg` is: this blueprint is read
    // directly, and a missing map reads as an absent feature rather than as an
    // unmirrored one.
    ...(baseInstance.internal !== undefined ? { internal: baseInstance.internal } : {}),
    ...(baseInstance.tasks !== undefined ? { tasks: baseInstance.tasks } : {}),
    session: baseInstance.session as TSession,
    request: baseInstance.request as TRequest,
    user: baseInstance.user as TUser,
    org: baseInstance.org as TOrg,
    resources: baseInstance.resources as TResources | undefined,
    tools: baseInstance.tools,
    voice: baseInstance.voice,
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
