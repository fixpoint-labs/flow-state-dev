/**
 * Projects — the `projects` rows, and the collections a project's workstream
 * claims and its files live in.
 *
 *   projects/<id>                       one row per project: title, brief, owner, members, workstreams, repository
 *   workstream-claims/<mailboxId>       which project holds a mailbox workstream; one shared key, written with `create`
 *   project-files/<projectId>/<path>    one row per file the project keeps: notes, memory, a no-repository project's code
 *
 * A project is runtime data. It is created after the tree was read, so no
 * `MAILBOX.md` and no inventory row can name it; the row is the project's one
 * record, and it lists the workstreams (declared mailboxes) it holds.
 *
 * **Shared and private.** A shared project is a row of the organization's
 * `projects`. A private project is the same row, with the same schema, kept in
 * its owner's user scope: `projects/*` and `project-files/**` are declared a
 * second time at user scope ({@link definePrivateProjectsCollection},
 * {@link definePrivateProjectFilesCollection}). Where a project lives is its
 * visibility, never a field on the row, so the two can't disagree, and a
 * project's address is its visibility plus its id ({@link projectAddressSchema}):
 * a user's private `apollo` and the organization's shared `apollo` are two
 * projects. Claims are shared projects' only.
 *
 * Every collection here is shared across flows (`flowIsolation: false`,
 * spelled out for the reason the inventory spells it out: left undefined, an
 * app that sets `isolateOrgState` or `isolateUserState` for an unrelated
 * reason would give each flow its own copy, and every reader but the writer
 * would read empty).
 *
 * Only `projects` has a browser read. Project files are read through
 * `readProjectFiles`, which checks `members` first, so the collection has no
 * browser read.
 *
 * These keys are a public surface: Shift Manager and the chief of staff read
 * them, and moving a prefix breaks every store that already holds a project.
 */

import { defineResourceCollection } from "@flow-state-dev/core";
import { z } from "zod";

/** The resource-map ref of the projects collection. Pinned: Shift Manager reads it by this name. */
export const PROJECTS_RESOURCE = "projects";
/** The resource-map ref of the workstream claims. */
export const WORKSTREAM_CLAIMS_RESOURCE = "workstream-claims";
/** The resource-map ref of the project files. */
export const PROJECT_FILES_RESOURCE = "project-files";
/** The resource-map ref of the private projects: `projects/*` at the owner's user scope. */
export const PRIVATE_PROJECTS_RESOURCE = "privateProjects";
/** The resource-map ref of the private projects' files: `project-files/**` at the owner's user scope. */
export const PRIVATE_PROJECT_FILES_RESOURCE = "privateProjectFiles";

/**
 * The route id Shift Manager gives the workstreams no project lists. A project
 * can never take it, or its page would be the No project page.
 */
export const NO_PROJECT_ID = "unassigned";

/**
 * Where a project lives: `"shared"` in the organization, `"private"` in its
 * owner's user scope. A create that names none makes a shared project.
 */
export const projectVisibilitySchema = z.enum(["shared", "private"]);

/** @see projectVisibilitySchema */
export type ProjectVisibility = z.infer<typeof projectVisibilitySchema>;

/**
 * A project's address: its visibility and its id. Every project read and
 * write after the create takes one, and picks the collection from it. A
 * private address only ever reaches the caller's own user scope.
 */
export const projectAddressSchema = z
  .object({ visibility: projectVisibilitySchema, id: z.string().min(1) })
  .strict();

/** @see projectAddressSchema */
export type ProjectAddress = z.infer<typeof projectAddressSchema>;

/**
 * One project, as it is stored.
 *
 * `id`, `title` and `ownerUserId` are required: a row that lost one is not a
 * thinner project, it is one nobody can address or own. Every other field
 * carries a default so a row written by an earlier version still reads
 * (BP-023, BP-030).
 *
 * `members` decides who opens workstreams in a shared project and changes its
 * workstream list. It is written only by trusted code — the creator's own
 * grant at create — and nothing a member does adds to it.
 */
