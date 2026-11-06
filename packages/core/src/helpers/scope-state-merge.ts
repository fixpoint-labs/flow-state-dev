/**
 * The merge of a scope's state declarations into the one schema its reads fill
 * defaults from.
 *
 * A flow, each block it reaches and each capability those blocks use can
 * declare a `session`, `user` or `org` state schema. `defineFlow` hands every
 * declaration of one scope to {@link mergeScopeStateSchemas}, and the engine
 * fills a stored record's missing defaults from the result. The engine's
 * cross-flow check reads the same merge over two flows' user and org schemas.
 *
 * The rules, one for every caller:
 *
 * - The same schema object declared twice is one declaration.
 * - Fields that only one declaration names are unioned in, at any depth: two
 *   `z.object`s under one key merge field by field.
 * - A field two declarations type differently is refused. `.nullable()` is part
 *   of the type; `.optional()` and `.readonly()` are not.
 * - A field two declarations default to different values is refused. A default
 *   on one side and none on the other is not a conflict: the default is taken.
 * - A field whose schema this merge can't read (a refinement, a transform, a
 *   lazy, an intersection) agrees with another only when it is the same object.
 *
 * A refusal names the field's path and both declarers. Nothing is picked by
 * declaration order, so the value a block reads never depends on code it can't
 * see. The merged schema is for filling defaults only: writes still validate
 * against the schema each declarer gave.
 */
import { z, type ZodTypeAny } from "zod";
import { deepEqual } from "./deep-equal";
import {
  getZodDefaultFactory,
  getZodInnerType,
  getZodObjectShape,
  getZodTypeName,
  zodSchemaSignature
} from "./zod-introspect";

/** One scope state schema, as one declarer stated it. */
export type ScopeStateDeclaration = {
  readonly schema: ZodTypeAny;
  /** Who declared it, as a refusal names it: `flow "x"`, `block "y"`, `capability "c" (used by block "y")`. */
  readonly source: string;
};

/** What kind of disagreement refused a merge. */
export type ScopeStateConflictKind = "type" | "default";

/**
 * Two declarations of one scope-state field that disagree. Thrown by
 * {@link mergeScopeStateSchemas}; the fields let a caller restate it in its own
 * terms (the engine's cross-flow check does).
 */
export class ScopeStateSchemaConflictError extends Error {
  readonly conflict: ScopeStateConflictKind;
  /** The field, from the scope: `session.state.mode`. */
  readonly path: string;
  /** The declarer met first. */
  readonly first: string;
  /** The declarer that disagrees with it. */
  readonly second: string;
  /** How they disagree, as the message words it: `defaults it to "plan" and block "b" to "ask"`. */
  readonly detail: string;

  constructor(
    owner: string,
    conflict: ScopeStateConflictKind,
    path: string,
    first: string,
    second: string,
    firstValue: string,
    secondValue: string
  ) {
    const detail =
      conflict === "default"
        ? `${first} defaults it to ${firstValue} and ${second} to ${secondValue}`
        : `${first} types it as ${firstValue} and ${second} as ${secondValue}`;
    const remedy =
      conflict === "default"
        ? "Declare one default, or share one schema for the field."
        : "Declare one type, or share one schema for the field.";
    super(
      `${owner}: ${path} is declared twice with different ${conflict === "default" ? "defaults" : "types"}: ` +
        `${detail}. ${remedy}`
    );
    this.name = "ScopeStateSchemaConflictError";
    this.conflict = conflict;
    this.path = path;
    this.first = first;
    this.second = second;
    this.detail = detail;
  }
}

type Meta = {
  nullable: boolean;
  optional: boolean;
  /** The first declared default met, with who declared it. */
  def?: { factory: () => unknown; source: string };
  /** The declarer that first stated this field. */
  source: string;
  /** The schema as declared, while no second declaration has been merged into it. */
  declared: ZodTypeAny | undefined;
};

type ObjectNode = { kind: "object"; fields: Map<string, MergeNode>; meta: Meta };
type LeafNode = { kind: "leaf"; core: ZodTypeAny; signature: string; meta: Meta };
type MergeNode = ObjectNode | LeafNode;

const PEELED = new Set(["ZodOptional", "ZodNullable", "ZodDefault", "ZodReadonly"]);

