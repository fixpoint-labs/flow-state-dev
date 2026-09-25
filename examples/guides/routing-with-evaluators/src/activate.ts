// Step 3 of the guide: the skill activator with an evaluator for its third
// tier. Slash commands and keywords still resolve first; only a message
// neither matches reaches the evaluator, and its pick is final.
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { EvaluationModel } from "@flow-state-dev/core";
import {
  createSkillActivator,
  readSkillsDirectory,
  skillEvaluator,
} from "@flow-state-dev/orchestration";

const skillsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "skills");

const { skills: initialSkills, errors } = await readSkillsDirectory(skillsDir);
for (const { name, error } of errors) {
  console.warn(`[routing-with-evaluators] skill "${name}" failed to load:`, error.message);
}

/** The parsed `SKILL.md` catalog, exported so tests can assert it loaded. */
export { initialSkills };

/**
 * The activator. With a model, tier 3 asks an evaluator on it. Without one,
 * the activator is built exactly as it would be with no `evaluator` option,
 * and no evaluator block exists.
 */
export function skillActivator(model?: string | EvaluationModel) {
  if (model === undefined) return createSkillActivator({ initialSkills });
  return createSkillActivator({
    initialSkills,
    evaluator: skillEvaluator(model),
  });
}
