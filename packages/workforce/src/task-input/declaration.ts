// FIX-2894; epic FIX-2876 ER-9.
/**
 * What a worker flow's tasks take: the declaration a flow's `work` entry
 * carries (`workerTaskEntry({ input: taskInput(schema, { ... }) })`), read by
 * the board at every write that puts input on a task, by the `work` entry at
 * the claim, and by `listDelegates`.
 *
 * - **The schema** is what the worker block is handed, parsed. It must parse
 *   the same after the JSON round trip a stored row takes, so anything that
 *   can break that is refused here, when the flow is built
 *   ({@link assertJsonStable}). That is an early refusal only: every write
 *   checks the round trip on the value it stores (`./filing-check`).
 * - **`serverOwned`** names fields only the server writes. A filer's value is
 *   dropped and the flow's `fill` writes it. A name may lie outside the
 *   schema: such a name is only dropped.
 * - **The hooks** (`refuse`, `fill`, `check`, `stored`) are the flow's; the
 *   board calls them and reads no field they name.
 * - **The filer's view** ({@link TaskInputDeclaration.filerSchema}) is the
 *   schema as JSON Schema draft-07, fully inlined, less the server-owned
 *   fields: what `listDelegates` shows a model.
 * - **The fingerprint** names the declaration (its JSON Schema, its
 *   server-owned names and its project requirement), for the `filledFor`
 *   stamp a filed row carries.
 */
import type { BlockContext } from "@flow-state-dev/core/types";
import { inlinedJsonSchema } from "@flow-state-dev/core/internal";
import { z, type ZodTypeAny } from "zod";
import { taskInputOf } from "../worker-task-entry";

/** The worker a task is for, as the hooks are handed it: its id, and its configuration as declared (its row's settings, or its file's front matter). */
export interface TaskInputWorker {
  readonly id: string;
  readonly config: Readonly<Record<string, unknown>>;
}

/** What `refuse` and `check` are handed beside the input. */
export interface TaskInputCheckContext {
  /** The request's context: the filing request's. */
  readonly ctx: BlockContext;
  /** The worker the task is for. */
  readonly assignee: string;
  /** That worker, read now. */
  readonly worker: TaskInputWorker;
  /** The flow it runs on. */
  readonly flow: string;
}

/** What `fill` is handed. */
export interface TaskInputFillContext extends TaskInputCheckContext {
  /**
   * When it runs: `"filing"` on a write that files the task for this flow (a
   * filing, a move onto the flow, or an edit of a row its stamp doesn't
   * match), or `"claim"` when a claim finds the row was filled under another
   * declaration or flow. A claim has no filing turn: read nothing a later
   * turn can change.
   */
  readonly at: "filing" | "claim";
}

/** A task's input as stored or sent: a plain object. */
export type TaskInputRecord = Record<string, unknown>;

/** The options of {@link taskInput}. */
export interface TaskInputOptions<T extends TaskInputRecord> {
  /** The fields only the server writes: a filer's value is dropped, and `fill` writes them. */
  readonly serverOwned?: readonly string[];
  /** The server-owned values for this task. Anything else it returns is ignored. */
  readonly fill?: (context: TaskInputFillContext) => TaskInputRecord | Promise<TaskInputRecord>;
  /**
   * Refuse by what the filer sent, before anything is dropped: throw a
   * `TaskWriteRefusedError`. Runs on every filing and edit.
   */
  readonly refuse?: (sent: TaskInputRecord, context: TaskInputCheckContext) => void | Promise<void>;
  /**
   * A rule the schema can't say: given the parsed input, return the input to
   * store, or throw a `TaskWriteRefusedError`. It may change a filer's field,
   * never a server-owned one. Runs on every filing and edit, never at claim.
   * A rule only this enforces belongs in the field's `.describe()` text too,
   * so a model reads it in `listDelegates` before it is refused.
   */
  readonly check?: (input: T, context: TaskInputCheckContext) => T | Promise<T>;
  /**
   * Read a stored row in a shape the flow no longer files: its old shape
   * mapped to the current one. Runs only on stored rows: at claim,
   * and when an edit reads the values it keeps. A write never goes through it.
   */
  readonly stored?: (raw: TaskInputRecord) => TaskInputRecord;
  /**
   * `"required"`: a task for the flow filed with no project to work in is
   * refused `no_project`. Omitted, `"optional"`.
   */
  readonly project?: "required" | "optional";
}

