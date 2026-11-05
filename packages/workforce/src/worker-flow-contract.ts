/**
 * The worker contract: what a flow must be before any worker runs on it.
 *
 * Four checks, each read off the flow DEFINITION rather than off a worker's
 * copy of it, so they hold however many workers share one flow:
 *
 * 1. **Configuration.** The flow takes the configuration a real hire supplies.
 *    Judged by the flow's own refusal of a full bag — every key of
 *    `workerConfigSchema()`, each with a value of the type a hire hands over
 *    and every list non-empty — not by the names it declares. A key it leaves
 *    undeclared and a key it types differently (`workerId` as a number) both
 *    count; a refusal of the flow's OWN settings does not, because every
 *    worker supplies those and no probe can.
 * 2. **One door, `respond`.** Exactly one public action takes a user's
 *    message, and it is named `respond`, so an app can talk to any worker
 *    without knowing its flow. "Door" is `worker-door.ts`'s definition, read
 *    here and not restated.
 * 3. **Attribution.** A resource that declares `writtenBy` was built by
 *    `sharedResource()`, which owns the field. Judged by where the resource
 *    came from, not by what its schema happens to accept: no finite set of
 *    sample values proves an arbitrary schema stores the whole field.
 * 4. **Roles.** Each role the flow is registered with has its entries, built
 *    by the role's factory and taking what their caller sends, and no piece of
 *    a role's factory sits on a flow that doesn't declare it
 *    (`./worker-roles`, the one table of a role's entries).
 * 5. **Role state.** A manager's and a coordinator's pieces read session
 *    fields they don't own the schema of (the delegate list, the notices
 *    acted on, a coordinator's rounds) and trust each to hold its default. So
 *    the flow's session `stateSchema` must declare each one with a default:
 *    the engine fills a missing field only from the flow's own schema.
 *
 * What is deliberately NOT checked: where a flow keeps its data. Org scope is
 * shared with the whole org by design, and a flow writes there because its
 * author built it to.
 *
 * Admission stays the schema's own: this module reads the flow's refusal, as
 * the issues core attaches to it (never its message text), and decides nothing
 * about configuration on its own. A refusal it can't read is a problem, not a
 * pass.
 */
import { FlowConfigRefusalError } from "@flow-state-dev/core";
import { deepEqual } from "@flow-state-dev/core/helpers";
import type { FlowType } from "@flow-state-dev/core/types";
import { doorProblem } from "./worker-door";
import { workerConfigSchema } from "./worker-config";
import { WRITTEN_BY_KEY, declaresWrittenBy, isSharedResource } from "./shared-resource";
import { builtInRolesOf, roleProblems, type WorkerRole } from "./worker-roles";
import { delegateStateShape } from "./delegates/delegate-list";
import { conversationBoardStateShape } from "./conversation-board/task-settled";
import { coordinatorStateShape } from "./coordinator/coordinator-state";

/** Any flow definition, whatever it declares. */
export type WorkerFlowDefinition = FlowType<any, any, any, any, any, any, any>;

/**
 * The configuration's keys, in the order an author reads them — read off the
 * contract, never listed by hand, so a key added there is checked here the day
 * it lands.
 */
export const CONTRACT_KEYS: readonly string[] = Object.keys(workerConfigSchema().shape);

/** A tool as it rides into the bag: anything with a name (`workerToolSchema`). */
const PROBE_TOOL = { name: "worker-contract-probe-tool" };

/**
 * A full bag, as a real hire would hand it over: a value for every key, of the
 * type the hire supplies, and every list non-empty — so a flow that accepts
 * only an empty list is caught too. Kept in step with {@link CONTRACT_KEYS} by
 * a test that fails when a key has no probe value.
 */
export const CONTRACT_PROBE_BAG: Readonly<Record<string, unknown>> = Object.freeze({
  instructions: "probe",
  teamInstructions: "probe",
  workerSkills: [
    {
      name: "worker-contract-probe-skill",
      skillMd: "---\nname: worker-contract-probe-skill\ndescription: probe\n---\nprobe"
    }
  ],
  workerTools: [PROBE_TOOL],
  workerPackages: [{ name: "probe", path: "teams/probe/packages/probe", tools: [PROBE_TOOL] }],
  workerId: "probe",
  delegates: ["probe"]
});

