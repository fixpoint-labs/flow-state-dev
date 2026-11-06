/**
 * The merge of a scope's state declarations into the one schema its reads fill
 * defaults from and read its readonly fields off.
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
 *   plain `z.object`s under one key merge field by field.
 * - Every other field is a leaf, and a leaf is never rebuilt: the merged
 *   object holds one of the declared leaf schemas themselves, so its
 *   constraints, wrapper order, refinements and default factory are what an
 *   author wrote.
 * - Two declarations of a leaf agree when they are the same object, or when
 *   their fingerprints (`zodSchemaSignature`) match; the fingerprint reads only
 *   what it fully understands and compares everything else by identity.
 * - One declaration may add outer wrappers to the other (a `.default()`, an
 *   `.optional()`, a `.readonly()`): the more wrapped one is kept. Wrappers
 *   that differ any other way are refused, as is a different type under them.
 *   `.nullable()` is part of the type.
 * - Two static defaults must be equal. An author's default factory is never
 *   called: two declarations agree on one only when it is the same function.
 *
 * A refusal names the field's path and both declarers. Nothing is picked by
 * declaration order, so the value a block reads never depends on code it can't
 * see. The merged schema is for filling defaults and reading readonly fields
 * only: writes still validate against the schema each declarer gave.
 */
import { z, type ZodTypeAny } from "zod";
import { deepEqual } from "./deep-equal";
import {
  getZodDeclaredDefault,
  getZodInnerType,
  getZodObjectShape,
  getZodTypeName,
  isPlainZodObject,
  isZodObject,
  zodSchemaSignature,
  type ZodDeclaredDefault
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
  /** How they disagree, naming both: `block "a" defaults it to "plan" and block "b" to "ask"`. */
  readonly detail: string;

  constructor(
    owner: string,
    conflict: ScopeStateConflictKind,
    path: string,
    why: string,
    detail: string,
    remedy: string,
    first: string,
    second: string
  ) {
    super(`${owner}: ${path} is declared twice with ${why}: ${detail}. ${remedy}`);
    this.name = "ScopeStateSchemaConflictError";
    this.conflict = conflict;
    this.path = path;
    this.first = first;
    this.second = second;
    this.detail = detail;
  }
}

/**
 * `true` when `schema` is a state schema the merge can read: a `z.object`
 * under the root wrappers. Anything else can only be declared once per scope.
 */
export function isMergeableScopeStateSchema(schema: ZodTypeAny): boolean {
  return isZodObject(peel(schema, true).core);
}

type WrapperKind = "optional" | "nullable" | "readonly" | "default";
/** One wrapper as declared, outermost first in a chain. */
type Wrapper = { kind: WrapperKind; declared?: ZodDeclaredDefault };

const WRAPPER_KINDS: Record<string, WrapperKind> = {
  ZodOptional: "optional",
  ZodNullable: "nullable",
  ZodReadonly: "readonly",
  ZodDefault: "default"
};

/** A schema's outer wrappers, outermost first, and what they wrap. */
function peel(schema: ZodTypeAny, root: boolean): { chain: Wrapper[]; core: ZodTypeAny } {
  const chain: Wrapper[] = [];
  let core = schema;
  for (;;) {
    const name = getZodTypeName(core) ?? "";
    const kind = WRAPPER_KINDS[name];
    // A refinement over a whole state schema says nothing about one field, so
    // the root reads through it; a field's own refinement is part of its leaf.
    if (kind === undefined && !(root && name === "ZodEffects")) break;
    const inner = getZodInnerType(core);
    if (inner === undefined) break;
    if (kind !== undefined) {
      chain.push(kind === "default" ? { kind, declared: getZodDeclaredDefault(core) } : { kind });
    }
    core = inner;
  }
  return { chain, core };
}