export const projectRowSchema = z.object({
  /** The project's id, also its key under `projects/`. One path segment; never `unassigned`. */
  id: z.string().min(1),
  title: z.string().min(1),
  /** What the project is for. The project's Brief tab shows it. `null` when none was given. */
  brief: z.string().nullable().default(null),
  /** A free label. New projects are `"active"`. */
  status: z.string().default("active"),
  /** The user who created it, as the engine recorded the creating session's owner. */
  ownerUserId: z.string().min(1),
  /**
   * On a shared project, who may open workstreams and change its workstream
   * list. Always includes the owner. A private project has only its owner.
   */
  members: z.array(z.string()).default([]),
  /** Full mailbox ids of the declared mailboxes this project holds, from any team. */
  workstreams: z.array(z.string()).default([]),
  /**
   * The git remote the project's code lives in, as a member wrote it (for
   * example `https://github.com/acme/storefront.git` or
   * `git@github.com:acme/storefront.git`), or `null` for a project with no
   * repository. A remote, never a folder on some machine: the writes refuse a
   * bare path and a value carrying a credential (`repository-value.ts`).
   * A row written before the field existed has no key in storage, and stored
   * state is not re-parsed on read: read rows through this schema, or guard
   * with `== null` (BP-030).
   */
  repository: z.string().nullable().default(null),
  /**
   * The token each listed workstream's claim carried when this row was written.
   * A write that drops a workstream deletes its claim only while the claim
   * still carries this token, so a claim a later write has re-stamped survives.
   * Server-side: not in the browser read.
   */
  claimTokens: z.record(z.string()).default({})
});

/** One stored project. @see projectRowSchema */
export type ProjectRow = z.infer<typeof projectRowSchema>;

/**
 * Every field of the row, named rather than defaulted (BP-015), so a key a
 * later version adds stays server-side until it is listed here. A shared
 * project is visible to everyone in its organization; that it exists is not
 * a secret.
 */
const PROJECT_CLIENT_FIELDS = [
  "id",
  "title",
  "brief",
  "status",
  "ownerUserId",
  "members",
  "workstreams",
  "repository"
] as const;

/**
 * Which project holds one workstream, and the token of the write that last
 * stamped the claim. The token is what a later release checks before it
 * deletes: a claim re-stamped since is someone else's to keep.
 */
export const workstreamClaimSchema = z.object({ projectId: z.string().min(1), token: z.string().default("") });

/** @see workstreamClaimSchema */
export type WorkstreamClaim = z.infer<typeof workstreamClaimSchema>;

/** Shared across flows on purpose; see the module header. */
const SHARED_ACROSS_FLOWS = false;

// Each `define*Collection` below returns ONE shared declaration rather than a
// fresh one per call. A flow refuses two different declarations under one ref
// ("Resource conflict"), and these are declared by the project writes, the
// worker flows and an app's own `org/resources/projects.ts`, which may all
// meet in one flow. Rows are addressed by pattern and scope either way.

/**
 * The organization's projects, at `projects/*`.
 *
 * Install it wherever projects are read or written. Org-scoped, shared across
 * flows, and readable by a browser through `expose`. Takes no options: the
 * prefix, the scope and the sharing are what Shift Manager joins against. The
 * declaration returned is the same one every call returns.
 *
 * **Write a row with `create()`, never `upsert()`.** `create()` refuses a key
 * that is held, and that refusal is what stops a second project taking an id.
 * The project blocks (`defineProjectBlocks`) are the writers; prefer them.
 *
 * @example
 *   // workforce/org/resources/projects.ts
 *   export default defineProjectsCollection();
 */
export function defineProjectsCollection() {
  return PROJECTS_COLLECTION;
}

const PROJECTS_COLLECTION = defineResourceCollection({
  pattern: "projects/*",
  scope: "org",
  flowIsolation: SHARED_ACROSS_FLOWS,
  stateSchema: projectRowSchema,
  client: { state: { read: true }, expose: PROJECT_CLIENT_FIELDS }
});

/**
 * The private projects, at `projects/*` in each user's own scope: the same
 * row as a shared project's, which only its owner lists or reads. User scope
 * is one cell per user per organization, so a private project shows only in
 * the organization it was made in.
 *
 * Install it beside {@link defineProjectsCollection} wherever projects are
 * read or written; the project blocks hold both. Readable by a browser, which
 * reads its own user's rows only.
 */
