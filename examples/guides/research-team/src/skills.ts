// Skills wiring for the research-team example.
//
// The two SKILL.md folders under `./skills` describe the same team as inline
// skills that expose a task board as a single callable tool (FIX-918 removed
// `pattern:` mode). `research-company` runs a static market + financial +
// synthesis board; `competitor-analysis` fans out one analyzer per competitor.
// Both boards live in `./skill-boards.ts` as `taskBoard(...).drain` blocks and
// are registered in the catalog below, so a skill lists its board under
// `allowed-tools` and the coordinator calls it as one tool.
//
// `readSkillsDirectory` parses those folders into skill definitions;
// `createSkillsLibrary` turns them into a shared catalog a generator binds to
// via `uses: [skillsLibrary.with({ ... })]`.
//
// The boards' workers are deterministic handlers, so dispatching a skill needs
// no model or API key — loading, parsing, and draining all run offline, which
// is what the tests check.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSkillsLibrary, readSkillsDirectory } from "@flow-state-dev/orchestration";
import { search } from "@flow-state-dev/tools/search";
import { fetch } from "@flow-state-dev/tools/fetch";
import { researchCompany, analyzeCompetitors } from "./skill-boards";

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
 * A shared skills library preloaded with the bundled research skills. Bind it
 * per generator via `uses: [skillsLibrary.with({ ... })]` and the model can
 * activate a skill, then call its drain-as-tool (`researchCompany` /
 * `analyzeCompetitors`) to run the team.
 */
export const skillsLibrary = createSkillsLibrary({
  // Catalog: the string tool keys the skills reference via `allowed-tools` —
  // the leaf web tools plus the two board-backed team tools.
  catalog: {
    search: search(),
    fetch: fetch(),
    researchCompany,
    analyzeCompetitors,
  },
  initialSkills: bundledSkills,
  // Session scope keeps the example self-contained — a per-session skill
  // library, no user/org persistence wiring needed.
  scope: "session",
});
