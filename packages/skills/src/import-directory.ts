/**
 * Runtime importer — read a skills directory at runtime and write it into
 * an existing skills collection. Useful for in-process migrations and tests.
 *
 * For app startup, prefer `readSkillsDirectory` + `initialSkills` on
 * `createSkillsCapability` — that path goes through the idempotent seeding
 * mechanism that respects user deletions.
 */

import type { ResourceCollectionRef } from "@flow-state-dev/core/types";
import type { InitialSkill } from "@flow-state-dev/core";
import { readSkillsDirectory } from "./read-directory";
import { skillFileKey, skillManifestKey } from "./collection";
import { parseSkillMd } from "./skill-md";

export interface ImportSkillsDirectoryOptions {
  /** Overwrite existing entries. Default `false` (skip name collisions). */
  overwrite?: boolean;
}

export interface ImportSkillsDirectoryResult {
  imported: string[];
  skipped: Array<{ name: string; reason: string }>;
  errors: Array<{ name: string; error: Error }>;
}

/**
 * Read every skill from `root` and write it into `collection`. Returns
 * the imported names plus per-skill skip/error reasons.
 */
export async function importSkillsDirectory(
  root: string,
  collection: ResourceCollectionRef,
  options: ImportSkillsDirectoryOptions = {},
): Promise<ImportSkillsDirectoryResult> {
  const overwrite = options.overwrite ?? false;
  const { skills, errors } = await readSkillsDirectory(root);

  const imported: string[] = [];
  const skipped: Array<{ name: string; reason: string }> = [];
  const writeErrors: Array<{ name: string; error: Error }> = [...errors];

  for (const skill of skills) {
    try {
      const exists = collection.getOptional(skillManifestKey(skill.name));
      if (exists && !overwrite) {
        skipped.push({ name: skill.name, reason: "already exists" });
        continue;
      }
      await writeSkill(collection, skill);
      imported.push(skill.name);
    } catch (err) {
      writeErrors.push({ name: skill.name, error: err as Error });
    }
  }

  return { imported, skipped, errors: writeErrors };
}

async function writeSkill(
  collection: ResourceCollectionRef,
  skill: InitialSkill,
): Promise<void> {
  const parsed = parseSkillMd(skill.skillMd);
  const manifestKey = skillManifestKey(skill.name);
  const stateRecord = parsed.state as unknown as Record<string, unknown>;
  const existing = collection.getOptional(manifestKey);
  if (existing) {
    await existing.setState({ ...stateRecord } as never);
    await existing.writeContent(skill.skillMd);
  } else {
    const ref = await collection.create(manifestKey, stateRecord as never);
    await ref.writeContent(skill.skillMd);
  }

  for (const file of skill.files ?? []) {
    const key = skillFileKey(skill.name, file.path);
    const existingFile = collection.getOptional(key);
    if (existingFile) {
      await existingFile.writeContent(file.content);
    } else {
      const ref = await collection.create(key);
      await ref.writeContent(file.content);
    }
  }
}
