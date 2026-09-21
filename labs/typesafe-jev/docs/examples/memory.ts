/**
 * Teaching excerpt: memory prefer-when-available seam.
 *
 * `@flow-state-dev/memory` does not import this lab. Capture stays on
 * today's observer unless the host passes a classifier. This file only
 * builds the block — the inject lives in the host:
 *
 *   import { system as memorySystem } from "@flow-state-dev/memory";
 *
 *   memorySystem({
 *     model: "openai/gpt-5.4-mini",
 *     working: true,
 *     classifier: createSystemOneMemoryDecision(),
 *   });
 */
import { createSystemOneMemoryDecision } from "../../src/index";

export const classifier = createSystemOneMemoryDecision();
