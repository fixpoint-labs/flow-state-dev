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
 */
import { z } from "zod";
import { defineResourceCollection } from "@flow-state-dev/core";
import type { FlowType } from "@flow-state-dev/core/types";
import { seatDoorOf } from "../../src/seat-door";
import { workerConfigSchema } from "../../src/worker-config";

/** Every contract key, read off the contract the way `hire.ts` reads it. */
export const CONTRACT_KEYS = Object.keys(workerConfigSchema().shape);

/** A full contract bag: every key the hire may impose, each with a valid value. */
const PROBE_BAG = {
  instructions: "probe",
  teamInstructions: "probe",
  seatSkills: [],
  seatTools: [],
  seatPackages: [],
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
 * session link FIX-1788 builds; today it is the seat's own id.
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
 * Read off the schema's own refusal of a full bag, exactly the reading
 * `admissionHint` in hire.ts does today: a contract key named as undeclared,
 * or no configSchema at all. A refusal for the flow's OWN required settings is
 * not a contract failure, and says nothing.
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
    const missing = CONTRACT_KEYS.filter((key) =>
      message.replace(/\.$/, "").split("; ").some((s) => s.endsWith("is not a declared setting") && s.includes(`"${key}"`))
    );
    return missing.length === 0
      ? undefined
      : `flow "${kind}" does not accept ${missing.map((k) => `\`${k}\``).join(", ")}: compose workerConfigSchema()`;
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
    const shape = resource.stateSchema?.shape as Record<string, unknown> | undefined;
    if (shape !== undefined && Object.hasOwn(shape, ATTRIBUTION_KEY)) continue;
    problems.push(
      `flow "${kind}" keeps "${accessor}" (${resource.ref ?? resource.pattern}) at org scope without ` +
        `\`${ATTRIBUTION_KEY}\`: every member reads it, and nothing says who wrote it`
    );
  }
  return problems;
}

/** All three, in the order an author reads them. */
export function contractProblems(kind: string, flow: AnyFlow): string[] {
  return [configProblem(kind, flow), doorProblem(kind, flow), ...privateStateProblems(kind, flow)].filter(
    (p): p is string => p !== undefined
  );
}
