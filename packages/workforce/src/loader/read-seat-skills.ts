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
import { type PathReport, openStructuralDirectory } from "./structural-directory";

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
   * have seen twice.
   *
   * Collected rather than thrown, so one bad folder does not cost a seat its
   * other skills. Treating a non-empty `errors` as fatal is the caller's call
   * to make explicitly, and it is usually the right one: every entry is a skill
   * the seat was supposed to have.
   */
  errors: PathReport[];
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
  const errors: PathReport[] = [];
  // Where each name came from, in read order, so a contested one can name every
  // file in play rather than just the two the author happened to write first.
  const sources = new Map<string, { paths: string[]; skills: InitialSkill[] }>();

  for (const level of [
    "org/skills",
    `teams/${team}/skills`,
    `teams/${team}/workers/${worker}/skills`,
  ]) {
    const dir = path.join(root, ...level.split("/"));
    // Gate the level through the shared primitive: it is what keeps an absent
    // folder silent, a symlinked one refused, and an unreadable one reported.
    if ((await openStructuralDirectory(dir, level, errors)) === undefined) continue;

    const { skills, errors: perSkill } = await readSkillsDirectory(dir);

    for (const { name, error } of perSkill) {
      errors.push({ path: `${level}/${name}`, error });
    }

    for (const skill of skills) {
      const where = `${level}/${skill.name}`;
      if (declaresScope(skill)) {
        errors.push({
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
      path: paths[paths.length - 1]!,
      error: new Error(duplicateSkillNameMessage(name, worker, paths)),
    });
  }

  return { skills: assembled, errors };
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
  if (yaml.trim().length === 0) return false;
  return Object.hasOwn(parseFrontmatterYaml(yaml), REFUSED_SKILL_SCOPE_KEY);
}