/**
 * Which of `keys` the flow's `configSchema` doesn't declare, read the way
 * {@link contractKeysRefused} reads the contract's: mint a probe copy with the
 * full bag and each key set, and take the keys its refusal names as not
 * declared. A refusal of a key's probe value, or of a setting of the flow's
 * own that the bag leaves out, says nothing about declaration and is passed
 * over.
 */
export function undeclaredSettings(flow: WorkerFlowDefinition, keys: readonly string[]): string[] {
  if (keys.length === 0) return [];
  try {
    (flow as unknown as (options: { id: string; config: Record<string, unknown> }) => unknown)({
      id: `${flow.kind}::shown-settings-probe`,
      config: { ...CONTRACT_PROBE_BAG, ...Object.fromEntries(keys.map((key) => [key, null])) }
    });
    return [];
  } catch (error) {
    if (!(error instanceof FlowConfigRefusalError)) return [];
    const undeclared = new Set(
      error.issues
        .filter((issue) => issue.code === "unrecognized_keys" && issue.path.length === 1)
        .map((issue) => String(issue.path[0]))
    );
    return keys.filter((key) => undeclared.has(key));
  }
}

/** What a flow's refusal of a bag says about the contract. */
export type ContractRefusal = {
  /** The flow declares no `configSchema` at all. */
  noConfigSchema: boolean;
  /** Contract keys the refusal names as not declared, in contract order. */
  undeclared: string[];
  /** Contract keys whose value the refusal names as wrong, in contract order. */
  wrongValue: string[];
  /** What the refusal says about the bag as a whole (an empty path). */
  wholeBag: string[];
  /**
   * The refusal carries no issues this reader can read. The caller refuses
   * the flow rather than reading it as a pass.
   */
  unread: boolean;
};

/**
 * Read a flow's refusal of a bag for what it says about the contract's keys.
 *
 * Reads the issues core attaches to a config refusal, path by path, never the
 * message. An undeclared key at the top that the contract names, and any
 * issue at or inside a contract key, count. An issue at an empty path is about
 * the whole bag and always counts. Every other path is the flow's own setting,
 * which every worker supplies and no probe can, so it doesn't count. Anything
 * that isn't a config refusal sets `unread`.
 *
 * @param error What minting the flow threw.
 */
