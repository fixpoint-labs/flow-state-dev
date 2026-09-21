/**
 * Teaching excerpt: skill-activator tier 3 via optional classifier inject.
 *
 * Slash and keyword stay orchestration's. This lab replaces only tier 3.
 * Orchestration does not import the lab. Optional = model capability.
 */
import { createSkillActivator } from "@flow-state-dev/orchestration";
import { createSystemOneSkillClassifier } from "../../src/index";

export const activator = createSkillActivator({
  classifier: createSystemOneSkillClassifier(),
});