const DECLARATION = Symbol.for("@flow-state-dev/workforce/task-input");

/** A flow's task-input declaration: built by {@link taskInput}. */
export interface TaskInputDeclaration<T extends TaskInputRecord = TaskInputRecord> {
  readonly [DECLARATION]: true;
  /** The schema the worker block is handed the input parsed by. */
  readonly schema: z.ZodType<T, z.ZodTypeDef, unknown>;
  readonly serverOwned: readonly string[];
  readonly fill: TaskInputOptions<T>["fill"];
  readonly refuse: TaskInputOptions<T>["refuse"];
  readonly check: TaskInputOptions<T>["check"];
  readonly stored: TaskInputOptions<T>["stored"];
  readonly project: "required" | "optional";
  /** What a filer may write, as JSON Schema draft-07, fully inlined: the schema less its server-owned fields. */
  readonly filerSchema: Readonly<Record<string, unknown>>;
  /** Names this declaration: its JSON Schema, server-owned names and project requirement. */
  readonly fingerprint: string;
  /** The first step in the schema that can break the JSON round trip, which `workerTaskEntry` refuses; absent when none. */
  readonly unstable?: { readonly step: string; readonly path: string };
}

/** The declaration a worker flow's `work` entry carries, or `undefined` for a flow that declares none. */
export function declarationOfFlow(flow: unknown): TaskInputDeclaration | undefined {
  const declared = taskInputOf(flow);
  return isTaskInputDeclaration(declared) ? declared : undefined;
}

/** Whether `value` is a declaration {@link taskInput} built. */
export function isTaskInputDeclaration(value: unknown): value is TaskInputDeclaration {
  return typeof value === "object" && value !== null && (value as Record<symbol, unknown>)[DECLARATION] === true;
}

/**
 * Declare what a worker flow's tasks take, for its `work` entry:
 * `workerTaskEntry({ name, turn, input: taskInput(schema, { ... }) })`.
 *
 * @param schema An object schema whose parse survives a JSON round trip. One
 *   that uses a step that can break it (`.transform`, `.preprocess`, `.pipe`,
 *   `.catch`, `z.coerce.*`, `z.date`, `z.bigint`, `z.map`, `z.set`) is
 *   refused by `workerTaskEntry`, which names its entry, the step and where.
 */
export function taskInput<T extends TaskInputRecord>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  options: TaskInputOptions<T> = {}
): TaskInputDeclaration<T> {
  const unstable = jsonUnstableStep(schema as ZodTypeAny);
  const serverOwned = Object.freeze([...new Set(options.serverOwned ?? [])]);
  const project = options.project ?? "optional";
  const full = inlinedJsonSchema(schema as ZodTypeAny);
  return Object.freeze({
    [DECLARATION]: true as const,
    schema,
    serverOwned,
    fill: options.fill,
    refuse: options.refuse,
    check: options.check,
    stored: options.stored,
    project,
    filerSchema: Object.freeze(withoutFields(full, serverOwned)),
    fingerprint: fingerprintOf(JSON.stringify({ schema: full, serverOwned: [...serverOwned].sort(), project })),
    ...(unstable === undefined ? {} : { unstable })
  });
}

/** The refusal's text, after the entry's name. */
export function unstableMessage(step: string, path: string): string {
  const hint = step === "z.date" ? " Use an ISO string: z.string().datetime()." : "";
  return (
    `a task input may not use ${step}${path.length > 0 ? ` (at "${path}")` : ""}. It is stored as JSON and parsed again at claim, ` +
    `so it must parse the same after a JSON round trip.${hint}`
  );
}