export function contractKeysRefused(error: unknown): ContractRefusal {
  const read: ContractRefusal = { noConfigSchema: false, undeclared: [], wrongValue: [], wholeBag: [], unread: false };
  if (!(error instanceof FlowConfigRefusalError) || error.issues.length === 0) return { ...read, unread: true };
  const undeclared = new Set<string>();
  const wrongValue = new Set<string>();
  for (const issue of error.issues) {
    if (issue.code === "no_config_schema") {
      read.noConfigSchema = true;
      continue;
    }
    const [top] = issue.path;
    if (top === undefined) {
      read.wholeBag.push(issue.message);
      continue;
    }
    if (typeof top !== "string" || !CONTRACT_KEYS.includes(top)) continue;
    if (issue.code === "unrecognized_keys" && issue.path.length === 1) undeclared.add(top);
    else wrongValue.add(top);
  }
  read.undeclared = CONTRACT_KEYS.filter((key) => undeclared.has(key));
  read.wrongValue = CONTRACT_KEYS.filter((key) => wrongValue.has(key));
  return read;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function listed(keys: readonly string[]): string {
  return keys.map((key) => `\`${key}\``).join(", ");
}

/**
 * Check 1, when the flow took the bag: every contract key reads back as the
 * hire supplied it. A schema that accepts a key but transforms or defaults it
 * over would give every worker on the flow the same value, such as one
 * `workerId` for all of them.
 */
function changedValuesProblem(name: string, minted: unknown): string | undefined {
  const config = ((minted as { config?: unknown } | null)?.config ?? {}) as Record<string, unknown>;
  const changed = CONTRACT_KEYS.filter((key) => !deepEqual(config[key], CONTRACT_PROBE_BAG[key]));
  if (changed.length === 0) return undefined;
  const reads = changed
    .map((key) => `\`${key}\` reads ${JSON.stringify(config[key])} where the hire gave ${JSON.stringify(CONTRACT_PROBE_BAG[key])}`)
    .join("; ");
  return (
    `worker flow "${name}" changes the value a worker's hire supplies for ${listed(changed)} (${reads}). ` +
    `Take each as given: compose \`workerConfigSchema()\` without a transform or default over its keys.`
  );
}

/** Check 1: the flow's own refusal of a full bag, read for the contract's keys. */
function configurationProblem(name: string, flow: WorkerFlowDefinition): string | undefined {
  let refused: ContractRefusal;
  let refusal: string;
  try {
    const minted = (flow as unknown as (options: { id: string; config: Record<string, unknown> }) => unknown)({
      id: `${flow.kind}::worker-contract-probe`,
      config: { ...CONTRACT_PROBE_BAG }
    });
    return changedValuesProblem(name, minted);
  } catch (error) {
    refusal = messageOf(error);
    refused = contractKeysRefused(error);
  }
  const fix = `Compose it: \`configSchema: workerConfigSchema().extend({ ...its own settings })\`.`;
  if (refused.noConfigSchema) {
    return (
      `worker flow "${name}" declares no configSchema, so a worker's configuration ` +
      `(${listed(CONTRACT_KEYS)}) has nowhere to arrive. ${fix}`
    );
  }
  const parts: string[] = [];
  if (refused.undeclared.length > 0) parts.push(`doesn't accept ${listed(refused.undeclared)}`);
  const wrong = refused.wrongValue.filter((key) => !refused.undeclared.includes(key));
  if (wrong.length > 0) parts.push(`refuses the value a worker's hire supplies for ${listed(wrong)}`);
  const sentences: string[] = [];
  if (parts.length > 0) sentences.push(`worker flow "${name}" ${parts.join(", and ")}. ${fix}`);
  if (refused.wholeBag.length > 0) {
    sentences.push(`worker flow "${name}" refuses a worker's configuration as a whole: ${refusal}`);
  }
  if (sentences.length > 0) return sentences.join(" ");
  if (refused.unread) {
    return (
      `worker flow "${name}" refused the configuration a worker's hire supplies, for a reason this ` +
      `check can't read, so it can't tell whether the flow takes a worker's configuration: ${refusal}`
    );
  }
  return undefined;
}


type DeclaredResourceLike = {
  scope?: unknown;
  pattern?: unknown;
  ref?: unknown;
  stateSchema?: unknown;
};

/** Check 3: a resource declaring `writtenBy` was built by `sharedResource()`, at any scope. */
function attributionProblems(name: string, flow: WorkerFlowDefinition): string[] {
  const problems: string[] = [];
  const resources = (flow.resources ?? {}) as Readonly<Record<string, DeclaredResourceLike>>;
  for (const accessor of Object.keys(resources).sort()) {
    const resource = resources[accessor];
    if (isSharedResource(resource) || !declaresWrittenBy(resource?.stateSchema)) continue;
    const where = String(resource?.pattern ?? resource?.ref ?? accessor);
    problems.push(
      `worker flow "${name}" declares \`${WRITTEN_BY_KEY}\` on "${accessor}" (${where}) on a resource ` +
        `\`sharedResource()\` didn't build. Declare it with \`sharedResource(pattern, shape)\`, which ` +
        `adds \`${WRITTEN_BY_KEY}\` as a required \`{ userId, workerId? }\` on every entry.`
    );
  }
  return problems;
}

/**
 * Every way `flow` misses the worker contract, registered as `name` — or an
 * empty list when it is a worker flow.
 *
 * The check a hire runs once per flow, before any worker runs, and exported so
 * a library of worker flows can call it in its own tests without an
 * app: `expect(workerFlowProblems("triage", triageFlow)).toEqual([])`.
 *
 * Reads the definition only; it runs no block and writes nothing.
 *
 * @param name The name the flow is registered under. It must be the flow's own `kind`.
 * @param flow The flow definition, as `defineFlow` returned it.
 * @param roles The roles its registration declares (`contributor`, `manager`,
 *   `coordinator`). Omitted, the roles a built-in flow declares itself, and
 *   none for any other flow.
 * @returns One sentence per problem, each naming the flow.
 */
export function workerFlowProblems(
  name: string,
  flow: WorkerFlowDefinition,
  roles: readonly WorkerRole[] = builtInRolesOf(flow) ?? []
): string[] {
  const misnamed =
    flow.kind === name
      ? undefined
      : `worker flow "${name}" is passed under that name, but its kind is "${String(flow.kind)}": a worker ` +
        `naming "${name}" would run a different flow's graph. Pass each flow under its own kind.`;
  // A role's state is judged once its pieces are its factory's: a flow
  // refused for its entries is told that first, in one sentence.
  const roleIssues = roleProblems(name, flow, roles);
  return [
    misnamed,
    configurationProblem(name, flow),
    doorProblem(name, (flow.actions ?? {}) as Readonly<Record<string, unknown>>),
    ...attributionProblems(name, flow),
    ...roleIssues,
    roleIssues.length === 0 ? roleStateProblem(name, flow, roles) : undefined
  ].filter((problem): problem is string => problem !== undefined);
}

/**
 * The session fields each role's pieces read, and where a flow gets them.
 * Read when a flow is checked, not when this module loads: the shapes' modules
 * reach back into the worker code.
 */
function roleStateFields(role: WorkerRole): { readonly keys: readonly string[]; readonly fix: string } | undefined {
  if (role === "manager") {
    return {
      keys: Object.keys({ ...delegateStateShape, ...conversationBoardStateShape }),
      fix: "Spread the board's `sessionStateShape` into it: `session: installation.session(board.sessionStateShape)`."
    };
  }
  if (role === "coordinator") {
    return {
      keys: Object.keys({ ...coordinatorStateShape, ...conversationBoardStateShape }),
      fix: "Only `defineCoordinatorFlow` builds a coordinator, and its session declares them: run its workers on that flow."
    };
  }
  return undefined;
}

/** The fields of a schema's `z.object`, or `undefined` when it isn't one (nothing to read keys off). */
function sessionFields(schema: unknown): Readonly<Record<string, { safeParse?: (value: unknown) => { success: boolean; data?: unknown } }>> | undefined {
  const shape = (schema as { _def?: { typeName?: string; shape?: () => unknown } } | undefined)?._def;
  if (shape?.typeName !== "ZodObject" || typeof shape.shape !== "function") return undefined;
  return shape.shape() as Readonly<Record<string, { safeParse?: (value: unknown) => { success: boolean; data?: unknown } }>>;
}

/**
 * Why a flow's roles would read a session field it doesn't default, or
 * `undefined`. A field counts as defaulted when the flow's session schema
 * declares it and reads a value for a record that lacks it. A session schema
 * that isn't a plain `z.object` can't be read for keys and isn't judged.
 */
function roleStateProblem(name: string, flow: WorkerFlowDefinition, roles: readonly WorkerRole[]): string | undefined {
  const role = roles.includes("coordinator") ? "coordinator" : roles.includes("manager") ? "manager" : undefined;
  const fields = role === undefined ? undefined : roleStateFields(role);
  if (role === undefined || fields === undefined) return undefined;
  const schema = (flow.session as { stateSchema?: unknown } | undefined)?.stateSchema;
  const declared = schema === undefined ? {} : sessionFields(schema);
  if (declared === undefined) return undefined;
  const missing = fields.keys.filter((key) => {
    const parsed = declared[key]?.safeParse?.(undefined);
    return parsed === undefined || !parsed.success || parsed.data === undefined;
  });
  if (missing.length === 0) return undefined;
  return (
    `worker flow "${name}" declares the "${role}" role, but its session \`stateSchema\` doesn't default ` +
    `${missing.map((key) => `"${key}"`).join(", ")}, which the role's pieces read on every turn. ${fields.fix}`
  );
}
