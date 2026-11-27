/**
 * A project as Shift Manager draws it, and the parser that reads one from the
 * projects collection. A leaf, with no hook and no connection, so the
 * snapshot's reader and the directory's reads both parse with it without
 * reaching the page's connection through `projects.ts`.
 */

/** Where a project lives: the organization's, or the user's own. */
export type ProjectVisibility = "shared" | "private";

/**
 * A project: a row of the organization's `projects` collection (shared), or of
 * the user's own (private), with where it lives. Its address is its
 * visibility and its id: a private project and a shared one can share an id.
 */
export type Project = {
  /** The row id; with the visibility, the project's address. */
  id: string;
  /** Where the row lives. */
  visibility: ProjectVisibility;
  title: string;
  /** What the project is for; its Brief tab. `null` when none was given. */
  brief: string | null;
  status: string;
  ownerUserId: string;
  /** On a shared project, who may open workstreams in it. */
  members: string[];
  /** The git remote the project's code lives in, or `null` when it has none. A row written before the field reads as none. */
  repository: string | null;
};

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;
}
function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

// BP-030.
/**
 * A project entry, as the projects collection's browser read publishes it. One
 * missing its id, title or owner is not a project anyone can address or own,
 * and is left out; every other field reads as empty when absent, so an entry an
 * earlier version wrote still reads.
 */
export function toProject(value: unknown, visibility: ProjectVisibility = "shared"): Project | undefined {
  const id = text(field(value, "id"));
  const title = text(field(value, "title"));
  const ownerUserId = text(field(value, "ownerUserId"));
  if (id === null || title === null || ownerUserId === null) return undefined;
  return {
    id,
    visibility,
    title,
    // An empty brief is still the brief the row was given; only a missing or non-string one is none.
    brief: typeof field(value, "brief") === "string" ? (field(value, "brief") as string) : null,
    status: text(field(value, "status")) ?? "active",
    ownerUserId,
    members: strings(field(value, "members")),
    repository: text(field(value, "repository")),
  };
}

