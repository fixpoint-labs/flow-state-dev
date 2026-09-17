/**
 * The walk half of the code convention: what the three locked folders hold.
 *
 * Reads the **tree**, never the modules in it. Nothing here opens a discovered
 * file, and nothing here decides anything about registration — it names what a
 * walker can see and hands the list on. The two checks that need a file's
 * *value* live elsewhere by decision: its export shape is caught by the app's
 * own typecheck, because the rendered maps are typed, and a `kind` disagreeing
 * with its basename is caught by `hireWorkforce`, which already names both when
 * a factory sits under someone else's key.
 *
 * Every refusal is collected rather than thrown where it is found, so one run
 * names all of them — the same bargain `hireWorkforce` makes with a bad roster.
 * Node-only: it walks a directory, so it sits behind a subpath rather than on
 * the package root.
 */

import path from "node:path";
import {
  IGNORED_ENTRIES,
  classify,
  openRoot,
  openStructuralDirectory,
  refusedSymlink,
  unreadable,
  validateSegment,
  type SegmentLabel,
} from "../loader";

/** Which locked folder a discovered file came from. */
export type CodeSlotId = "worker" | "channel" | "block";

/** One locked folder, and what a file in it becomes. */
export interface CodeSlot {
  id: CodeSlotId;
  /** Path under the workforce root, POSIX, relative. Owner-locked. */
  dir: string;
  /** The map this slot's files are rendered onto. Public: an app imports it. */
  exportName: "kinds" | "channelKinds" | "blocks";
  /** What a basename here names, for a refusal to say. */
  label: SegmentLabel;
}

/**
 * The three locked folders, in the order their maps are rendered.
 *
 * Owner-locked paths, not derived — a best-practice tree rather than a
 * top-level `kinds/`, and one convention covering kinds and blocks together
 * rather than a kinds-only one the blocks half would later have to match.
 */
export const CODE_SLOTS: readonly CodeSlot[] = Object.freeze([
  { id: "worker", dir: "flows/workers", exportName: "kinds", label: "Kind" },
  { id: "channel", dir: "flows/channels", exportName: "channelKinds", label: "Kind" },
  { id: "block", dir: "blocks", exportName: "blocks", label: "Block" },
] as const);

/**
 * Extensions that denote a TypeScript module. Anything else in a locked folder
 * is a note beside the code rather than a declaration.
 */
const TYPESCRIPT_EXTENSIONS = [".ts", ".tsx"];

/** One file the walk found, and where it will be imported from. */
export interface DiscoveredFile {
  slot: CodeSlotId;
  /** The basename without its extension — the name this file registers under. */
  name: string;
  /** Slash-separated path under the workforce root, e.g. `flows/workers/researcher.ts`. Orders the output. */
  path: string;
  /** The specifier the generated module imports it by, e.g. `./flows/workers/researcher`. */
  importPath: string;
}

/** What one walk produced. */
export interface DiscoveryResult {
  /** Every file found, ordered by {@link DiscoveredFile.path}. */
  files: DiscoveredFile[];
  /** The folders looked in — all three, whether or not they exist, so the command can say where it looked. */
  searched: string[];
}

/**
 * Thrown when a walk finds anything it will not render.
 *
 * Carries every problem rather than the first, because an author fixing a tree
 * should see the whole list in one run. Nothing is rendered when this throws: a
 * partial generation would leave a registry quietly short.
 */
export class WorkforceCodeError extends Error {
  /** Each refusal, in the order the walk met it. */
  readonly problems: string[];

  constructor(problems: string[]) {
    super(
      `Refused ${problems.length} entr${problems.length === 1 ? "y" : "ies"} under the workforce ` +
        `code folders; nothing was generated:\n  - ${problems.join("\n  - ")}`,
    );
    this.name = "WorkforceCodeError";
    this.problems = problems;
  }
}

/** The TypeScript extension this entry carries, or `undefined` when it is not a TypeScript module. */
function typescriptExtension(entry: string): string | undefined {
  return TYPESCRIPT_EXTENSIONS.find((extension) => entry.endsWith(extension));
}

/**
 * The directories between the root and a locked folder — `flows` for
 * `flows/workers`, nothing for `blocks`.
 *
 * They need opening in their own right, because {@link classify} answers for
 * the FINAL entry of a path: asking about `flows/workers` resolves *through* a
 * symlinked `flows` and reports the directory behind it. The shipped readers
 * never meet this, since they classify each level as they walk; a locked path
 * two segments deep has to do the same, or the no-follow promise holds for the
 * last segment only.
 */
function pathInTo(dir: string): string[] {
  const parts = dir.split("/");
  return parts.slice(0, -1).map((_part, index) => parts.slice(0, index + 1).join("/"));
}

