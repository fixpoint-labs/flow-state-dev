/**
 * A workstream entry's shape and its parser: the fields one entry stores, its
 * place read off its key, and `parseWorkstreamEntry`, which checks both.
 *
 * A leaf with zod and two leaves of its own, so `readProject` on the server
 * and a browser reading a project's entries (`@flow-state-dev/workforce/browser`)
 * parse one shape. The collections that store entries are declared in
 * `workstream-collections.ts`.
 */

import { z } from "zod";
import { writtenBySchema } from "../written-by";
import { WORKSTREAM_STATUS_MAX_LENGTH } from "./project-progress";

/** The storage prefix of every entry, before the project's id. */
const STORAGE_PREFIX = "workstreams/";

/**
 * Where a workstream stands: a short label in the owner's own words
 * (`"on-track"`, `"waiting on legal"`), trimmed, not empty, at most
 * {@link WORKSTREAM_STATUS_MAX_LENGTH} characters. One label has a meaning,
 * `"done"` (`DONE_STATUS`): a done workstream stays listed, is never stale and is
 * never the next due date.
 */
export const workstreamStatusSchema = z.string().trim().min(1).max(WORKSTREAM_STATUS_MAX_LENGTH);

/** @see workstreamStatusSchema */
export type WorkstreamStatus = z.infer<typeof workstreamStatusSchema>;

/** A calendar date, `YYYY-MM-DD`, which sorts as text. */
export const workstreamDueSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "a due date is YYYY-MM-DD");

/**
 * One objective: what it is, and whether it is met, when and by whom. `metAt`
 * and `metBy` are set by the write that met it, from the server's clock and
 * the session.
 */
export const workstreamObjectiveSchema = z.object({
  text: z.string().min(1),
  met: z.boolean().default(false),
  metAt: z.string().nullable().default(null),
  metBy: writtenBySchema.nullable().default(null)
});

/** @see workstreamObjectiveSchema */
export type WorkstreamObjective = z.infer<typeof workstreamObjectiveSchema>;

/** The entry's own fields; {@link sharedResource} adds `writtenBy`. */
export const workstreamEntryShape = {
  title: z.string().min(1),
  /** The worker that leads it, on the owner's roster. Chosen at open, never changed. */
  lead: z.string().min(1),
  /** The lead's workstream session, the owner's. `null` until the open that made the entry has made it. */
  sessionId: z.string().nullable().default(null),
  /** A label in the owner's words; `"done"` marks it finished. Stored trimmed. */
  status: z.string().min(1).max(WORKSTREAM_STATUS_MAX_LENGTH).default("on-track"),
  due: workstreamDueSchema.nullable().default(null),
  objectives: z.array(workstreamObjectiveSchema).default([]),
  /** When it was opened, by the server's clock. */
  openedAt: z.string(),
  /** When it was last written, by the server's clock. Seven days unchanged reads as stale. */
  updatedAt: z.string()
};

/** One workstream entry, as stored. Its latest report is the entry's content. */
export const workstreamEntrySchema = z.object({ ...workstreamEntryShape, writtenBy: writtenBySchema });

/** @see workstreamEntrySchema */
export type WorkstreamEntry = z.infer<typeof workstreamEntrySchema>;

/** An entry's place, read off its storage path: its project, its owner and its id. */
export type WorkstreamEntryPlace = { project: string; owner: string; id: string };

/**
 * Where the entry at `path` sits, or `undefined` for a path that is not a
 * direct entry of a project (`workstreams/<project>/<~owner>/<id>`).
 */
export function workstreamPlaceOf(path: string): WorkstreamEntryPlace | undefined {
  if (!path.startsWith(STORAGE_PREFIX)) return undefined;
  const segments = path.slice(STORAGE_PREFIX.length).split("/");
  if (segments.length !== 3 || !segments[1]!.startsWith("~")) return undefined;
  let owner: string;
  try {
    owner = decodeURIComponent(segments[1]!.slice(1));
  } catch {
    return undefined;
  }
  return { project: segments[0]!, owner, id: segments[2]! };
}

/** One entry as a reader parses it: the stored fields, with its place. */
export type ParsedWorkstreamEntry = WorkstreamEntry & WorkstreamEntryPlace;

/**
 * Parse the entry stored at `path`: its place read off the key, its fields
 * checked against {@link workstreamEntrySchema}. `undefined` for a path that is
 * not a direct entry of a project. The one parser for an entry, shared by
 * `readProject` on the server and an app's browser read of the same rows, so
 * the two can't drift.
 *
 * @param path The entry's storage key, `workstreams/<project>/<~owner>/<id>`.
 * @param state The entry's stored state, or what a browser read publishes of it.
 * @throws ZodError when the state is not an entry.
 */
export function parseWorkstreamEntry(path: string, state: unknown): ParsedWorkstreamEntry | undefined {
  const place = workstreamPlaceOf(path);
  if (place === undefined) return undefined;
  return { ...workstreamEntrySchema.parse(state), ...place };
}
