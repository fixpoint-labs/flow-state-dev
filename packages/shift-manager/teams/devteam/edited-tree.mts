/**
 * The Lab's workforce folder as a check asked to change it: the tree itself
 * when nothing is changed, or a copy in a temporary folder with the changes
 * written into its files.
 *
 * The workforce kit reads a folder, never records, so a check that perturbs a
 * worker (a document it names, a skill it carries, the tools its line lists)
 * perturbs the files the kit reads. The Lab's own tree is never written.
 *
 * What can change, and only what `openLab` asks for:
 *
 * - a worker's frontmatter keys (`declared`), each written as one line;
 * - a worker taken off the tree (its folder left out of the copy);
 * - a skill's `SKILL.md`, wherever a skill of that name sits;
 * - a worker's own skills: one taken away, or one's `SKILL.md` replaced. A
 *   skill shared from its team or the org can't change for one worker alone:
 *   a skill name reaches a worker from one level only, so that is refused;
 * - a document's body, by its ref.
 */
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";

/** What a check changes in the tree. */
export interface TreeEdits {
  /** Frontmatter keys to set on a worker's `WORKER.md`, by worker id. */
  declared?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  /** Workers left out of the tree, by id. */
  remove?: readonly string[];
  /** A skill's `SKILL.md`, by skill name, wherever it sits. */
  skills?: Readonly<Record<string, string>>;
  /** A worker's own skills: those left out, and those whose `SKILL.md` is replaced, by worker id. */
  ownSkills?: Readonly<Record<string, { remove?: readonly string[]; replace?: Readonly<Record<string, string>> }>>;
  /** A document's body, by its ref. */
  documents?: Readonly<Record<string, string>>;
}

/** A worker's folder under the tree, from its id: `team.worker`, or an org worker's bare id. */
export function workerFolder(id: string): string {
  const dot = id.indexOf(".");
  return dot < 0 ? join("org", "workers", id) : join("teams", id.slice(0, dot), "workers", id.slice(dot + 1));
}

/** Whether `edits` asks for anything. */
function changesAnything(edits: TreeEdits): boolean {
  return [edits.declared, edits.skills, edits.ownSkills, edits.documents].some((entry) => entry !== undefined && Object.keys(entry).length > 0) || (edits.remove?.length ?? 0) > 0;
}

/** One frontmatter value as a line the workforce frontmatter reader takes: JSON-quoted strings, flow lists. */
function frontmatterValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => JSON.stringify(item)).join(", ")}]`;
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

/** `text` with frontmatter `key` set to `value`: its line (and any indented lines under it) replaced, or one added. */
function withKey(text: string, key: string, value: unknown): string {
  const end = text.indexOf("\n---", 4);
  if (!text.startsWith("---\n") || end < 0) throw new Error(`no frontmatter to set "${key}" in`);
  const lines = text.slice(4, end).split("\n");
  const at = lines.findIndex((line) => line.startsWith(`${key}:`));
  const line = `${key}: ${frontmatterValue(value)}`;
  if (at < 0) lines.push(line);
  else {
    let next = at + 1;
    while (next < lines.length && /^\s+\S/.test(lines[next]!)) next++;
    lines.splice(at, next - at, line);
  }
  return `---\n${lines.join("\n")}${text.slice(end)}`;
}

/** Every file under `dir`, as paths relative to `root`. */
function filesUnder(root: string, dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) filesUnder(root, full, out);
    else out.push(relative(root, full).split(sep).join("/"));
  }
  return out;
}

/** A document's ref from its path: the path with its `resources/` segment and `.md` taken out. */
function refOf(path: string): string | undefined {
  const match = /^(.*?)(?:^|\/)resources\/([^/]+)\.md$/.exec(path);
  if (match === null) return undefined;
  const level = match[1]!.replace(/^org\/?/, "");
  return level === "" ? match[2]! : `${level}/${match[2]}`;
}

/**
 * The folder the kit should read: `root` when `edits` change nothing, else a
 * copy with them written in.
 *
 * @throws When an edit names a worker, a skill or a document the tree doesn't have.
 */
export function editedTree(root: string, edits: TreeEdits, label = "openLab"): string {
  if (!changesAnything(edits)) return root;
  const copy = join(mkdtempSync(join(tmpdir(), "devforce-lab-tree-")), "workforce");
  cpSync(root, copy, { recursive: true });
  const workerFile = (id: string) => {
    const file = join(copy, workerFolder(id), "WORKER.md");
    if (!existsSync(file)) throw new Error(`${label}: no worker "${id}" in the tree`);
    return file;
  };
  for (const [id, keys] of Object.entries(edits.declared ?? {})) {
    const file = workerFile(id);
    let text = readFileSync(file, "utf8");
    for (const [key, value] of Object.entries(keys)) text = withKey(text, key, value);
    writeFileSync(file, text);
  }
  for (const id of edits.remove ?? []) {
    workerFile(id);
    rmSync(join(copy, workerFolder(id)), { recursive: true });
  }
  const files = filesUnder(copy, copy);
  for (const [name, skillMd] of Object.entries(edits.skills ?? {})) {
    const at = files.filter((path) => path.endsWith(`skills/${name}/SKILL.md`));
    if (at.length === 0) throw new Error(`${label}: \`skills\` replaces "${name}", which no worker in the tree carries`);
    for (const path of at) writeFileSync(join(copy, path), skillMd);
  }
  for (const [id, { remove = [], replace = {} }] of Object.entries(edits.ownSkills ?? {})) {
    const own = join(copy, workerFolder(id), "skills");
    const ownOf = (name: string) => {
      const folder = join(own, name);
      if (!existsSync(join(folder, "SKILL.md"))) {
        throw new Error(`${label}: worker "${id}"'s skill "${name}" isn't its own; a skill shared from its team or the org can't change for one worker`);
      }
      return folder;
    };
    for (const name of remove) rmSync(ownOf(name), { recursive: true });
    for (const [name, skillMd] of Object.entries(replace)) writeFileSync(join(ownOf(name), "SKILL.md"), skillMd);
  }
  for (const [ref, body] of Object.entries(edits.documents ?? {})) {
    const path = files.find((file) => refOf(file) === ref);
    if (path === undefined) throw new Error(`${label}: \`documents\` replaces "${ref}", which the tree does not declare`);
    const text = readFileSync(join(copy, path), "utf8");
    const end = text.indexOf("\n---", 4);
    writeFileSync(join(copy, path), `${text.slice(0, end + 4)}\n${body}`);
  }
  return copy;
}