/** `schema` as JSON Schema with the top-level `fields` left out of its properties and required list. */
function withoutFields(schema: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  if (fields.length === 0) return schema;
  const out: Record<string, unknown> = { ...schema };
  const properties = schema.properties as Record<string, unknown> | undefined;
  if (properties !== undefined) out.properties = Object.fromEntries(Object.entries(properties).filter(([name]) => !fields.includes(name)));
  const required = schema.required as string[] | undefined;
  if (required !== undefined) {
    const kept = required.filter((name) => !fields.includes(name));
    if (kept.length > 0) out.required = kept;
    else delete out.required;
  }
  return out;
}

/** A short, stable hash of `text` (cyrb53): names a declaration, guards nothing. */
function fingerprintOf(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}

/** The steps whose parse can differ once the value has been through JSON. */
const BANNED: Partial<Record<string, string>> = {
  ZodDate: "z.date",
  ZodBigInt: "z.bigint",
  ZodMap: "z.map",
  ZodSet: "z.set",
  ZodPipeline: ".pipe",
  ZodCatch: ".catch",
  ZodPromise: "z.promise",
  ZodFunction: "z.function",
  ZodSymbol: "z.symbol"
};

/**
 * The first step in `schema` that can break `parse(JSON(parse(x))) = parse(x)`,
 * with the path it is at (dot-joined, `[]` for an array's items), or none.
 * `.refine`, `.default` and `.describe` keep the invariant.
 */
function jsonUnstableStep(schema: ZodTypeAny, path: string[] = [], seen = new Set<ZodTypeAny>()): { step: string; path: string } | undefined {
  if (seen.has(schema)) return undefined;
  seen.add(schema);
  const def = schema._def as { typeName?: string; coerce?: boolean; [key: string]: unknown };
  const at = () => path.join(".");
  const typeName = def.typeName ?? "";
  const banned = BANNED[typeName];
  if (banned !== undefined) return { step: banned, path: at() };
  if (def.coerce === true) return { step: `z.coerce.${typeName.replace(/^Zod/, "").toLowerCase()}`, path: at() };
  const walk = (inner: unknown, more: string[] = []) => jsonUnstableStep(inner as ZodTypeAny, [...path, ...more], seen);
  switch (typeName) {
    case "ZodEffects": {
      const effect = (def.effect as { type?: string } | undefined)?.type;
      if (effect === "transform") return { step: ".transform", path: at() };
      if (effect === "preprocess") return { step: ".preprocess", path: at() };
      return walk(def.schema);
    }
    case "ZodObject": {
      const shape = (schema as z.AnyZodObject).shape as Record<string, ZodTypeAny>;
      for (const [key, inner] of Object.entries(shape)) {
        const found = walk(inner, [key]);
        if (found !== undefined) return found;
      }
      return def.catchall === undefined ? undefined : walk(def.catchall);
    }
    case "ZodArray":
      return walk(def.type, ["[]"]);
    case "ZodRecord":
      return walk(def.valueType, ["*"]);
    case "ZodTuple": {
      for (const [i, inner] of ((def.items as ZodTypeAny[] | undefined) ?? []).entries()) {
        const found = walk(inner, [String(i)]);
        if (found !== undefined) return found;
      }
      return def.rest == null ? undefined : walk(def.rest, ["[]"]);
    }
    case "ZodUnion":
    case "ZodDiscriminatedUnion": {
      const options = def.options as ZodTypeAny[] | Map<unknown, ZodTypeAny>;
      for (const inner of options instanceof Map ? options.values() : options) {
        const found = walk(inner);
        if (found !== undefined) return found;
      }
      return undefined;
    }
    case "ZodIntersection":
      return walk(def.left) ?? walk(def.right);
    case "ZodOptional":
    case "ZodNullable":
    case "ZodDefault":
    case "ZodReadonly":
      return walk(def.innerType);
    case "ZodBranded":
      return walk(def.type);
    case "ZodLazy":
      return walk((def.getter as () => ZodTypeAny)());
    default:
      return undefined;
  }
}
