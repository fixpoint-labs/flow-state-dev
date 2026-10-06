/**
 * FIX-1789 POC · the worker contract's three checks, shared by both shapes.
 *
 * Experimental evidence, not production code. Both shapes call these same
 * functions, so what the comparison measures is WHERE and BY WHOM the checks
 * run, not two different checks.
 *
 * The checks read only what a flow definition already carries: the refusal its
 * own config schema gives a probe bag, its public actions, its bubbled
 * `resources` and its `org` declaration. Nothing here runs a block.
 *
 * After the gate (2026-10-06): the configuration check reads a wrong VALUE for
 * a contract key as well as a missing key, the attribution check reads the
 * field's behaviour rather than its name, and `workerFlowProblems` is the
 * contract as decided (Q2: org scope is not refused). The pre-Q2 set is kept as
 * `preQ2ContractProblems`, for the legs that record the gate.
 */
import { z } from "zod";
import { defineResourceCollection } from "@flow-state-dev/core";
import type { FlowType } from "@flow-state-dev/core/types";
import { seatDoorOf } from "../../src/seat-door";
import { workerConfigSchema } from "../../src/worker-config";

/** Every contract key, read off the contract the way `hire.ts` reads it. */
export const CONTRACT_KEYS = Object.keys(workerConfigSchema().shape);

/**
 * A full contract bag: every key the hire may impose, each with a value of the
 * kind a real hire supplies. The lists are not empty, so a schema that accepts
 * only an empty list is caught too.
 */
const PROBE_TOOL = { name: "contract-probe-tool" };
const PROBE_BAG = {
  instructions: "probe",
  teamInstructions: "probe",
  seatSkills: [{ name: "contract-probe-skill", skillMd: "---\nname: contract-probe-skill\ndescription: probe\n---\nprobe" }],
  seatTools: [PROBE_TOOL],
  seatPackages: [{ name: "probe", path: "teams/probe/packages/probe", tools: [PROBE_TOOL] }],
  seatId: "probe"
};

/**
 * Who wrote an entry of a shared resource: the user, and the worker when one
 * did (ER-11). The field every shared resource's state must carry.
 */
export const attributionSchema = z
  .object({ userId: z.string().min(1), workerId: z.string().min(1).optional() })
  .strict();
export const ATTRIBUTION_KEY = "writtenBy";

type AnyFlow = FlowType<any, any, any, any, any, any, any>;

/**
 * A shared resource: an org-scoped collection whose every entry names who wrote
 * it. Shape-neutral, so both shapes declare shared state the same way.
 */
export function sharedResource<T extends z.ZodRawShape>(pattern: string, shape: T) {
  return defineResourceCollection({
    pattern,
    scope: "org",
    stateSchema: z.object({ ...shape, [ATTRIBUTION_KEY]: attributionSchema })
  });
}

/**
 * Write one entry of a shared resource, stamped from trusted identity: the
 * session's user, never an input. `workerId` stands in for the server-owned
 * session link FIX-1788 builds; today it is the per-hire id, `seatId`.
 *
 * The stamp is this helper's, not the store's: flow code writing the resource
 * directly can put any schema-valid `writtenBy` there (leg K3).
 */
export async function writeShared(ctx: any, accessor: string, key: string, data: Record<string, unknown>) {
  const userId: string = ctx.session.identity.userId;
  const workerId: string | undefined = ctx.flow?.config?.seatId;
  const writtenBy = workerId === undefined ? { userId } : { userId, workerId };
  await ctx.resources[accessor].create(key, { ...data, [ATTRIBUTION_KEY]: writtenBy });
}

/**
 * 1 · Does the flow accept the standard configuration?
 *
 * Read off the schema's own refusal of a full bag: a contract key named as
 * undeclared (the reading `admissionHint` in hire.ts does today), a contract
 * key whose value it refuses (leg K1), or no configSchema at all. A refusal
 * for the flow's OWN required settings is not a contract failure, and says
 * nothing.
 */
export function configProblem(kind: string, flow: AnyFlow): string | undefined {
  try {
    (flow as any)({ id: `${kind}::contract-probe`, config: PROBE_BAG });
    return undefined;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("declares no configSchema")) {
      return `flow "${kind}" declares no configSchema, so a worker's standard configuration has nowhere to arrive`;
    }
    const segments = message.replace(/\.$/, "").split("; ");
    const missing = CONTRACT_KEYS.filter((key) =>
      segments.some((s) => s.endsWith("is not a declared setting") && s.includes(`"${key}"`))
    );
    if (missing.length > 0) {
      return `flow "${kind}" does not accept ${missing.map((k) => `\`${k}\``).join(", ")}: compose workerConfigSchema()`;
    }
    const wrong = CONTRACT_KEYS.filter((key) => segments.some((s) => new RegExp(`"${key}(\\.[^"]*)?": `).test(s)));
    return wrong.length === 0
      ? undefined
      : `flow "${kind}" does not accept the value a worker's hire supplies for ${wrong.map((k) => `\`${k}\``).join(", ")}: compose workerConfigSchema()`;
  }
}

/** 2 · Does the flow have exactly one door? */
export function doorProblem(kind: string, flow: AnyFlow): string | undefined {
  const { door, problem } = seatDoorOf({ id: kind, kind, actions: flow.actions as Record<string, unknown> });
  if (problem !== undefined) return problem;
  return door === null ? `flow "${kind}" has no door: no public action takes \`{ message }\` with \`userMessage\`` : undefined;
}