/**
 * What a field's wrappers mean to a read, the order they were declared in
 * folded away. `.nullable()` is part of the type, so it is counted and
 * compared strictly; optional, readonly and a default are flags.
 *
 * `fill` is what a read of a missing value gets: the default when one is
 * reached before any `.optional()` (outermost first), `absent` when an
 * `.optional()` is reached first (it suppresses any default inside it), else
 * `required`.
 */
type Flags = {
  nullable: number;
  readonly: boolean;
  fill: { kind: "default"; declared: ZodDeclaredDefault } | { kind: "absent" } | { kind: "required" };
};

function flagsOf(chain: readonly Wrapper[]): Flags {
  let fill: Flags["fill"] | undefined;
  for (const wrapper of chain) {
    if (fill !== undefined) break;
    if (wrapper.kind === "optional") fill = { kind: "absent" };
    else if (wrapper.kind === "default") fill = { kind: "default", declared: wrapper.declared! };
  }
  return {
    nullable: chain.filter((w) => w.kind === "nullable").length,
    readonly: chain.some((w) => w.kind === "readonly"),
    fill: fill ?? { kind: "required" }
  };
}

type Common = { flags: Flags; source: string; declared: ZodTypeAny | undefined };
type ObjectNode = Common & { kind: "object"; fields: Map<string, MergeNode> };
type LeafNode = Common & { kind: "leaf"; core: ZodTypeAny; signature: string };
type MergeNode = ObjectNode | LeafNode;

/** Read one declared schema into a merge node. Only a plain `z.object` (any `z.object` at the root) is descended into. */
function toNode(schema: ZodTypeAny, source: string, root: boolean): MergeNode {
  const { chain, core } = peel(schema, root);
  const shape = root ? getZodObjectShape(core) : isPlainZodObject(core) ? getZodObjectShape(core) : undefined;
  if (shape !== undefined) {
    const fields = new Map<string, MergeNode>();
    for (const [key, field] of Object.entries(shape)) fields.set(key, toNode(field, source, false));
    return { kind: "object", fields, flags: flagsOf(chain), source, declared: schema };
  }
  return { kind: "leaf", core, signature: zodSchemaSignature(core), flags: flagsOf(chain), source, declared: schema };
}

function showDefault(declared: ZodDeclaredDefault | undefined): string {
  if (declared === undefined || declared.kind === "dynamic") return "a factory";
  return JSON.stringify(declared.value()) ?? String(declared.value());
}

/** How a refusal names a node's type: its core, then its wrappers inside out. */
function typeOf(node: MergeNode): string {
  const core =
    node.kind === "object"
      ? "object"
      : node.signature.startsWith("opaque#")
        ? `a ${(getZodTypeName(node.core) ?? "custom").replace(/^Zod/, "").toLowerCase()} schema that only matches itself`
        : node.signature;
  const { flags } = node;
  return (
    core +
    ".nullable()".repeat(flags.nullable) +
    (flags.fill.kind === "default" ? `.default(${showDefault(flags.fill.declared)})` : "") +
    (flags.fill.kind === "absent" ? ".optional()" : "") +
    (flags.readonly ? ".readonly()" : "")
  );
}

/** Whether `node`'s own wrappers already mean `flags` to a read, so it can be kept as declared. */
function covers(node: MergeNode, flags: Flags): boolean {
  const own = node.flags;
  return own.readonly === flags.readonly && own.fill.kind === flags.fill.kind;
}

