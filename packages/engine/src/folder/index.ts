/**
 * `@flow-state-dev/engine/folder`: the walk primitives every reader of a
 * kit's folder shares (`./walk`). The claim pass that makes every entry used
 * or refused (`./claim`) is the engine's own: a kit's reader meets it only as
 * the `KitFolder` its `directory.read` is handed.
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
