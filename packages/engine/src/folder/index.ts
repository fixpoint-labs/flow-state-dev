/**
 * `@flow-state-dev/engine/folder`: how a kit's folder is read. The walk
 * primitives every reader shares (`./walk`) and the claim pass that makes
 * every entry used or refused (`./claim`).
 *
 * Node-only (`node:fs`). Import it from a kit's server entry, the module that
 * names its folder reader, never from code a browser bundle reaches.
 */
export {
  IGNORED_ENTRIES,
  classify,
  openRoot,
  openStructuralDirectory,
  refusedSymlink,
  unreadable,
  type Entry,
  type EntryKind,
  type OpenedDirectory,
  type PathReport,
} from "./walk";

export { openKitFolder, type FolderRefusalKind, type OpenedKitFolder } from "./claim";