/** Merge `b` into `a` at `path`, or throw a conflict naming both declarers. */
function mergeNodes(owner: string, a: MergeNode, b: MergeNode, path: string): MergeNode {
  if (a.declared !== undefined && a.declared === b.declared) return a;
  const typeConflict = () => {
    const opaque = [a, b].some((n) => n.kind === "leaf" && n.signature.startsWith("opaque#"));
    return new ScopeStateSchemaConflictError(
      owner, "type", path, "different types",
      `${a.source} types it as ${typeOf(a)} and ${b.source} as ${typeOf(b)}`,
      opaque
        ? "A schema that can't be compared by its structure agrees only with itself: share one schema for the field."
        : "Declare one type, or share one schema for the field.",
      a.source, b.source
    );
  };
  if (a.kind !== b.kind) throw typeConflict();
  if (a.kind === "leaf" && a.signature !== (b as LeafNode).signature) throw typeConflict();
  if (a.flags.nullable !== b.flags.nullable) throw typeConflict();

  // Two defaults that would fill must agree; a default on one side only is taken.
  const left = a.flags.fill;
  const right = b.flags.fill;
  if (left.kind === "default" && right.kind === "default") {
    const l = left.declared;
    const r = right.declared;
    if (l.kind === "static" && r.kind === "static") {
      if (!deepEqual(l.value(), r.value())) {
        throw new ScopeStateSchemaConflictError(
          owner, "default", path, "different defaults",
          `${a.source} defaults it to ${showDefault(l)} and ${b.source} to ${showDefault(r)}`,
          "Declare one default, or share one schema for the field.",
          a.source, b.source
        );
      }
    } else if (l.factory !== r.factory) {
      throw new ScopeStateSchemaConflictError(
        owner, "default", path, "a dynamic default",
        `${a.source} and ${b.source} each declare a default factory (or one a factory and one a value), and a factory can't be compared`,
        "Share one schema for the field.",
        a.source, b.source
      );
    }
  }
  const flags: Flags = {
    nullable: a.flags.nullable,
    readonly: a.flags.readonly || b.flags.readonly,
    fill:
      left.kind === "default" ? left
      : right.kind === "default" ? right
      : left.kind === "absent" || right.kind === "absent" ? { kind: "absent" }
      : { kind: "required" }
  };

  if (a.kind === "leaf") {
    // Keep a declared leaf that already means the merged flags; rebuild the
    // wrappers around the first declarer's own core only when neither does.
    if (covers(a, flags)) return a;
    if (covers(b, flags)) return b;
    return { ...a, flags, declared: undefined };
  }
  const fields = new Map(a.fields);
  for (const [key, child] of (b as ObjectNode).fields) {
    const have = fields.get(key);
    fields.set(key, have === undefined ? child : mergeNodes(owner, have, child, `${path}.${key}`));
  }
  return { kind: "object", fields, flags, source: a.source, declared: undefined };
}

/** The schema a merged node stands for: the declared one when nothing was merged into it. */
function toSchema(node: MergeNode): ZodTypeAny {
  if (node.declared !== undefined) return node.declared;
  // An object is rebuilt from its fields; a leaf keeps its own core schema
  // object, so its constraints and identity survive. Either way the wrappers
  // are put back from the merged flags, a default with its declared factory.
  let schema: ZodTypeAny =
    node.kind === "leaf"
      ? node.core
      : z.object(Object.fromEntries([...node.fields].map(([key, child]) => [key, toSchema(child)])));
  for (let i = 0; i < node.flags.nullable; i++) schema = schema.nullable();
  if (node.flags.fill.kind === "default") schema = schema.default(node.flags.fill.declared.factory as never);
  else if (node.flags.fill.kind === "absent") schema = schema.optional();
  if (node.flags.readonly) schema = schema.readonly();
  return schema;
}

/**
 * Merge every declaration of one scope's state into one schema, or throw
 * {@link ScopeStateSchemaConflictError} on the first two that disagree.
 *
 * Returns `undefined` when nothing declares the scope, and the declared schema
 * itself when one schema does, so a flow whose blocks add nothing reads exactly
 * what it declared. Never calls an author's default factory.
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
    if (!isMergeableScopeStateSchema(schema)) {
      throw new Error(
        `${owner}: ${source} declares a ${scope} state schema that is not a z.object, ` +
          `so it can't be merged with the other declarations of ${scope} state. Declare it as z.object({ ... }).`
      );
    }
    const node = toNode(schema, source, true);
    merged = merged === undefined ? node : mergeNodes(owner, merged, node, `${scope}.state`);
  }
  return toSchema(merged!);
}
