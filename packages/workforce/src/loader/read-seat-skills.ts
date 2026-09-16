/**
 * Read one seat's skills — the union of the levels that seat can see.
 *
 * A skills folder is the same folder wherever it sits: a directory of
 * `<name>/SKILL.md`, read by `readSkillsDirectory`. What this module adds is
 * *which* folders one seat draws from — the org's, its own team's, and any
 * sitting beside the worker itself — and the two refusals that only make sense
 * once a seat draws from more than one.
 *
 * Reading per seat is what makes teams isolated. Two teams may each have a
 * `review`; neither seat's set holds the other's, because neither seat read it.
 * Isolation is therefore a property of what was read, not of what anything is
 * named: skill names stay bare, and the `SKILL.md` format is untouched.
 *
 * This module reads folders and nothing else. Registering a seat's set as a
 * live catalog — binding its `skills:` list, its own folder, and any default
 * skill to a running seat — belongs to the layer that builds seats.
 *
 * Node-only (`node:fs` by way of the readers), which is why it ships behind the
 * `./loader` subpath rather than the package root.
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { InitialSkill } from "@flow-state-dev/core";
import {
  parseFrontmatterYaml,
  readSkillsDirectory,
  splitFrontmatter,
} from "@flow-state-dev/orchestration";
import {
  REFUSED_SKILL_SCOPE_KEY,
  REFUSED_SKILL_SCOPE_KEY_MESSAGE,
  duplicateSkillNameMessage,
} from "../manifest";
import { validateSegment } from "./segments";
import {
  type PathReport,
  classify,
  openStructuralDirectory,
  refusedSymlink,
} from "./structural-directory";

/**
 * Why one thing that should have reached the seat did not — the discriminant on
 * every entry in {@link ReadSeatSkillsResult.errors}.
 *
 * Six conditions land in one flat array, and a caller that wants to tolerate
 * one class while refusing another needs to tell them apart without matching on
 * `error.message`. That is all this is for: the message text is unchanged, and
 * every entry still carries the `path` it always did.
 */
export type SeatSkillErrorKind =
  /** A level's `skills/` folder is there and could not be listed — every skill under it is missing. */
  | "unlistable-level"
  /** A folder between the root and a level is a symlink, so nothing below it was read. Reported once, under that folder's path. */
  | "refused-symlinked-ancestor"
  /** A level's own `skills/` folder is a symlink, so the level was not read. */
  | "refused-symlinked-level"
  /** One skill folder inside a level did not load — an unusable name, a symlinked folder, or a missing, unreadable or malformed `SKILL.md`. */
  | "skill-load-failed"
  /** A `SKILL.md` declares the refused `scope:` key, so that skill is left out of the set. */
  | "refused-scope-key"
  /** One name reached the seat from more than one of its levels, so the name is left out of the set entirely. */
  | "duplicate-skill-name";

/**
 * One thing that should have reached the seat and did not — the entries in
 * {@link ReadSeatSkillsResult.errors}.
 *
 * Five of the six conditions fail at a single path, and `path` is that path.
 * The sixth does not: a contested name fails at every level it reached the seat
 * from, and none of those copies loaded. So that variant carries `paths` — all
 * of them, in read order — and a caller reaching for the files in play no
 * longer has to parse them back out of the message, which is where they used to
 * be the only copy.
 *
 * `path` on that variant is `paths[0]`, the level the name first reached the
 * seat from. It is a key, not a winner: reports here are keyed and ordered by
 * where a condition was first observed, and this one follows that rule like the
 * rest. Keying it by the innermost level instead names the deepest copy, which
 * reads as the one that took precedence — and precedence is the thing this
 * refusal exists to deny.
 */
export type SeatSkillError =
  | PathReport<Exclude<SeatSkillErrorKind, "duplicate-skill-name">>
  | (PathReport<"duplicate-skill-name"> & {
      /**
       * Every path the name reached this seat from, in read order — org, then
       * team, then the seat's own. Two or more, and every one of them was left
       * out of the set.
       */
      paths: string[];
    });

