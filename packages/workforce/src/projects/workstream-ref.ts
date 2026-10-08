/**
 * A workstream's address as one string: what its lead's workstream session
 * carries in its readonly `workstreamId` field, and what a worker-session
 * lookup filters on.
 *
 * A leaf with no imports, so the browser client, the derived session id and
 * the server share one spelling.
 */

/** The resource-map ref of a shared project's workstream entries, at org scope. */
export const WORKSTREAMS_RESOURCE = "workstreams";
/** The resource-map ref of a private project's workstream entries, at the owner's user scope. */
export const PRIVATE_WORKSTREAMS_RESOURCE = "privateWorkstreams";

/** The accessor a project's entries are declared under at `visibility`. */
export function workstreamsAccessor(visibility: "shared" | "private"): string {
  return visibility === "private" ? PRIVATE_WORKSTREAMS_RESOURCE : WORKSTREAMS_RESOURCE;
}

/**
 * The storage key of `ownerSegment`'s entry for `address`:
 * `workstreams/<projectId>/<ownerSegment>/<workstreamId>`.
 *
 * @param ownerSegment The owner's key segment, `ownerSegment(userId)` from core.
 */
export function workstreamStorageKey(address: WorkstreamAddress, ownerSegment: string): string {
  return `workstreams/${address.project.id}/${ownerSegment}/${address.id}`;
}

/** A workstream's address: its project's address and its id. Its owner is whoever asks. */
export type WorkstreamAddress = {
  /** The project's address: where it lives, and its id. */
  project: { visibility: "shared" | "private"; id: string };
  /** The workstream's id: one path segment, unique per project and owner. */
  id: string;
};

/**
 * `<visibility>/<projectId>/<workstreamId>`. Each part is one segment, so it
 * reads back unambiguously ({@link parseWorkstreamRef}).
 */
export function workstreamRef(address: WorkstreamAddress): string {
  return `${address.project.visibility}/${address.project.id}/${address.id}`;
}

/** The address a {@link workstreamRef} names, or `undefined` when it names none. */
export function parseWorkstreamRef(ref: string): WorkstreamAddress | undefined {
  const [visibility, project, id, ...rest] = ref.split("/");
  if (rest.length > 0 || project === undefined || id === undefined || project.length === 0 || id.length === 0) {
    return undefined;
  }
  if (visibility !== "shared" && visibility !== "private") return undefined;
  return { project: { visibility, id: project }, id };
}