/** Read one declared schema into a merge node: peel the wrappers, descend into objects. */
function toNode(schema: ZodTypeAny, source: string, root: boolean): MergeNode {
  const meta: Meta = { nullable: false, optional: false, source, declared: schema };
  let current = schema;
  for (;;) {
    const name = getZodTypeName(current) ?? "";
    // A refinement over a whole state schema says nothing about one field's
    // default, so the root reads through it; a field's own refinement is a leaf.
    const peel = PEELED.has(name) || (root && name === "ZodEffects");
    const inner = peel ? getZodInnerType(current) : undefined;
    if (inner === undefined) break;
    if (name === "ZodOptional") meta.optional = true;
    if (name === "ZodNullable") meta.nullable = true;
    if (name === "ZodDefault" && meta.def === undefined) {
      meta.def = { factory: getZodDefaultFactory(current)!, source };
    }
    current = inner;
  }
  const shape = getZodObjectShape(current);
  if (shape !== undefined) {
    const fields = new Map<string, MergeNode>();
    for (const [key, field] of Object.entries(shape)) fields.set(key, toNode(field, source, false));
    return { kind: "object", fields, meta };
  }
  return { kind: "leaf", core: current, signature: zodSchemaSignature(current), meta };
}

function typeOf(node: MergeNode): string {
  const base = node.kind === "leaf" ? node.signature : "object";
  return node.meta.nullable ? `${base} | null` : base;
}

function show(value: unknown): string {
  return JSON.stringify(value) ?? String(value);
}

/** Merge `b` into `a` at `path`, or throw a conflict naming both declarers. */
function mergeNodes(owner: string, a: MergeNode, b: MergeNode, path: string): MergeNode {
  if (a.meta.declared !== undefined && a.meta.declared === b.meta.declared) return a;
  const sameKind =
    a.kind === b.kind && (a.kind !== "leaf" || a.signature === (b as LeafNode).signature);
  if (!sameKind || a.meta.nullable !== b.meta.nullable) {
    throw new ScopeStateSchemaConflictError(owner, "type", path, a.meta.source, b.meta.source, typeOf(a), typeOf(b));
  }
  if (a.meta.def !== undefined && b.meta.def !== undefined) {
    const left = a.meta.def.factory();
    const right = b.meta.def.factory();
    if (!deepEqual(left, right)) {
      throw new ScopeStateSchemaConflictError(
        owner, "default", path, a.meta.def.source, b.meta.def.source, show(left), show(right)
      );
    }
  }
  const meta: Meta = {
    nullable: a.meta.nullable,
    // Either declarer's blocks may have written the record, so a field one of
    // them may leave out can be absent: optional when either says so.
    optional: a.meta.optional || b.meta.optional,
    def: a.meta.def ?? b.meta.def,
    source: a.meta.source,
    declared: undefined
  };
  if (a.kind === "leaf") return { ...a, meta };
  const fields = new Map(a.fields);
  for (const [key, child] of (b as ObjectNode).fields) {
    const have = fields.get(key);
    fields.set(key, have === undefined ? child : mergeNodes(owner, have, child, `${path}.${key}`));
  }
  return { kind: "object", fields, meta };
}

/** The schema a merged node stands for: the declared one when nothing was merged into it. */
function toSchema(node: MergeNode): ZodTypeAny {
  if (node.meta.declared !== undefined) return node.meta.declared;
  let schema: ZodTypeAny =
    node.kind === "leaf"
      ? node.core
      : z.object(Object.fromEntries([...node.fields].map(([key, child]) => [key, toSchema(child)])));
  if (node.meta.nullable) schema = schema.nullable();
  if (node.meta.def !== undefined) schema = schema.default(node.meta.def.factory as never);
  else if (node.meta.optional) schema = schema.optional();
  return schema;
}

/**
 * Merge every declaration of one scope's state into one schema, or throw
 * {@link ScopeStateSchemaConflictError} on the first two that disagree.
 *
 * Returns `undefined` when nothing declares the scope, and the declared schema
 * itself when one schema does, so a flow whose blocks add nothing reads exactly
 * what it declared.
 *
 * @param owner Who the merge is for, as a refusal opens: `Flow "my-app"`.
 * @param scope The scope, as a field path starts: `session`.
 * @param declarations Every declaration, in the order a refusal names them.
 */
export function mergeScopeStateSchemas(
  owner: string,
  scope: string,
  declarations: readonly ScopeStateDeclaration[]
): ZodTypeAny | undefined {
  const distinct: ScopeStateDeclaration[] = [];
  const seen = new Set<ZodTypeAny>();
  for (const declaration of declarations) {
    if (seen.has(declaration.schema)) continue;
    seen.add(declaration.schema);
    distinct.push(declaration);
  }
  if (distinct.length <= 1) return distinct[0]?.schema;

  let merged: MergeNode | undefined;
  for (const { schema, source } of distinct) {
    const node = toNode(schema, source, true);
    if (node.kind !== "object") {
      throw new Error(
        `${owner}: ${source} declares a ${scope} state schema that is not a z.object (${node.signature}), ` +
          `so it can't be merged with the other declarations of ${scope} state. Declare it as z.object({ ... }).`
      );
    }
    merged = merged === undefined ? node : mergeNodes(owner, merged, node, `${scope}.state`);
  }
  return toSchema(merged!);
}