/** Which seat to read for. Both segments name folders in the tree. */
export interface ReadSeatSkillsOptions {
  /** The team the seat belongs to — `teams/<team>/`. */
  team: string;
  /** The worker's own folder — `teams/<team>/workers/<worker>/`. */
  worker: string;
}

/** What {@link readSeatSkills} hands back. */
export interface ReadSeatSkillsResult {
  /**
   * The seat's skills, in level order: org first, then its team, then its own.
   * The same records `readSkillsDirectory` returns, and the same records
   * `initialSkills` takes — there is no seat-shaped skill record.
   *
   * A name this seat would have seen twice is absent from here entirely. It is
   * reported in {@link errors} instead, because handing back one of two files
   * under a contested name is the silent resolution this refusal exists to
   * remove.
   */
  skills: InitialSkill[];
  /**
   * One entry per thing that should have reached the seat and did not, keyed by
   * its slash-separated path relative to `root` — a level that could not be
   * listed, a skill folder that could not be read, or a name the seat would
   * have seen twice. Which of those it is, is on the entry's `kind`; see
   * {@link SeatSkillErrorKind}. Narrow on it: a `duplicate-skill-name` entry
   * also carries `paths`, the every-level list a collision needs and the other
   * five conditions have nothing to put in.
   *
   * Collected rather than thrown, so one bad folder does not cost a seat its
   * other skills. Treating a non-empty `errors` as fatal is the caller's call
   * to make explicitly, and it is usually the right one: every entry is a skill
   * the seat was supposed to have.
   */
  errors: SeatSkillError[];
}

/**
 * Read the skills one seat can see: `<root>/org/skills`,
 * `<root>/teams/<team>/skills`, and `<root>/teams/<team>/workers/<worker>/skills`.
 *
 * A skill beside the worker is included without being listed anywhere — the
 * folder already says whose it is.
 *
 * A level that is absent is not an error: an app may keep no org skills, and a
 * seat may have none of its own. A level that exists and cannot be listed is.
 *
 * Throws only when `root` itself cannot be read — a configured root that does
 * not exist is a wiring mistake, not a per-level one, and reading it as three
 * absent levels would hand back an empty set with an empty `errors`, which is
 * the shape of a seat that has no skills on purpose. Matches the sibling
 * reader, which answered this question first.
 *
 * @example
 * const { skills, errors } = await readSeatSkills("./workforce", {
 *   team: "pentest",
 *   worker: "recon",
 * });
 */
