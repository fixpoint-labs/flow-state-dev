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
