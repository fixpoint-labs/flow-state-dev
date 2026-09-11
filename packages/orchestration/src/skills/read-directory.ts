/**
 * Build-time / startup-time directory reader.
 *
 * Walks a filesystem tree, finds every `<name>/SKILL.md` (depth 1 from the
 * root), and returns an `InitialSkill[]` ready to be passed as `initialSkills` to
 * `createSkillsCapability`. Compatible with Claude/Claude-Code skill
 * directories — the format is the same.
 *
 * Symlinks are explicitly NOT followed: a malicious skill bundle could
 * symlink to `/etc` or escape the root via `..`. Every entry the walker
 * touches below the root — the skill folder, its `SKILL.md`, and every
 * supporting file — is lstat'd first; a symlink is recorded as an error or
 * skipped, never read. The `root` argument itself is the caller's own path
 * and is taken as given.
 *
 * Containment stops at the symlink. A hardlink is an ordinary file and is read
 * as one, and each check is an lstat followed by a read rather than a held
 * handle, so a path swapped between the two is read as whatever it became.
 * Both are accepted: this runs at startup over a tree the app author controls,
 * and closing either means following a path and verifying it, which is the
 * opposite of the rule above.
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { InitialSkill, SkillFile } from "@flow-state-dev/core";
import { parseSkillMd, validateSkillName } from "./skill-md";

export interface ReadSkillsDirectoryOptions {
  /** Optional filter: include only these skill names. */
  include?: string[];
  /** Optional filter: exclude these skill names. */
  exclude?: string[];
  /** Skip files matching these globs (e.g. `["*.swp", ".DS_Store"]`). */
  ignore?: string[];
}

/**
 * Read every `<root>/<skill>/SKILL.md` under `root` and return the bundled
 * folder representation. Throws on I/O errors at the root; per-skill errors
 * are collected into the returned `errors` field instead of throwing so a
 * single malformed skill doesn't poison the whole import.
 */
export async function readSkillsDirectory(
  root: string,
  options: ReadSkillsDirectoryOptions = {},
): Promise<{ skills: InitialSkill[]; errors: Array<{ name: string; error: Error }> }> {
  const include = options.include ? new Set(options.include) : undefined;
  const exclude = new Set(options.exclude ?? []);
  const ignore = new Set([".DS_Store", "Thumbs.db", ...(options.ignore ?? [])]);

  const skills: InitialSkill[] = [];
  const errors: Array<{ name: string; error: Error }> = [];

  let entries: string[];
  try {
    entries = await fs.readdir(root);
  } catch (err) {
    throw new Error(`Failed to read skills directory "${root}": ${(err as Error).message}`);
  }

  for (const entry of entries) {
    if (ignore.has(entry)) continue;
    const folderPath = path.join(root, entry);

    let lstat;
    try {
      lstat = await fs.lstat(folderPath);
    } catch {
      continue;
    }

    // Reject symlinks: the bundle could escape the root or target sensitive paths.
    if (lstat.isSymbolicLink()) {
      errors.push({
        name: entry,
        error: new Error(`Symlinked skill folder "${entry}" — ignored for safety`),
      });
      continue;
    }

    if (!lstat.isDirectory()) continue;
    if (include && !include.has(entry)) continue;
    if (exclude.has(entry)) continue;

    try {
      validateSkillName(entry);
      const skill = await readOneSkillFolder(entry, folderPath, ignore);
      skills.push(skill);
    } catch (err) {
      errors.push({ name: entry, error: err as Error });
    }
  }

  return { skills, errors };
}

async function readOneSkillFolder(
  name: string,
  folderPath: string,
  ignore: Set<string>,
): Promise<InitialSkill> {
  const manifestPath = path.join(folderPath, "SKILL.md");

  // A real folder says nothing about the manifest inside it: a symlinked
  // SKILL.md reaches outside the root exactly as a symlinked folder would.
  // lstat before the read so the link is seen rather than followed.
  let manifestStat;
  try {
    manifestStat = await fs.lstat(manifestPath);
  } catch (err) {
    // Only a genuinely absent file is "missing". Anything else — a permission
    // denial, an I/O failure — is a file the author can see, so reporting it
    // as absent sends them looking for something that is already there.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error(`SKILL.md in "${name}/" could not be read: ${(err as Error).message}`);
    }
    throw new Error(`Missing SKILL.md in "${name}/"`);
  }
  if (manifestStat.isSymbolicLink()) {
    throw new Error(`Symlinked SKILL.md in "${name}/" — ignored for safety`);
  }

  let skillMd: string;
  try {
    skillMd = await fs.readFile(manifestPath, "utf8");
  } catch (err) {
    // Reachable for a directory named SKILL.md, and for anything that changes
    // under us between the lstat above and this read.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error(`SKILL.md in "${name}/" could not be read: ${(err as Error).message}`);
    }
    throw new Error(`Missing SKILL.md in "${name}/"`);
  }

  // Validate up front so a malformed manifest never makes it into the bundle.
  // The folder is the skill's identity; a declared `name` must agree with it.
  parseSkillMd(skillMd, { expectedName: name });

  const files: SkillFile[] = [];
  await collectFiles(folderPath, folderPath, files, ignore);

  return { name, skillMd, files };
}

async function collectFiles(
  root: string,
  current: string,
  out: SkillFile[],
  ignore: Set<string>,
): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(current, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (ignore.has(entry.name)) continue;
    if (entry.name === "SKILL.md" && current === root) continue;

    const full = path.join(current, entry.name);

    // Reject symlinks anywhere in the tree.
    let lstat;
    try {
      lstat = await fs.lstat(full);
    } catch {
      continue;
    }
    if (lstat.isSymbolicLink()) continue;

    if (entry.isDirectory()) {
      await collectFiles(root, full, out, ignore);
      continue;
    }
    if (!entry.isFile()) continue;

    const rel = path.relative(root, full).split(path.sep).join("/");
    // Defense in depth: never let a relative path escape the root.
    if (rel.startsWith("..") || path.isAbsolute(rel)) continue;

    const content = await fs.readFile(full, "utf8");
    out.push({ path: rel, content });
  }
}