/**
 * 3 · Does the flow keep a worker's state private, as far as its declarations show?
 *
 * Private means private to one user inside one org. Request, session and user
 * scopes are that already (user per org once FIX-1790 lands). The org scope is
 * shared by every member, so an org-scoped resource is allowed only when it is a
 * shared resource: its state carries `writtenBy`. A declared org scope record is
 * refused outright: it is one blob every member's run writes.
 *
 * What this CANNOT see is a block writing `ctx.org.state` with nothing
 * declared. The runtime legs of the test show that path is open.
 */
export function privateStateProblems(kind: string, flow: AnyFlow): string[] {
  const problems: string[] = [];
  if ((flow as any).org?.stateSchema !== undefined) {
    problems.push(`flow "${kind}" declares org scope state, which every member of the org reads and writes`);
  }
  for (const [accessor, resource] of Object.entries((flow.resources ?? {}) as Record<string, any>)) {
    if (resource?.scope !== "org") continue;
    // A declared `writtenBy` is judged by attributionProblems; here only its presence matters.
    if (declaredAttribution(resource) !== undefined) continue;
    problems.push(
      `flow "${kind}" keeps "${accessor}" (${resource.ref ?? resource.pattern}) at org scope without ` +
        `\`${ATTRIBUTION_KEY}\`: every member reads it, and nothing says who wrote it`
    );
  }
  return problems;
}

/** The `writtenBy` field a resource's state declares, if any. */
function declaredAttribution(resource: any): z.ZodTypeAny | undefined {
  const shape = resource?.stateSchema?.shape as Record<string, z.ZodTypeAny> | undefined;
  return shape !== undefined && Object.hasOwn(shape, ATTRIBUTION_KEY) ? shape[ATTRIBUTION_KEY] : undefined;
}

/** What the contract's field must accept, and what it must refuse. */
const ATTRIBUTION_ACCEPTS = [{ userId: "alice" }, { userId: "alice", workerId: "researcher" }];
const ATTRIBUTION_REFUSES = [undefined, null, {}, { workerId: "researcher" }, { userId: "" }, "alice"];

/**
 * 3a · Is every declared `writtenBy` the contract's complete field?
 *
 * Read off the field's behaviour, not its name (leg K2): it must take a
 * user, with or without a worker, and refuse an entry with no user. Applies to
 * any resource that declares the field, whatever its scope.
 */
export function attributionProblems(kind: string, flow: AnyFlow): string[] {
  const problems: string[] = [];
  for (const [accessor, resource] of Object.entries((flow.resources ?? {}) as Record<string, any>)) {
    const field = declaredAttribution(resource);
    if (field === undefined) continue;
    const complete =
      ATTRIBUTION_ACCEPTS.every((value) => field.safeParse(value).success) &&
      ATTRIBUTION_REFUSES.every((value) => !field.safeParse(value).success);
    if (complete) continue;
    problems.push(
      `flow "${kind}" declares \`${ATTRIBUTION_KEY}\` on "${accessor}" (${resource.ref ?? resource.pattern}), but not as ` +
        `the contract's field: it must require \`{ userId, workerId? }\` on every entry. Use sharedResource()`
    );
  }
  return problems;
}

/**
 * The contract as decided at the gate (Q2, 2026-10-06): configuration, one
 * door, and well-formed attribution wherever a resource declares it. Org scope
 * is not refused: a flow writes there by its author's choice.
 */
export function workerFlowProblems(kind: string, flow: AnyFlow): string[] {
  return [configProblem(kind, flow), doorProblem(kind, flow), ...attributionProblems(kind, flow)].filter(
    (p): p is string => p !== undefined
  );
}

/**
 * All three, as the spec went to its gate, in the order an author reads them.
 * Superseded by Q2: evidence only. Registration uses {@link workerFlowProblems}.
 */
export function preQ2ContractProblems(kind: string, flow: AnyFlow): string[] {
  return [
    configProblem(kind, flow),
    doorProblem(kind, flow),
    ...attributionProblems(kind, flow),
    ...privateStateProblems(kind, flow)
  ].filter((p): p is string => p !== undefined);
}
