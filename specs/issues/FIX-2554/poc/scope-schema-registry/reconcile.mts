/**
 * POC · the reconciliation rules every variant shares.
 *
 * Throwaway evidence for FIX-2554's follow-up, not production code. A and B
 * differ in WHEN and OVER WHAT this runs (a process-wide registry vs one
 * flow's reachable blocks); the rules themselves are the same, so they live
 * here once and the comparison is about lifetime, not about two merge
 * algorithms.
 *
 * Rules (the epic spec set's seam rule, PR #4772):
 * - Identical declarations merge (same reference, or the same structure).
 * - New, non-colliding fields union, at any depth: two `z.object`s under one
 *   key merge field by field, so a block may add `features.search` to a
 *   flow's `features`.
 * - A field declared with a different type is refused, naming both declarers.
 * - A field declared with two different defaults is refused, naming both.
 * - One declarer giving a default and the other giving none is NOT a
 *   conflict: the default is taken. (The kitchen-sink's own `mode` field is
 *   declared both ways today.)
 * - `.nullable()` is part of the type; `.optional()` is not (optional only if
 *   every declarer says so).
 * - A transform/refine compares by its input structure only: two different
 *   refinements on the same base type merge (a POC simplification; real code
 *   would either compare by reference or refuse).
 */
import { z, type ZodTypeAny } from "zod";
import { getZodInnerType, getZodObjectShape, getZodTypeName } from "../../../../../packages/core/src/helpers/index";
import { deepEqual } from "../../../../../packages/core/src/helpers/deep-equal";

export type Scope = "session" | "user" | "org";
export const SCOPES: readonly Scope[] = ["session", "user", "org"];

/** One scope schema as some declarer stated it. */
export interface Declaration {
  scope: Scope;
  schema: ZodTypeAny;
  /** Who declared it, as an error names it: `block "x"`, `flow "y"`, `capability "c" (via block "x")`. */
  source: string;
}

export class ScopeSchemaConflict extends Error {
  constructor(
    readonly kind: "type" | "default",
    readonly path: string,
    readonly first: string,
    readonly second: string,
    detail: string
  ) {
    super(
      `${path} is declared incompatibly (${kind}): ${first} and ${second} ${detail}. ` +
        `Share one schema for the field, or make the declarations agree.`
    );
  }
}

/** A field in the merged tree: an object we can merge into, or a leaf compared by structure. */
type Node =
  | { kind: "object"; fields: Map<string, Node>; meta: Meta }
  | { kind: "leaf"; core: ZodTypeAny; sig: string; meta: Meta };

interface Meta {
  nullable: boolean;
  optional: boolean;
  def?: { value: unknown; source: string };
  /** First declarer, named on a type conflict. */
  source: string;
}

const PEEL = new Set(["ZodOptional", "ZodNullable", "ZodDefault", "ZodReadonly"]);

function declaredDefault(schema: ZodTypeAny): unknown {
  const v = (schema as { _def?: { defaultValue?: unknown } })._def?.defaultValue;
  return typeof v === "function" ? (v as () => unknown)() : v;
}

/** Parse one declared schema into a merge node: peel the wrappers, recurse into objects. */
export function toNode(schema: ZodTypeAny, source: string): Node {
  const meta: Meta = { nullable: false, optional: false, source };
  let s: ZodTypeAny = schema;
  for (let name = getZodTypeName(s) ?? ""; PEEL.has(name); name = getZodTypeName(s) ?? "") {
    if (name === "ZodOptional") meta.optional = true;
    if (name === "ZodNullable") meta.nullable = true;
    if (name === "ZodDefault" && meta.def === undefined) meta.def = { value: declaredDefault(s), source };
    s = getZodInnerType(s)!;
  }
  if (getZodTypeName(s) === "ZodObject") {
    const fields = new Map<string, Node>();
    for (const [k, v] of Object.entries(getZodObjectShape(s) ?? {})) fields.set(k, toNode(v, source));
    return { kind: "object", fields, meta };
  }
  return { kind: "leaf", core: s, sig: signature(s), meta };
}

const opaqueIds = new WeakMap<object, number>();
let nextOpaque = 0;