export function definePrivateProjectsCollection() {
  return PRIVATE_PROJECTS_COLLECTION;
}

const PRIVATE_PROJECTS_COLLECTION = defineResourceCollection({
  pattern: "projects/*",
  scope: "user",
  flowIsolation: SHARED_ACROSS_FLOWS,
  stateSchema: projectRowSchema,
  client: { state: { read: true }, expose: PROJECT_CLIENT_FIELDS }
});

/**
 * Workstream claims, at `workstream-claims/<mailboxId>`. One shared key per
 * workstream, written with `create`, so of two projects claiming the same
 * workstream at once exactly one lands. No browser read: the project rows
 * already say which workstreams each holds.
 */
export function defineWorkstreamClaimsCollection() {
  return WORKSTREAM_CLAIMS_COLLECTION;
}

const WORKSTREAM_CLAIMS_COLLECTION = defineResourceCollection({
  pattern: "workstream-claims/*",
  scope: "org",
  flowIsolation: SHARED_ACROSS_FLOWS,
  prefetchMode: "lazy",
  stateSchema: workstreamClaimSchema
});

/**
 * One file a project keeps, as a workspace projection commits it: its path
 * under the project, its content hash, and when it was last synced. The file's
 * body is the row's content, not its state. Nullable with a `null` default
 * (BP-023), so a row written with less still reads.
 */
export const projectFileSchema = z.object({
  path: z.string().nullable().default(null),
  hash: z.string().nullable().default(null),
  updatedAt: z.string().nullable().default(null)
});

/** @see projectFileSchema */
export type ProjectFile = z.infer<typeof projectFileSchema>;

/**
 * The files each project keeps, at `project-files/<projectId>/<path>`: an
 * agent's notes and memory, and the whole of a no-repository project's code.
 * One collection for the organization, keyed by project, so a reader or a
 * workspace mount scoped to `<projectId>/` sees that project's files and no
 * other's. Lazy, because a project's files grow without bound; no browser
 * read, because only the project's members may read them, through
 * `readProjectFiles` (`project-files.ts`).
 */
export function defineProjectFilesCollection() {
  return PROJECT_FILES_COLLECTION;
}

const PROJECT_FILES_COLLECTION = defineResourceCollection({
  pattern: "project-files/**",
  scope: "org",
  flowIsolation: SHARED_ACROSS_FLOWS,
  prefetchMode: "lazy",
  stateSchema: projectFileSchema
});

/**
 * The private projects' files, at `project-files/<projectId>/<path>` in each
 * user's own scope: a private project's files, which only its owner reads.
 * Lazy and with no browser read, like {@link defineProjectFilesCollection}.
 */
export function definePrivateProjectFilesCollection() {
  return PRIVATE_PROJECT_FILES_COLLECTION;
}

const PRIVATE_PROJECT_FILES_COLLECTION = defineResourceCollection({
  pattern: "project-files/**",
  scope: "user",
  flowIsolation: SHARED_ACROSS_FLOWS,
  prefetchMode: "lazy",
  stateSchema: projectFileSchema
});

/**
 * The key prefix of one project's files, relative to the collection:
 * `<projectId>/`. The trailing slash is what keeps `apollo` from reading
 * `apollo2`'s files.
 */
export function projectFilesPrefix(projectId: string): string {
  return `${projectId}/`;
}

/**
 * Why a project id is not usable, or `undefined` when it is. One path segment,
 * so it can head a key; never {@link NO_PROJECT_ID}.
 */
export function projectIdProblem(id: string): string | undefined {
  if (id.length === 0) return "a project id can't be empty";
  if (id === NO_PROJECT_ID) return `"${NO_PROJECT_ID}" is where workstreams no project lists are shown, so no project can take it`;
  // A backslash too: the id is the key prefix a run's files are mounted at,
  // and a mount scope refuses one, so the project could never be worked on.
  if (id.includes("/") || id.includes("\\") || id === "." || id === "..") {
    return `project id "${id}" must be one path segment`;
  }
  return undefined;
}