/**
 * Walk the three locked folders under `root` and return what they hold.
 *
 * One level only, one file per entry — a directory inside a locked folder is
 * refused by name rather than skipped, because a folder an author created and
 * the tool ignored is the silence this convention exists to remove.
 *
 * The root is opened here rather than left to the caller, so the no-follow
 * promise belongs to this function and not to whoever happens to call it: a
 * symlinked root would put the whole walk outside the configured tree, and a
 * root that is not there would return empty maps for a path nobody configured.
 *
 * @param root Path to the app's `workforce/` directory.
 * @returns Every discovered file, ordered by path, plus the folders looked in.
 * @throws If the root is symlinked, missing or unreadable.
 * @throws {WorkforceCodeError} If anything under it was refused; the message names all of them.
 */
export async function discoverWorkforceCode(root: string): Promise<DiscoveryResult> {
  // Before anything below it is opened. Absent FOLDERS are silent, because an
  // app may have no custom code of that kind; an absent ROOT is a wiring
  // mistake, and the two must not read the same.
  await openRoot(root);

  const files: DiscoveredFile[] = [];
  const searched: string[] = [];
  const problems: string[] = [];
  /** Naming scope → the path that already claimed it. */
  const claimed = new Map<string, string>();
  /** An intermediate directory → whether the walk may go through it. Shared, so `flows` is answered and reported once. */
  const wayIn = new Map<string, boolean>();

  for (const slot of CODE_SLOTS) {
    const dir = path.join(root, ...slot.dir.split("/"));
    searched.push(slot.dir);

    // Every level on the way in, before the locked folder itself. Two flow
    // folders share `flows`, so the answer is cached and a refusal is filed
    // once rather than once per folder behind it.
    let passable = true;
    for (const step of pathInTo(slot.dir)) {
      let open = wayIn.get(step);
      if (open === undefined) {
        const stepped = await openStructuralDirectory(path.join(root, ...step.split("/")), step);
        // Absent stays silent and needs no note: the locked folder under it is
        // absent too, which is an app with no custom code of this kind.
        if (stepped.refusal !== undefined) problems.push(stepped.refusal.error.message);
        open = stepped.refusal === undefined;
        wayIn.set(step, open);
      }
      if (!open) {
        passable = false;
        break;
      }
    }
    if (!passable) continue;

    const opened = await openStructuralDirectory(dir, slot.dir);
    if (opened.refusal !== undefined) {
      // Absence reaches neither branch and stays silent: a tree that does not
      // go this way is an app with no custom code of this kind. Unreadable is
      // never folded into it — absent means nothing is there, unreadable means
      // code we failed to see.
      problems.push(opened.refusal.error.message);
      continue;
    }
    if (opened.entries === undefined) continue;

    for (const entry of [...opened.entries].sort()) {
      if (IGNORED_ENTRIES.has(entry)) continue;

      const relative = `${slot.dir}/${entry}`;
      const found = await classify(path.join(dir, entry));

      if (found.kind === "symlink") {
        problems.push(refusedSymlink("entry", relative).message);
        continue;
      }
      if (found.kind === "unreadable") {
        problems.push(unreadable("Entry", relative, found.error).message);
        continue;
      }
      if (found.kind === "directory") {
        problems.push(
          `"${relative}" is a directory — a locked folder holds one file per ` +
            `${slot.label.toLowerCase()}, one level deep. Nesting would make the basename ambiguous`,
        );
        continue;
      }
      // A socket or a FIFO: not a declaration, and not a mistake either.
      if (found.kind === "absent") continue;

      const extension = typescriptExtension(entry);
      // A README, a fixture, a note beside the code: the folders hold
      // declarations, and a file that is not a TypeScript module is not one.
      if (extension === undefined) continue;

      const name = entry.slice(0, entry.length - extension.length);
      try {
        validateSegment(name, slot.label);
      } catch (error) {
        problems.push(`"${relative}" — ${(error as Error).message}`);
        continue;
      }

      // One basename means one thing. Scoped so a worker kind and a block may
      // share a name — they feed different maps on different calls — while the
      // two FLOW folders share a scope, because one name meaning two kinds is
      // exactly the ambiguity this convention removes.
      const scope = slot.id === "block" ? `block:${name}` : `kind:${name}`;
      const already = claimed.get(scope);
      if (already !== undefined) {
        problems.push(
          `"${relative}" and "${already}" both declare "${name}" — one basename, ` +
            `one ${slot.label.toLowerCase()}`,
        );
        continue;
      }
      claimed.set(scope, relative);

      files.push({
        slot: slot.id,
        name,
        path: relative,
        importPath: `./${slot.dir}/${name}`,
      });
    }
  }

  if (problems.length > 0) throw new WorkforceCodeError(problems);

  // Ordered by path rather than by the order a directory listed, so a tree that
  // has not changed renders byte-identically on any machine.
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { files, searched };
}
