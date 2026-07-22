// Skills wiring for the research-team example.
//
// The two SKILL.md folders under `./skills` each define their own team in
// `agents:` frontmatter, and they show the different ways to staff an agent:
//
//   - research-company defines its whole team inline — three `prompt-ref`
//     agents whose personas live in the skill folder. Nothing in app code
//     registers them; the team travels with the skill. This is the flagship
//     "a skill defines its own team" case.
//   - competitor-analysis adds the registry form: inline agents (`discoverer`,
//     `comparison-writer`) plus an `analyzer` that references a shared registry
//     agent (`agent-ref` → an app `defineAgent`). See ./agents.ts.
//
// Binding an agent-declaring skill to a generator installs the board-commanded
// delegation surface: a private task board, the task tools (`addTask`/
// `listTasks`/…), and `runBoard` — a real drain over that board. The skill body
// plans the work as tasks (assignee names an agent, deps order them); `runBoard`
// executes the graph with concurrency and dependency gating. The board runs the
// agents — there are no per-agent tools.
//
// `agentRegistry` + `materializeAgent` resolve the two `agent-ref` agents that
// competitor-analysis borrows; the `catalog` carries the leaf tools the inline
// agents reference via `tools:` (search, fetch). Because the agents are LLMs,
// the skill path (the flow's `chat` action) needs an API key — the deterministic
// no-key paths are the code-first board and router (see board.ts / flow.ts).
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSkillsLibrary, readSkillsDirectory } from "@flow-state-dev/orchestration";
import { search } from "@flow-state-dev/tools/search";
import { fetch } from "@flow-state-dev/tools/fetch";
import { agentRegistry, materializeAgent } from "./agents";

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
 * per generator via `uses: [skillsLibrary.with({ ... })]`; a bound skill that
 * declares `agents:` gives that generator its board, the task tools, and
 * `runBoard`. The `catalog` holds the leaf tools inline agents reference by key;
 * `agentRegistry`/`materializeAgent` resolve competitor-analysis's `agent-ref`
 * agents.
 */
export const skillsLibrary = createSkillsLibrary({
  catalog: { search: search(), fetch: fetch() },
  initialSkills: bundledSkills,
  agentRegistry,
  materializeAgent,
  // Session scope keeps the example self-contained — a per-session skill
  // library, no user/org persistence wiring needed.
  scope: "session",
});
