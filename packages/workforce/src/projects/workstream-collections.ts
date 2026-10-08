/**
 * Workstream entries: one per workstream, keyed by its project, its owner and
 * its id, at both visibilities.
 *
 *   workstreams/<projectId>/<~owner>/<workstreamId>
 *
 * A workstream is one area of a project with one owner: this entry, which
 * everyone who reads the project reads, and its lead's workstream session,
 * which only the owner opens. The entry says who leads it, which session is
 * theirs, its status, its due date, its objectives and its latest report (the
 * entry's content).
 *
 * **One writer.** The collections declare `ownerWrites` on the owner segment,
 * so the engine refuses a create, update or delete from anyone but the user
 * the key names, whichever flow writes (FIX-1793 BR-11). Who wrote last is
 * `writtenBy`, stamped from the session (`shared-resource.ts`), for display
 * only: it never decides a write. The owner is read off the key, never the
 * state.
 *
 * **Two visibilities.** A shared project's entries are the organization's,
 * read by everyone in it; a private project's are the same keys in the
 * owner's user scope. A project's entries are its direct children under
 * `workstreams/<projectId>/`, read by one prefix.
 *
 * Leaf module: core, zod and the shared-resource helper only, so the worker
 * installation's create check and the project blocks share one declaration.
 */

import { ownerSegment } from "@flow-state-dev/core";
import { z } from "zod";
import { sharedResource, writtenBySchema } from "../shared-resource";
import { projectAddressSchema, type ProjectVisibility } from "./collections";
import { WORKSTREAM_STATUSES } from "./project-progress";

/** The resource-map ref of a shared project's workstream entries, at org scope. */
export const WORKSTREAMS_RESOURCE = "workstreams";
/** The resource-map ref of a private project's workstream entries, at the owner's user scope. */
export const PRIVATE_WORKSTREAMS_RESOURCE = "privateWorkstreams";

/** The entries' key pattern. **Pinned**: persisted, and FIX-1792 and FIX-1794 read it. */
export const WORKSTREAMS_PATTERN = "workstreams/[project]/[owner]/[workstream]";

/** The storage prefix of every entry, before the project's id. */
const STORAGE_PREFIX = "workstreams/";

/** Where a workstream stands. A done workstream stays listed, as done. */
export const workstreamStatusSchema = z.enum(WORKSTREAM_STATUSES);

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
const entryShape = {
  title: z.string().min(1),
  /** The worker that leads it, on the owner's roster. Chosen at open, never changed. */
  lead: z.string().min(1),
  /** The lead's workstream session, the owner's. `null` until the open that made the entry has made it. */
  sessionId: z.string().nullable().default(null),
  status: workstreamStatusSchema.default("on-track"),
  due: workstreamDueSchema.nullable().default(null),
  objectives: z.array(workstreamObjectiveSchema).default([]),
  /** When it was opened, by the server's clock. */
  openedAt: z.string(),
  /** When it was last written, by the server's clock. Seven days unchanged reads as stale. */
  updatedAt: z.string()
};

/** One workstream entry, as stored. Its latest report is the entry's content. */
export const workstreamEntrySchema = z.object({ ...entryShape, writtenBy: writtenBySchema });

/** @see workstreamEntrySchema */
export type WorkstreamEntry = z.infer<typeof workstreamEntrySchema>;

/** Every field a browser reads, named (BP-015). The session id grants nothing to anyone but the owner. */
const ENTRY_CLIENT_FIELDS = [
  "title",
  "lead",
  "sessionId",
  "status",
  "due",
  "objectives",
  "openedAt",
  "updatedAt",
  "writtenBy"
] as const;

const declaration = (scope: ProjectVisibility) =>
  sharedResource(WORKSTREAMS_PATTERN, entryShape, {
    scope: scope === "private" ? "user" : "org",
    ownerWrites: { param: "owner" },
    // Shared across flows: the project blocks, the lead's worker flow and the
    // create check all read one copy.
    flowIsolation: false,
    // A project's entries are read by one prefix; never loaded whole at request start.
    prefetchMode: "lazy",
    client: { state: { read: true }, content: { read: true }, expose: ENTRY_CLIENT_FIELDS }
  });

const SHARED_ENTRIES = declaration("shared");
const PRIVATE_ENTRIES = declaration("private");

/** A shared project's workstream entries, at org scope. */
export function defineWorkstreamsCollection() {
  return SHARED_ENTRIES;
}

/** A private project's workstream entries, at its owner's user scope. */
export function definePrivateWorkstreamsCollection() {
  return PRIVATE_ENTRIES;
}

/** Both declarations, as one resource map a block or a flow spreads into its `resources`. */
export const WORKSTREAM_RESOURCES = {
  [WORKSTREAMS_RESOURCE]: SHARED_ENTRIES,
  [PRIVATE_WORKSTREAMS_RESOURCE]: PRIVATE_ENTRIES
} as const;

/** The accessor a project's entries are declared under at `visibility`. */
export function workstreamsAccessor(visibility: ProjectVisibility): string {
  return visibility === "private" ? PRIVATE_WORKSTREAMS_RESOURCE : WORKSTREAMS_RESOURCE;
}

/**
 * A workstream's address: its project's address and its id. Its owner is the
 * user asking, so an address only ever reaches the caller's own entry. Its
 * one-string form is `workstreamRef` (`workstream-ref.ts`).
 */
export const workstreamAddressSchema = z.object({ project: projectAddressSchema, id: z.string().min(1) }).strict();

/** One workstream as the project reads and writes answer it: its entry, with its project, its owner and its id. */
export const workstreamViewSchema = workstreamEntrySchema.extend({
  project: projectAddressSchema,
  id: z.string(),
  owner: z.string()
});

/** @see workstreamViewSchema */
export type WorkstreamView = z.infer<typeof workstreamViewSchema>;

/** Why a workstream id is not usable, or `undefined` when it is: one path segment, not empty. */
export function workstreamIdProblem(id: string): string | undefined {
  if (id.length === 0) return "a workstream id can't be empty";
  if (id.includes("/") || id.includes("\\") || id === "." || id === "..") {
    return `workstream id "${id}" must be one path segment, with no "/"`;
  }
  return undefined;
}

/** The key of `owner`'s entry `workstream` in `project`, relative to the collection. */
export function workstreamEntryKey(project: string, owner: string, workstream: string): Record<string, string> {
  return { project, owner: ownerSegment(owner), workstream };
}

/**
 * The prefix of one project's entries, relative to the collection:
 * `<projectId>/`. The trailing slash keeps `apollo` from reading `apollo2`'s.
 */
export function workstreamEntriesPrefix(project: string): string {
  return `${project}/`;
}

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
