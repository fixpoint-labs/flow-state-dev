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
  dynamicDefaultFactories,
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

/**
 * Refuse a default factory whose value would not be stored, so that reading
 * the same stored record always gives the same value.
 *
 * A factory default (`() => crypto.randomUUID()`, a counter) is stored only
 * when a session is born, by parsing the flow's own session schema. So it is
 * allowed only there: in session scope, on a field whose own declaration on
 * the flow carries that same factory (a block or capability may restate it,
 * compared by identity). Everywhere else the fill would run the factory on
 * every read of a record that lacks the field and give a new value each
 * time, so these are refused:
 *
 * - a factory on a field only a block or a capability declares;
 * - a session factory where the flow declares the field without it;
 * - any factory in user or org scope, the flow's own included: those records
 *   are stored as written, never parsed at creation.
 *
 * Static defaults are allowed everywhere: they are the same on every read.
 * No factory is called.
 *
 * @param declarations Every declaration of the scope, the flow's own included.
 * @throws Error naming the field path, the declarer and a fix that holds there.
 */
export function refuseUnstoredFactoryDefaults(
  owner: string,
  scope: string,
  flowOwn: ZodTypeAny | undefined,
  declarations: readonly ScopeStateDeclaration[]
): void {
  const shapeOf = (schema: ZodTypeAny | undefined, root: boolean): Record<string, ZodTypeAny> | undefined => {
    if (schema === undefined) return undefined;
    const core = peel(schema, root).core;
    return root || isPlainZodObject(core) ? getZodObjectShape(core) : undefined;
  };
  /** The factories on an object's own wrappers (its `.default(() => ...)`), not its fields'. */
  const ownFactories = (schema: ZodTypeAny, root: boolean): Set<() => unknown> =>
    new Set(
      peel(schema, root)
        .chain.map((w) => w.declared)
        .filter((d): d is Extract<ZodDeclaredDefault, { kind: "dynamic" }> => d?.kind === "dynamic")
        .map((d) => d.factory)
    );
  const subset = (a: Set<() => unknown>, b: Set<() => unknown>) => [...a].every((f) => b.has(f));
  const base = `${scope}.state`;

  if (scope !== "session") {
    // User and org: no factory anywhere.
    const find = (schema: ZodTypeAny, path: string, root: boolean): string | undefined => {
      const shape = shapeOf(schema, root);
      if (shape === undefined) return dynamicDefaultFactories(schema).size > 0 ? path : undefined;
      if (ownFactories(schema, root).size > 0) return path;
      for (const [key, field] of Object.entries(shape)) {
        const at = find(field, `${path}.${key}`, false);
        if (at !== undefined) return at;
      }
      return undefined;
    };
    for (const declaration of declarations) {
      const at = find(declaration.schema, base, true);
      if (at === undefined) continue;
      throw new Error(
        `${owner}: ${at} has a default factory declared by ${declaration.source}. A ${scope} record is ` +
          `stored as written and its defaults are filled on every read, so a factory would give a new value ` +
          `on every read of the same record. Use a static default, or set the value when you write the record.`
      );
    }
    return;
  }

  const refuse = (at: string, source: string, flowDeclares: boolean): never => {
    throw new Error(
      flowDeclares
        ? `${owner}: ${at} has a default factory declared by ${source}, and the flow declares the field ` +
            `without it. Only the flow's own declaration is stored when a session is born, so this factory ` +
            `would run on every read of a record that lacks the field and give a new value each time. Give ` +
            `the flow's declaration the same factory (share one schema), or use a static default.`
        : `${owner}: ${at} has a default factory declared by ${source}, and the flow doesn't declare the ` +
            `field. A field only a block or a capability declares is filled when it is read and never stored, ` +
            `so its factory would give a new value on every read of the same record. To keep it, declare the ` +
            `field on the flow's session stateSchema with the same factory (share one schema), or give it a ` +
            `static default.`
    );
  };
  const walk = (own: ZodTypeAny | undefined, declared: ZodTypeAny, path: string, root: boolean, source: string): void => {
    const declaredShape = shapeOf(declared, root);
    if (declaredShape === undefined) return;
    const ownShape = shapeOf(own, root) ?? {};
    for (const [key, field] of Object.entries(declaredShape)) {
      const ownField = ownShape[key];
      const at = `${path}.${key}`;
      if (ownField === undefined) {
        if (dynamicDefaultFactories(field).size > 0) refuse(at, source, false);
        continue;
      }
      const bothObjects = shapeOf(field, false) !== undefined && shapeOf(ownField, false) !== undefined;
      if (bothObjects) {
        if (!subset(ownFactories(field, false), ownFactories(ownField, false))) refuse(at, source, true);
        walk(ownField, field, at, false, source);
      } else if (!subset(dynamicDefaultFactories(field), dynamicDefaultFactories(ownField))) {
        refuse(at, source, true);
      }
    }
  };
  for (const declaration of declarations) {
    if (declaration.schema === flowOwn) continue;
    walk(flowOwn, declaration.schema, base, true, declaration.source);
  }
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
  const value = declared.value();
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    // A bigint, or a value with a cycle: named without its contents.
    return typeof value === "bigint" ? `${value}n` : "a value that can't be printed";
  }
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

/**
 * `node` as a field one side of a merged object leaves out: a value written
 * by the other side's blocks may lack it, so with no default of its own it
 * is optional here. Required, it would make the object fail its parse, and
 * the object's own default stop filling.
 */
function leftOutBySomeDeclarer(node: MergeNode): MergeNode {
  if (node.flags.fill.kind !== "required") return node;
  return { ...node, flags: { ...node.flags, fill: { kind: "absent" } }, declared: undefined };
}

/** `deepEqual`, or `undefined` when it can't compare the two (it throws on a `Map`, a class instance, deep nesting). */
function comparable(left: unknown, right: unknown): boolean | undefined {
  try {
    return deepEqual(left, right);
  } catch {
    return undefined;
  }
}

/** Merge `b` into `a` at `path`, or throw a conflict naming both declarers. */
function mergeNodes(owner: string, a: MergeNode, b: MergeNode, path: string, root = false): MergeNode {
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
    if (l.kind === "static" && r.kind === "static" && l.factory !== r.factory) {
      const equal = comparable(l.value(), r.value());
      if (equal === undefined) {
        throw new ScopeStateSchemaConflictError(
          owner, "default", path, "a default that can't be compared",
          `${a.source} and ${b.source} each declare a default this check can't compare (a Map, a Set, a class instance, a deeply nested value)`,
          "Share one schema for the field.",
          a.source, b.source
        );
      }
      if (!equal) {
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
  // A top-level field is filled on its own, so only a nested object's
  // one-sided fields need loosening.
  const bFields = (b as ObjectNode).fields;
  const fields = new Map<string, MergeNode>();
  for (const [key, child] of a.fields) {
    const other = bFields.get(key);
    fields.set(
      key,
      other !== undefined ? mergeNodes(owner, child, other, `${path}.${key}`) : root ? child : leftOutBySomeDeclarer(child)
    );
  }
  for (const [key, child] of bFields) {
    if (!a.fields.has(key)) fields.set(key, root ? child : leftOutBySomeDeclarer(child));
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
    merged = merged === undefined ? node : mergeNodes(owner, merged, node, `${scope}.state`, true);
  }
  return toSchema(merged!);
}
