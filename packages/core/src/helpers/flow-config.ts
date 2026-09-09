/**
 * Checking a block's declared flow-config requirement against a concrete bag
 * (FIX-1331).
 *
 * Lives here rather than in `flow/defineFlow.ts` for one reason: the check has
 * two callers on opposite sides of an existing import edge. `defineFlow` runs
 * it at each mint over the blocks its walk can see; `generator`'s tool
 * resolution runs it over the blocks a function-valued `tools` slot returns,
 * which that walk cannot see. `defineFlow` already imports `generator`, so the
 * shared predicate cannot live in either without a cycle. The walk that finds
 * those blocks lives here for the same reason.
 */
import type { ZodError, ZodTypeAny } from "zod";
import type { BlockDefinition } from "../types/block";
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
    // of the bag — at every level. A path the parse HOLDS that the bag does not
    // is the schema contributing rather than reading.
    const contributed = contributedPaths(parsed, bag, "");
    if (contributed.length > 0) {
      return { kind: "contributes", requirement, keys: contributed };
    }
  }
  return undefined;
}

/** A value Zod strips keys from, as opposed to one it compares whole. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Every path where the parsed output holds something the bag does not.
 *
 * The subtlety this exists for: **Zod strips unknown keys at every level, not
 * just the top.** A requirement naming one setting inside a nested object
 * parses to a nested object SMALLER than the bag's, and comparing those two
 * objects whole reads that narrowing as a contribution — refusing a block that
 * is doing exactly what `flowConfigSchema` is for. So the comparison descends
 * instead: through plain objects, and element-wise through same-length arrays
 * (Zod strips inside `z.array(z.object(...))` too).
 *
 * What it still catches, at any depth, is the failure the rule is about: a key
 * the bag does not have, or a different value at a key it does. A `.default()`
 * three levels down is refused exactly like one at the top.
 */
function contributedPaths(parsed: unknown, held: unknown, at: string): string[] {
  if (isPlainObject(parsed) && isPlainObject(held)) {
    const paths: string[] = [];
    for (const key of Object.keys(parsed)) {
      const path = at === "" ? key : `${at}.${key}`;
      if (!Object.hasOwn(held, key)) {
        paths.push(path);
        continue;
      }
      paths.push(...contributedPaths(parsed[key], held[key], path));
    }
    return paths;
  }
  if (Array.isArray(parsed) && Array.isArray(held) && parsed.length === held.length) {
    const paths: string[] = [];
    for (let i = 0; i < parsed.length; i++) {
      paths.push(...contributedPaths(parsed[i], held[i], `${at}[${i}]`));
    }
    return paths;
  }
  return deepEqual(parsed, held) ? [] : [at];
}

function staticTools(block: BlockDefinition): readonly BlockDefinition[] {
  const tools = (block.config as { tools?: unknown }).tools;
  return Array.isArray(tools) ? (tools as BlockDefinition[]) : [];
}

/**
 * Every block reachable from the roots, through composition and a generator's
 * static `tools` array. Rescue handlers are already on `childBlocks`.
 */
export function walkBlockGraph(roots: readonly BlockDefinition[]): BlockDefinition[] {
  const seen = new Set<BlockDefinition>();
  const queue: BlockDefinition[] = [...roots];
  while (queue.length > 0) {
    const block = queue.pop()!;
    if (seen.has(block)) continue;
    seen.add(block);
    queue.push(...(block.childBlocks ?? []));
    queue.push(...staticTools(block));
  }
  return [...seen];
}

/** Render a Zod failure so the offending key is in the message, not just a path. */
export function describeFlowConfigIssues(error: ZodError): string {
  return error.issues
    .map((issue) => {
      if (issue.code === "unrecognized_keys") {
        const keys = (issue as unknown as { keys: string[] }).keys;
        const named = keys.map((key) => `"${key}"`).join(", ");
        // The path matters once a nested object is closed with `.strict()`:
        // "retrys" alone does not say which setting it was meant to be inside.
        return issue.path.length > 0
          ? `${named} is not a declared setting of "${issue.path.join(".")}"`
          : `${named} is not a declared setting`;
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
