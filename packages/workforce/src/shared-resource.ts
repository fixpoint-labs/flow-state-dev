/**
 * Shared resources: what a worker writes for every member of its org to read,
 * each entry naming who wrote it.
 *
 * A shared resource is an org-scoped collection whose every entry carries a
 * required `writtenBy: { userId, workerId? }`. Required in the resource's own
 * schema, so an entry written without it is refused by the store's validation
 * however it was written. The worker contract checks that any `writtenBy` a
 * worker flow declares is this whole field, so a loose one can't register.
 *
 * {@link writeShared} stamps the field from the session, never from its input,
 * so whoever calls a flow can't sign as someone else. It is a helper, not a
 * gate: flow code that writes the resource directly can set any well-formed
 * value. So `writtenBy` is as trustworthy as the registered worker flow's own
 * code, and it is for display and audit only. Nothing in the framework reads it
 * to decide who may write an entry; that is the resource's scope and its
 * ownership rules.
 */
import { z } from "zod";
import { defineResourceCollection } from "@flow-state-dev/core";

/** The field every entry of a shared resource carries. */
export const WRITTEN_BY_KEY = "writtenBy";

/**
 * Who wrote one entry: the user, and the worker when one wrote it. Each a
 * non-empty string; nothing else is accepted.
 */
export const writtenBySchema = z
  .object({
    /** The user whose session wrote the entry. */
    userId: z.string().min(1),
    /** The worker that wrote it. Absent when a person wrote it through the app. */
    workerId: z.string().min(1).optional()
  })
  .strict();

/** Who wrote one entry of a shared resource. */
export type WrittenBy = z.infer<typeof writtenBySchema>;

/**
 * What {@link writtenBySchema} accepts and refuses, as values: the rule a
 * declared `writtenBy` is judged by. Kept beside the schema, and a test runs
 * the schema itself through {@link isSharedWrittenBy}, so the two can't drift.
 */
const WRITTEN_BY_SAMPLES: { readonly accepts: readonly unknown[]; readonly refuses: readonly unknown[] } = {
  accepts: [{ userId: "alice" }, { userId: "alice", workerId: "researcher" }],
  refuses: [
    undefined,
    null,
    {},
    "alice",
    { workerId: "researcher" },
    { userId: "" },
    { userId: 7 },
    { userId: "alice", workerId: 7 },
    { userId: "alice", workerId: "" }
  ]
};

/** Anything that parses values the way a zod schema does. */
export type SafeParser = { safeParse: (value: unknown) => { success: boolean; data?: unknown } };

/** The same attribution: the same keys, each the same value. */
function sameAttribution(parsed: unknown, sample: unknown): boolean {
  if (parsed === null || typeof parsed !== "object" || sample === null || typeof sample !== "object") return false;
  const a = parsed as Record<string, unknown>;
  const b = sample as Record<string, unknown>;
  const keys = Object.keys(b);
  return Object.keys(a).length === keys.length && keys.every((key) => Object.hasOwn(a, key) && a[key] === b[key]);
}

/**
 * Whether `field` takes `writtenBy` the way a shared resource does: it accepts
 * what {@link writtenBySchema} accepts, keeping each value as given, and
 * refuses what it refuses. Judged on values, so a field declared some other way
 * but behaving the same passes, and an optional, looser or rewriting one (a
 * transform that drops `workerId`) fails.
 *
 * @param field A resource's declared `writtenBy` schema.
 */
export function isSharedWrittenBy(field: SafeParser): boolean {
  return (
    WRITTEN_BY_SAMPLES.accepts.every((value) => {
      const parsed = field.safeParse(value);
      return parsed.success && sameAttribution(parsed.data, value);
    }) && WRITTEN_BY_SAMPLES.refuses.every((value) => !field.safeParse(value).success)
  );
}

type ZodDefLike = { typeName?: unknown; [key: string]: unknown };