/** A structural fingerprint of a (non-mergeable) schema. Two leaves merge iff these match. */
export function signature(s: ZodTypeAny): string {
  const def = (s as { _def: any })._def;
  const name = getZodTypeName(s) ?? "?";
  switch (name) {
    case "ZodString": case "ZodNumber": case "ZodBoolean": case "ZodAny": case "ZodUnknown":
    case "ZodDate": case "ZodBigInt": case "ZodNull": case "ZodUndefined":
      return name.slice(3).toLowerCase();
    case "ZodEnum": return `enum(${[...def.values].sort().join("|")})`;
    case "ZodNativeEnum": return `native(${JSON.stringify(def.values)})`;
    case "ZodLiteral": return `lit(${JSON.stringify(def.value)})`;
    case "ZodArray": return `${signature(def.type)}[]`;
    case "ZodRecord": return `record<${signature(def.valueType)}>`;
    case "ZodTuple": return `[${def.items.map(signature).join(",")}]`;
    case "ZodObject": {
      const shape = getZodObjectShape(s) ?? {};
      return `{${Object.keys(shape).sort().map((k) => `${k}:${signature(shape[k]!)}`).join(",")}}`;
    }
    case "ZodOptional": return `${signature(def.innerType)}?`;
    case "ZodNullable": return `${signature(def.innerType)}|null`;
    case "ZodReadonly": return `readonly ${signature(def.innerType)}`;
    case "ZodDefault": return `${signature(def.innerType)}=${JSON.stringify(declaredDefault(s))}`;
    case "ZodUnion": case "ZodDiscriminatedUnion":
      return `(${[...(def.options instanceof Map ? def.options.values() : def.options)].map(signature).sort().join(" | ")})`;
    case "ZodEffects": return `effects(${signature(def.schema)})`;
    default: {
      if (!opaqueIds.has(s)) opaqueIds.set(s, nextOpaque++);
      return `opaque#${opaqueIds.get(s)}`;
    }
  }
}

function describeDefault(v: unknown): string {
  return JSON.stringify(v) ?? String(v);
}

/** Merge `b` into `a` at `path`, or throw a conflict naming both declarers. */
export function mergeNodes(a: Node, b: Node, path: string): Node {
  if (a.kind !== b.kind || (a.kind === "leaf" && b.kind === "leaf" && a.sig !== b.sig)) {
    const ta = a.kind === "leaf" ? a.sig : "object";
    const tb = b.kind === "leaf" ? b.sig : "object";
    throw new ScopeSchemaConflict("type", path, a.meta.source, b.meta.source, `type it as ${ta} and ${tb}`);
  }
  if (a.meta.nullable !== b.meta.nullable) {
    throw new ScopeSchemaConflict("type", path, a.meta.source, b.meta.source, "disagree on whether it is nullable");
  }
  if (a.meta.def !== undefined && b.meta.def !== undefined && !deepEqual(a.meta.def.value, b.meta.def.value)) {
    throw new ScopeSchemaConflict(
      "default", path, a.meta.def.source, b.meta.def.source,
      `default it to ${describeDefault(a.meta.def.value)} and ${describeDefault(b.meta.def.value)}`
    );
  }
  const meta: Meta = {
    nullable: a.meta.nullable,
    optional: a.meta.optional && b.meta.optional,
    def: a.meta.def ?? b.meta.def,
    source: a.meta.source
  };
  if (a.kind === "leaf") return { ...a, meta };
  const fields = new Map(a.fields);
  for (const [k, child] of (b as Extract<Node, { kind: "object" }>).fields) {
    const have = fields.get(k);
    fields.set(k, have === undefined ? child : mergeNodes(have, child, `${path}.${k}`));
  }
  return { kind: "object", fields, meta };
}

/** Rebuild a zod schema the fill can walk from a merged node. */
export function toSchema(node: Node): ZodTypeAny {
  let s: ZodTypeAny =
    node.kind === "leaf"
      ? node.core
      : z.object(Object.fromEntries([...node.fields].map(([k, v]) => [k, toSchema(v)])));
  if (node.meta.nullable) s = s.nullable();
  if (node.meta.def !== undefined) {
    const value = node.meta.def.value;
    s = s.default(() => structuredClone(value) as never);
  } else if (node.meta.optional) s = s.optional();
  return s;
}

/**
 * Fold declarations into one merged node per scope. Declarations are deduped
 * by schema reference first (one capability on ten blocks is one entry), so
 * the cost scales with distinct schemas, not with blocks.
 */
export function reconcile(
  decls: readonly Declaration[],
  start: Partial<Record<Scope, Node>> = {}
): Partial<Record<Scope, Node>> {
  const out: Partial<Record<Scope, Node>> = { ...start };
  const seen = new Set<ZodTypeAny>();
  for (const d of decls) {
    if (seen.has(d.schema)) continue;
    seen.add(d.schema);
    const node = toNode(d.schema, d.source);
    if (node.kind !== "object") {
      throw new Error(`${d.source}: a ${d.scope} state schema must be a z.object, got ${node.sig}`);
    }
    const have = out[d.scope];
    out[d.scope] = have === undefined ? node : mergeNodes(have, node, `${d.scope}.state`);
  }
  return out;
}

/** Whether a node, or anything under it, declares a default. */
export function nodeHasDefault(node: Node): boolean {
  if (node.meta.def !== undefined) return true;
  return node.kind === "object" && [...node.fields.values()].some(nodeHasDefault);
}

/** Top-level field names a merged node declares (for reporting). */
export function fieldNames(node: Node | undefined): string[] {
  return node?.kind === "object" ? [...node.fields.keys()] : [];
}

export type { Node as MergeNode };
