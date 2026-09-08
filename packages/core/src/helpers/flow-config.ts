/**
 * Checking a block's declared flow-config requirement against a concrete bag
 * (FIX-1331).
 *
 * Lives here rather than in `flow/defineFlow.ts` for one reason: the check has
 * two callers on opposite sides of an existing import edge. `defineFlow` runs
 * it at each mint over the blocks its walk can see; `generator`'s tool
 * resolution runs it over the blocks a function-valued `tools` slot returns,
 * which that walk cannot see. `defineFlow` already imports `generator`, so the
 * shared predicate cannot live in either without a cycle.
 */
import type { ZodError, ZodTypeAny } from "zod";
import { deepEqual } from "./deep-equal";

/** One block's declared requirement on the flow's config bag. */
export type FlowConfigRequirement = {
  /** The block that declared it — named in every refusal below. */
  blockName: string;
  /** The block's `flowConfigSchema`. */
  schema: ZodTypeAny;
};

/** Why a bag and a block's declaration do not fit. */
export type FlowConfigMismatch =
  /** The bag does not satisfy the schema at all. */
  | { kind: "unsatisfied"; requirement: FlowConfigRequirement; error: ZodError }
  /**
   * The schema parses, but its output differs from the bag — a `.default()`
   * or a `.transform()` on a requirement. The block would read a value the bag
   * does not hold, through a type that says otherwise.
   */
  | { kind: "contributes"; requirement: FlowConfigRequirement; keys: string[] };

/**
 * The first requirement the bag does not fit, or `undefined`.
 *
 * Two distinct failures, in the order they matter:
 *
 * 1. **Unsatisfied** — `safeParse` fails. A parse of the real value rather
 *    than a comparison of two schemas, so it is exact: refinements run, unions
 *    resolve, nested objects are checked to the bottom, and the flow's own
 *    defaults have already been applied.
 *
 * 2. **Contributes** — `safeParse` succeeds but its OUTPUT differs from the
 *    bag. A block declares what it NEEDS of a flow, not what it adds: the bag
 *    is one frozen object every block reads, so honouring a block-side default
 *    would show every other block a setting the definition never declared.
 *    Discarding it silently is worse still — the block's own type would then
 *    promise a value the bag does not hold. So it is refused, and a default
 *    belongs on the flow's `configSchema` where it is declared once.
 */
export function findFlowConfigMismatch(
  bag: Record<string, unknown>,
  requirements: readonly FlowConfigRequirement[]
): FlowConfigMismatch | undefined {
  for (const requirement of requirements) {
    const result = requirement.schema.safeParse(bag);
    if (!result.success) {
      return { kind: "unsatisfied", requirement, error: result.error };
    }
    const parsed = result.data as Record<string, unknown>;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      // A top-level `.transform()` on a requirement: the block would read
      // something the bag is not. Same failure as a default, reported against
      // the whole declaration rather than a key.
      return { kind: "contributes", requirement, keys: ["<the whole bag>"] };
    }
    // The requirement schema is not closed, so its output is normally a subset
    // of the bag. A key whose parsed value differs from the bag's — including
    // one the bag does not have at all — is the schema contributing rather
    // than reading.
    const contributed = Object.keys(parsed).filter(
      (key) => !Object.hasOwn(bag, key) || !deepEqual(parsed[key], bag[key])
    );
    if (contributed.length > 0) {
      return { kind: "contributes", requirement, keys: contributed };
    }
  }
  return undefined;
}

/** Render a Zod failure so the offending key is in the message, not just a path. */
export function describeFlowConfigIssues(error: ZodError): string {
  return error.issues
    .map((issue) => {
      if (issue.code === "unrecognized_keys") {
        const keys = (issue as unknown as { keys: string[] }).keys;
        return `${keys.map((key) => `"${key}"`).join(", ")} is not a declared setting`;
      }
      const at = issue.path.length > 0 ? `"${issue.path.join(".")}": ` : "";
      return `${at}${issue.message}`;
    })
    .join("; ");
}

/**
 * The refusal text for one mismatch, given who is asking. `where` names the
 * flow and, at a mint, the instance — so the message points at the copy that
 * cannot run rather than at the definition.
 */
export function describeFlowConfigMismatch(where: string, mismatch: FlowConfigMismatch): string {
  if (mismatch.kind === "unsatisfied") {
    return (
      `${where} has a config bag that block "${mismatch.requirement.blockName}" cannot read: ` +
      `${describeFlowConfigIssues(mismatch.error)}. That block declares \`flowConfigSchema\`; the ` +
      `flow's configSchema must produce a bag that satisfies it, and this copy's does not.`
    );
  }
  const keys = mismatch.keys.map((key) => `"${key}"`).join(", ");
  return (
    `${where}: block "${mismatch.requirement.blockName}" declares a flowConfigSchema that would ` +
    `change the bag at ${keys} — a default, a transform, or a coercion. A block declares what it ` +
    `NEEDS of the flow that installs it, not what it contributes: the bag is one frozen object every ` +
    `block reads, so a value only this block's schema produces would either be invisible to it at run ` +
    `time or visible to blocks the definition never declared it for. Move the default onto the flow's ` +
    `configSchema, and declare the bare requirement here.`
  );
}