export async function readSeatSkills(
  root: string,
  { team, worker }: ReadSeatSkillsOptions,
): Promise<ReadSeatSkillsResult> {
  // Both arguments become path segments, so they are held to the same rules as
  // the folders they name. Thrown rather than collected: a segment that breaks
  // them names no seat, so there is no seat to report against — and one
  // carrying `..` would read a folder the caller never configured.
  validateSegment(team, "Team");
  validateSegment(worker, "Worker");

  // The levels below are each allowed to be absent, so nothing further down
  // can tell a missing root from a tree that simply keeps no skills. Checked
  // here, once, in the sibling reader's words.
  try {
    await fs.readdir(root);
  } catch (err) {
    throw new Error(
      `Failed to read workforce directory "${root}": ${(err as Error).message}`,
    );
  }

  const errors: SeatSkillError[] = [];
  // Structural folders already refused, so a shared one — `teams`, the team's
  // own folder — is reported once rather than once per level beneath it.
  const refused = new Set<string>();
  // Where each name came from, in read order, so a contested one can name every
  // file in play rather than just the two the author happened to write first.
  const sources = new Map<string, { paths: string[]; skills: InitialSkill[] }>();

  for (const level of [
    "org/skills",
    `teams/${team}/skills`,
    `teams/${team}/workers/${worker}/skills`,
  ]) {
    const dir = path.join(root, ...level.split("/"));
    // The level is jumped to rather than walked down to, so every folder above
    // it has to be classified here — `lstat` answers for the final component
    // alone, and the OS quietly resolves the rest. Without this a symlinked
    // `teams/` is followed and the level loads from outside the root.
    if (await refusedOnTheWay(root, level, errors, refused)) continue;

    // Gate the level through the shared primitive: it is what keeps an absent
    // folder silent, a symlinked one refused, and an unreadable one reported.
    const opened = await openStructuralDirectory(dir, level);
    if (opened.refusal !== undefined) {
      errors.push({
        kind:
          opened.refusal.reason === "symlink"
            ? "refused-symlinked-level"
            : "unlistable-level",
        path: level,
        error: opened.refusal.error,
      });
    }
    if (opened.entries === undefined) continue;

    const { skills, errors: perSkill } = await readSkillsDirectory(dir);

    for (const { name, error } of perSkill) {
      // The shared reader reports one failure per skill folder without saying
      // which — a symlinked folder and a malformed `SKILL.md` arrive the same
      // way — so they land here under one kind rather than being told apart by
      // re-reading the message this change exists to stop callers parsing.
      errors.push({ kind: "skill-load-failed", path: `${level}/${name}`, error });
    }

    for (const skill of skills) {
      const where = `${level}/${skill.name}`;
      if (declaresScope(skill)) {
        errors.push({
          kind: "refused-scope-key",
          path: where,
          error: new Error(`SKILL.md in "${where}/" ${REFUSED_SKILL_SCOPE_KEY_MESSAGE}`),
        });
        continue;
      }
      const seen = sources.get(skill.name);
      if (seen === undefined) {
        sources.set(skill.name, { paths: [where], skills: [skill] });
      } else {
        seen.paths.push(where);
        seen.skills.push(skill);
      }
    }
  }

  const assembled: InitialSkill[] = [];
  for (const [name, { paths, skills }] of sources) {
    if (paths.length === 1) {
      assembled.push(skills[0]!);
      continue;
    }
    errors.push({
      kind: "duplicate-skill-name",
      // Keyed by where the name was first seen, like every other report here.
      // Every copy is in `paths`, and not one of them is the copy that won.
      path: paths[0]!,
      paths: [...paths],
      error: new Error(duplicateSkillNameMessage(name, worker, paths)),
    });
  }

  return { skills: assembled, errors };
}

/**
 * Whether a symlink stands between `root` and one level, refusing it if so.
 *
 * Walks the level's own folders — `org`, `teams`, `teams/<team>`, and the rest
 * — leaving the `skills/` folder at the end to `openStructuralDirectory`, which
 * already classifies what it is handed. Only symlinks are refused here: an
 * absent or unreadable folder above a level already reaches the caller through
 * that level's own report, and re-deriving it would say the same thing twice.
 *
 * Reported rather than thrown, which is the sibling reader's answer for the
 * same folders: `teams` and a team's folder are structural and shared, so one
 * that is refused is a level that cannot be read — not a call that names no
 * seat, which is what the thrown segment rules are for.
 */
async function refusedOnTheWay(
  root: string,
  level: string,
  errors: SeatSkillError[],
  refused: Set<string>,
): Promise<boolean> {
  const components = level.split("/");

  for (let depth = 1; depth < components.length; depth++) {
    const ancestor = components.slice(0, depth);
    const reportAs = ancestor.join("/");
    if (refused.has(reportAs)) return true;

    if ((await classify(path.join(root, ...ancestor))).kind === "symlink") {
      refused.add(reportAs);
      errors.push({
        kind: "refused-symlinked-ancestor",
        path: reportAs,
        error: refusedSymlink("directory", reportAs),
      });
      return true;
    }
  }

  return false;
}

/**
 * Whether a `SKILL.md` declares the one key this door refuses.
 *
 * Read off the raw text rather than through the skill parser, because that
 * parser deliberately carries a key it does not know straight through — which
 * is exactly how `scope:` came to be writable, wrong, and silent.
 */
function declaresScope(skill: InitialSkill): boolean {
  const { yaml } = splitFrontmatter(skill.skillMd);
  return Object.hasOwn(parseFrontmatterYaml(yaml), REFUSED_SKILL_SCOPE_KEY);
}
