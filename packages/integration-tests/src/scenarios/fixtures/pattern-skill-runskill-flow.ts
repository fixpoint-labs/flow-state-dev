/**
 * Pattern-skill runSkill dispatch fixture (bisection step 4).
 *
 * Mirrors production's full dispatch chain: an outer `assistant` generator
 * with `uses: [skillsCap]` invokes `runSkill` which routes through
 * `skillPatternRun` → the materialized `taskBoard` (returned directly)
 * containing a `discoverer` worker.
 *
 * The skill is declared inline (one `SKILL.md` string + the
 * `defaultPatternRegistry`) so the test exercises every layer of the
 * skill-pattern materialization path without filesystem deps. Worker
 * dispatch falls through to the same materializeWorker path the
 * kitchen-sink uses.
 */
import { defineFlow, generator, sequencer } from "@flow-state-dev/core";
import { defaultPatternRegistry } from "@flow-state-dev/patterns";
import { createSkillsCapability } from "@flow-state-dev/skills";
import { z } from "zod";

const inputSchema = z.object({ message: z.string() });

// Inline pattern skill — taskTools is composed automatically because
// patternRegistry is wired on the skills capability below. The
// discoverer's `prompt:` body never reaches the LLM (we mock the
// generator by name); the substrate uses it for materialization.
const PATTERN_SKILL_MD = `---
description: Test pattern skill — discoverer fans out analyzer tasks.
pattern: task-board
workers:
  discoverer:
    prompt: "You are the discoverer. Call addTask once per competitor, then return a one-line summary."
    tools: [taskTools]
    agent-type: sub
initial-tasks:
  - id: discover
    goal: Discover competitors and enqueue analyzers
    assignee: discoverer
pattern-config:
  concurrency: 4
  on-idle: complete
---

Test pattern skill body.
`;

const skillsCap = createSkillsCapability({
  scope: "session",
  initialSkills: [{ name: "test-discoverer", skillMd: PATTERN_SKILL_MD }],
  patternRegistry: defaultPatternRegistry,
  agentType: "primary"
});

const assistant = generator({
  name: "rs-assistant",
  model: "intent/chat",
  prompt: "Call runSkill with name 'test-discoverer' when asked.",
  inputSchema,
  user: (input) => input.message,
  outputSchema: z.string(),
  uses: [skillsCap],
  agentType: "primary",
  maxIterations: 4
});

const pipeline = sequencer({
  name: "pattern-skill-runskill-pipeline",
  inputSchema
}).step(assistant);

const flow = defineFlow({
  kind: "test-pattern-skill-runskill",
  requireUser: true,
  actions: {
    run: {
      inputSchema,
      block: pipeline,
      userMessage: (input) => input.message
    }
  }
});

export default flow({ id: "default" });
