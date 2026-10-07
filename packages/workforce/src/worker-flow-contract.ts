/**
 * The worker contract: what a flow must be before any worker runs on it.
 *
 * Three checks, each read off the flow DEFINITION rather than off a worker's
 * copy of it, so they hold however many workers share one flow:
 *
 * 1. **Configuration.** The flow takes the configuration a real hire supplies.
 *    Judged by the flow's own refusal of a full bag — every key of
 *    `workerConfigSchema()`, each with a value of the kind a hire hands over
 *    and every list non-empty — not by the names it declares. A key it leaves
 *    undeclared and a key it types differently (`seatId` as a number) both
 *    count; a refusal of the flow's OWN settings does not, because every
 *    worker supplies those and no probe can.
 * 2. **One door.** Exactly one public action takes a person's message, so an
 *    app can talk to any worker without knowing its flow. "Door" is
 *    `seatDoorOf`'s definition, read here and not restated.
 * 3. **Attribution.** Every `writtenBy` the flow's resources declare is the
 *    contract's whole field, judged by what it accepts and refuses. A loose
 *    one would store an entry that names nobody.
 *
 * What is deliberately NOT checked: where a flow keeps its data. Org scope is
 * shared with the whole org by design, and a flow writes there because its
 * author built it to.
 *
 * Admission stays the schema's own: this module reads the flow's refusal and
 * decides nothing about configuration on its own. A refusal it can't read is a
 * problem, not a pass, so a change to core's wording refuses loudly.
 */
import type { FlowType } from "@flow-state-dev/core/types";
import { seatDoorOf } from "./seat-door";
import { workerConfigSchema } from "./worker-config";
import { WRITTEN_BY_KEY, declaredWrittenByFields, isSharedWrittenBy } from "./shared-resource";

/** Any flow definition, whatever it declares. */
export type WorkerFlowDefinition = FlowType<any, any, any, any, any, any, any>;

/**
 * The configuration's keys, in the order an author reads them — read off the
 * contract, never listed by hand, so a key added there is checked here the day
 * it lands.
 */
export const CONTRACT_KEYS: readonly string[] = Object.keys(workerConfigSchema().shape);

/** A tool as it rides into the bag: anything with a name (`seatToolSchema`). */
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
  seatSkills: [
    {
      name: "worker-contract-probe-skill",
      skillMd: "---\nname: worker-contract-probe-skill\ndescription: probe\n---\nprobe"
    }
  ],
  seatTools: [PROBE_TOOL],
  seatPackages: [{ name: "probe", path: "teams/probe/packages/probe", tools: [PROBE_TOOL] }],
  seatId: "probe"
});

/** What a flow's refusal of a bag says about the contract. */
export type ContractRefusal = {
  /** The flow declares no `configSchema` at all. */
  noConfigSchema: boolean;
  /** Contract keys the refusal names as not declared, in contract order. */
  undeclared: string[];
  /** Contract keys whose value the refusal names as wrong, in contract order. */
  wrongValue: string[];
  /**
   * The refusal, or a part of it, is in no shape this reader knows. The
   * caller refuses the flow rather than reading it as a pass.
   */
  unread: boolean;
};

// The shapes of core's mint refusals (`normalizeInstanceConfig`,
// `describeFlowConfigMismatch`). Each carries the issues as
// `describeFlowConfigIssues` renders them, or the paths a block would change.
const NO_CONFIG_SCHEMA =
  /^Flow "[^"]*" instance "[^"]*" was created with a config bag, but the flow declares no configSchema\./;
const INVALID_BAG = /^Flow "[^"]*" instance "[^"]*" has an invalid config bag: (.*)\.$/s;
const BLOCK_CANNOT_READ =
  /^Flow "[^"]*" instance "[^"]*" has a config bag that block "[^"]*" cannot read: (.*)\. That block declares `flowConfigSchema`; /s;
const BLOCK_WOULD_CHANGE =
  /^Flow "[^"]*" instance "[^"]*": block "[^"]*" declares a flowConfigSchema that would change the bag at ((?:"[^"]*"(?:, )?)+) — /s;
// One issue: undeclared keys (`"a", "b" is not a declared setting`, then
// ` of "path"` when nested), or a value (`"path": message`).
const UNDECLARED_ISSUE = /^((?:"[^"]*"(?:, )?)+) is not a declared setting( of "[^"]*")?$/s;
const VALUE_ISSUE = /^"([^"]*)": .+$/s;

function quoted(list: string): string[] {
  return [...list.matchAll(/"([^"]*)"/g)].map((match) => match[1]!);
}

