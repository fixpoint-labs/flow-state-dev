// Skills wiring for the research-team example.
//
// The two SKILL.md folders under `./skills` describe the same team as a
// `pattern: task-board` skill — one static (research-company), one that fans
// out at runtime via a discoverer worker calling addTask (competitor-analysis).
//
// `readSkillsDirectory` parses those folders into skill definitions;
// `createSkillsCapability` turns them into a `runSkill` tool + context that any
// generator can carry via `uses: [skillsCapability]`. `defaultPatternRegistry`
// is what lets `pattern:` skills dispatch a board; the workers declare
// `tools: [search, fetch]`, so the catalog wires those tool blocks.
//
// The worker prompts call a model, so dispatching a skill live needs an API key
// (see the flow's `chat` action). Loading and parsing the skills needs neither
// a model nor a key, which is what `test/flow.test.ts` checks.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSkillsCapability, readSkillsDirectory } from "@flow-state-dev/orchestration";
import { defaultPatternRegistry } from "@flow-state-dev/patterns";
import { search } from "@flow-state-dev/tools/search";
import { fetch } from "@flow-state-dev/tools/fetch";

/** Absolute path to the bundled `SKILL.md` folders. */
export const skillsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "skills",
);

const { skills: bundledSkills, errors } = await readSkillsDirectory(skillsDir);
for (const { name, error } of errors) {
  console.warn(`[research-team] skill "${name}" failed to load:`, error.message);
}

/** The parsed skill definitions, exported so tests can assert they loaded. */
export { bundledSkills };

/**
 * A skills capability preloaded with the bundled research skills. Drop it into
 * any generator via `uses: [skillsCapability]` and the model can dispatch a
 * team with `runSkill({ name, input })`.
 */
export const skillsCapability = createSkillsCapability({
  // Catalog: the string tool keys the skill workers reference (`tools:`).
  catalog: { search: search(), fetch: fetch() },
  initialSkills: bundledSkills,
  // Session scope keeps the example self-contained — a per-session skill
  // library, no user/org persistence wiring needed.
  scope: "session",
  // Required for `pattern:` skills to dispatch a board; also composes the
  // `taskTools` surface (addTask/…) that the competitor-analysis discoverer
  // uses to fan out at runtime.
  patternRegistry: defaultPatternRegistry,
});
