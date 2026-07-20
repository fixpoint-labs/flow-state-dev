/**
 * Resolve the active pattern skill's live TaskCollection.
 *
 * The `taskTools` capability and any other runtime surface that needs
 * to mutate the current pattern's task board calls this helper. It
 * walks `ctx.session.state.activeSkills` in reverse, finds the most
 * recently pushed `mode: "pattern"` entry, and rebuilds the substrate's
 * TaskCollectionRef via `getOrCreateTaskCollection`.
 *
 * Returns `undefined` when no pattern is active so callers can surface
 * a structured error rather than throwing — agents should be able to
 * recover gracefully from misuse.
 *
 * Resolution is async: `getOrCreateTaskCollection` awaits one
 * `collection.list()` to hydrate its sync task mirror (FIX-700), so this
 * helper and its callers must `await` the result.
 */

import type {
  JsonObject,
  ResourceCollectionRef,
} from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import {
  getOrCreateTaskCollection,
  type TaskCollectionRef,
} from "../tasks";
import { readActiveSkills, type ActivePatternMeta } from "./active-skill-state";
import { getCollection } from "./internal/get-collection";

/**
 * Look up the active pattern's TaskCollection from a block context.
 * Returns `undefined` when no `mode: "pattern"` entry is active or
 * the resource backing for a session-scoped collection isn't wired.
 */
export async function getActivePatternCollection(
  ctx: BlockContext,
): Promise<TaskCollectionRef | undefined> {
  const meta = getActivePatternMeta(ctx);
  if (!meta) return undefined;
  return resolveCollection(ctx, meta);
}

/** Find the most recent active pattern metadata, if any. */
export function getActivePatternMeta(ctx: BlockContext): ActivePatternMeta | undefined {
  const session = (ctx as { session?: { state?: unknown } }).session;
  const entries = readActiveSkills(session?.state);
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!;
    if (entry.mode === "pattern" && entry.pattern) {
      return entry.pattern;
    }
  }
  return undefined;
}

async function resolveCollection(
  ctx: BlockContext,
  meta: ActivePatternMeta,
): Promise<TaskCollectionRef | undefined> {
  if (meta.backing === "request") {
    return getOrCreateTaskCollection({
      backing: "request",
      collectionId: meta.collectionId,
      stateKey: meta.collectionId,
      ctx,
    });
  }
  // Resource backing — require a registered resource collection.
  if (!meta.resourceCollectionKey) return undefined;
  const resourceCollection = getCollection(ctx, meta.resourceCollectionKey) as
    | ResourceCollectionRef<JsonObject>
    | undefined;
  if (!resourceCollection) return undefined;
  return getOrCreateTaskCollection({
    backing: "resource",
    collectionId: meta.collectionId,
    collection: resourceCollection,
    ctx,
  });
}