/** The object shapes a schema stands for, through zod's wrappers and composites. */
function objectShapesOf(schema: unknown, seen: Set<unknown>): Record<string, unknown>[] {
  if (schema === null || typeof schema !== "object" || seen.has(schema)) return [];
  seen.add(schema);
  const shape = (schema as { shape?: unknown }).shape;
  if (shape !== null && typeof shape === "object") return [shape as Record<string, unknown>];
  const def = (schema as { _def?: ZodDefLike })._def;
  if (def === undefined) return [];
  const inner: unknown[] = [
    def.schema, // refine, superRefine, transform, preprocess
    def.innerType, // optional, nullable, default, catch, readonly
    def.in, // pipe
    def.out,
    def.left, // intersection
    def.right,
    ...(Array.isArray(def.options) ? def.options : []), // union, discriminated union
    def.typeName === "ZodBranded" ? def.type : undefined,
    def.typeName === "ZodLazy" && typeof def.getter === "function" ? (def.getter as () => unknown)() : undefined
  ];
  return inner.flatMap((member) => objectShapesOf(member, seen));
}

/**
 * Every `writtenBy` field a resource's schema declares, wherever zod's
 * wrappers put it: inside a `.refine()` or `.transform()`, either side of a
 * `.pipe()` or an intersection, any member of a union.
 *
 * @param stateSchema A resource's declared `stateSchema`.
 */
export function declaredWrittenByFields(stateSchema: unknown): SafeParser[] {
  return objectShapesOf(stateSchema, new Set())
    .filter((shape) => Object.hasOwn(shape, WRITTEN_BY_KEY))
    .map((shape) => shape[WRITTEN_BY_KEY] as SafeParser);
}

/**
 * Declare a shared resource: an org-scoped collection whose every entry names
 * who wrote it.
 *
 * ```ts
 * const notes = sharedResource("team-notes/*", { text: z.string() });
 * // in a block: resources: { notes }, then writeShared(ctx, "notes", key, { text })
 * ```
 *
 * @param pattern The collection's key pattern, as `defineResourceCollection` takes it.
 * @param shape The entry's own fields. `writtenBy` is added, required.
 */
export function sharedResource<T extends z.ZodRawShape>(pattern: string, shape: T) {
  return defineResourceCollection({
    pattern,
    scope: "org",
    stateSchema: z.object({ ...shape, [WRITTEN_BY_KEY]: writtenBySchema })
  });
}

/**
 * The slice of a block's context the helper reads. A block's own context
 * satisfies it.
 */
export type SharedWriteContext = {
  session: { identity: { userId?: string } };
  flow: { config: unknown };
  resources: Readonly<Record<string, unknown>>;
};

type WritableCollection = {
  create(key: string, initial: Record<string, unknown>, options?: { replace?: boolean }): Promise<unknown>;
};

/**
 * Write one entry of a shared resource, naming the session's user and, when a
 * worker is running, the worker.
 *
 * Creates the entry, or replaces it when the key is taken; the entry then
 * names whoever wrote it last. A `writtenBy` in `data` is ignored: the name
 * always comes from the session. The worker is the running worker's id, read
 * from the configuration its hire stamped (`seatId`); a flow that isn't a
 * worker's has none, and the entry names the user alone.
 *
 * @param ctx The block's context. Its block must declare `accessor`.
 * @param accessor The resource's accessor on the block, e.g. `"notes"`.
 * @param key The entry's key under the collection's pattern.
 * @param data The entry's own fields.
 * @throws When the session has no user, so nothing could be named, or the
 *   block declares no resource under `accessor`.
 */
export async function writeShared(
  ctx: SharedWriteContext,
  accessor: string,
  key: string,
  data: Record<string, unknown>
): Promise<void> {
  const userId = ctx.session.identity.userId;
  if (typeof userId !== "string" || userId.length === 0) {
    throw new Error(
      `writeShared can't write "${key}" to "${accessor}": the session has no user, so the entry ` +
        `could name nobody.`
    );
  }
  const collection = ctx.resources[accessor] as WritableCollection | undefined;
  if (collection === undefined || typeof collection.create !== "function") {
    throw new Error(
      `writeShared can't write to "${accessor}": this block declares no resource collection under ` +
        `that name. Add it to the block's \`resources\`.`
    );
  }
  const seatId = (ctx.flow.config as { seatId?: unknown } | undefined)?.seatId;
  const writtenBy: WrittenBy =
    typeof seatId === "string" && seatId.length > 0 ? { userId, workerId: seatId } : { userId };
  const entry: Record<string, unknown> = { ...data };
  delete entry[WRITTEN_BY_KEY];
  entry[WRITTEN_BY_KEY] = writtenBy;
  await collection.create(key, entry, { replace: true });
}