/** The contract key a path starts at (`seatSkills.0.name`, `seatSkills[0]`), if any. */
function contractKeyAt(path: string): string | undefined {
  const top = path.split(/[.[]/, 1)[0]!;
  return CONTRACT_KEYS.includes(top) ? top : undefined;
}

/**
 * Read a flow's refusal for what it says about the contract's keys.
 *
 * Reads core's own wording. An undeclared TOP-LEVEL key is
 * `"x" is not a declared setting`; a value is `"x": message` or
 * `"x.0.name": message`. A key inside one of the flow's own nested objects is
 * `… is not a declared setting of "path"` and a nested path is `"own.x"`, so
 * neither names a contract key: the flow's own settings are its business,
 * since every worker supplies them and no probe can. Anything in no shape this
 * knows sets `unread`, so a change to that wording can't pass a flow.
 *
 * @param refusal The flow's own refusal message.
 */
export function contractKeysRefused(refusal: string): ContractRefusal {
  const none: ContractRefusal = { noConfigSchema: false, undeclared: [], wrongValue: [], unread: false };
  if (NO_CONFIG_SCHEMA.test(refusal)) return { ...none, noConfigSchema: true };
  const changed = BLOCK_WOULD_CHANGE.exec(refusal);
  if (changed !== null) {
    const keys = quoted(changed[1]!).map(contractKeyAt);
    return { ...none, wrongValue: CONTRACT_KEYS.filter((key) => keys.includes(key)) };
  }
  const issues = (INVALID_BAG.exec(refusal) ?? BLOCK_CANNOT_READ.exec(refusal))?.[1];
  if (issues === undefined) return { ...none, unread: true };
  const undeclared = new Set<string>();
  const wrongValue = new Set<string>();
  let unread = false;
  for (const issue of issues.split("; ")) {
    const notDeclared = UNDECLARED_ISSUE.exec(issue);
    if (notDeclared !== null) {
      // Nested (` of "path"`): a key inside the flow's own object, never a contract key.
      if (notDeclared[2] === undefined) quoted(notDeclared[1]!).forEach((key) => undeclared.add(key));
      continue;
    }
    const value = VALUE_ISSUE.exec(issue);
    if (value !== null) {
      const key = contractKeyAt(value[1]!);
      if (key !== undefined) wrongValue.add(key);
      continue;
    }
    unread = true;
  }
  return {
    noConfigSchema: false,
    undeclared: CONTRACT_KEYS.filter((key) => undeclared.has(key)),
    wrongValue: CONTRACT_KEYS.filter((key) => wrongValue.has(key)),
    unread
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function listed(keys: readonly string[]): string {
  return keys.map((key) => `\`${key}\``).join(", ");
}

/** Check 1: the flow's own refusal of a full bag, read for the contract's keys. */
function configurationProblem(name: string, flow: WorkerFlowDefinition): string | undefined {
  let refused: ContractRefusal;
  let refusal: string;
  try {
    (flow as unknown as (options: { id: string; config: Record<string, unknown> }) => unknown)({
      id: `${flow.kind}::worker-contract-probe`,
      config: { ...CONTRACT_PROBE_BAG }
    });
    return undefined;
  } catch (error) {
    refusal = messageOf(error);
    refused = contractKeysRefused(refusal);
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
  if (parts.length > 0) return `worker flow "${name}" ${parts.join(", and ")}. ${fix}`;
  if (refused.unread) {
    return (
      `worker flow "${name}" refused the configuration a worker's hire supplies, for a reason this ` +
      `check can't read, so it can't tell whether the flow takes a worker's configuration: ${refusal}`
    );
  }
  return undefined;
}

type ActionMap = Readonly<Record<string, unknown>>;

/** Check 2: exactly one door, by `seatDoorOf`'s definition. */
function doorProblem(name: string, flow: WorkerFlowDefinition): string | undefined {
  const actions = (flow.actions ?? {}) as ActionMap;
  const found = seatDoorOf({ id: name, kind: name, actions });
  if (found.door !== null) return undefined;
  if (found.problem === undefined) {
    return (
      `worker flow "${name}" has no door: no public action declares \`userMessage\` and takes ` +
      `\`{ message }\`, so no worker on it could take a person's message. Give it one.`
    );
  }
  // Two or more. Each action is asked on its own, so "door" keeps one definition.
  const doors = Object.keys(actions)
    .filter((action) => seatDoorOf({ id: name, kind: name, actions: { [action]: actions[action] } }).door === action)
    .sort();
  return (
    `worker flow "${name}" has ${doors.length} doors (${doors.map((d) => `"${d}"`).join(", ")}). ` +
    `Keep one: a door is the one public action with \`userMessage\` and a \`{ message }\` input.`
  );
}

type DeclaredResourceLike = {
  scope?: unknown;
  pattern?: unknown;
  ref?: unknown;
  stateSchema?: unknown;
};

/** Check 3: every declared `writtenBy` is the contract's whole field, at any scope. */
function attributionProblems(name: string, flow: WorkerFlowDefinition): string[] {
  const problems: string[] = [];
  const resources = (flow.resources ?? {}) as Readonly<Record<string, DeclaredResourceLike>>;
  for (const accessor of Object.keys(resources).sort()) {
    const resource = resources[accessor];
    if (declaredWrittenByFields(resource?.stateSchema).every(isSharedWrittenBy)) continue;
    const where = String(resource?.pattern ?? resource?.ref ?? accessor);
    problems.push(
      `worker flow "${name}" declares \`${WRITTEN_BY_KEY}\` on "${accessor}" (${where}) in another shape ` +
        `than a shared resource's: every entry must name a user, as \`{ userId, workerId? }\` with ` +
        `each a non-empty string. Declare it with \`sharedResource()\`.`
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
 * @returns One sentence per problem, each naming the flow.
 */
export function workerFlowProblems(name: string, flow: WorkerFlowDefinition): string[] {
  const misnamed =
    flow.kind === name
      ? undefined
      : `worker flow "${name}" is passed under that name, but its kind is "${String(flow.kind)}": a worker ` +
        `naming "${name}" would run a different flow's graph. Pass each flow under its own kind.`;
  return [
    misnamed,
    configurationProblem(name, flow),
    doorProblem(name, flow),
    ...attributionProblems(name, flow)
  ].filter((problem): problem is string => problem !== undefined);
}
