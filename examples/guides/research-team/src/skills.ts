// Skills wiring for the research-team example.
//
// The two SKILL.md folders under `./skills` each define their own team in
// `agents:` frontmatter. Every agent on both teams is a `prompt-ref` agent
// whose persona lives in the skill folder — nothing in app code registers
// them, so each team travels with its skill.
//
// Binding an agent-declaring skill to a generator installs the board-commanded
// delegation surface: a private task board, the task tools (`addTask`/
// `listTasks`/…), and `runBoard` — a real drain over that board. The skill body
// plans the work as tasks (assignee names an agent, deps order them); `runBoard`
// executes the graph with concurrency and dependency gating. The board runs the
// agents — there are no per-agent tools.
//
// The `catalog` carries the leaf tools the agents reference from their
// prompt-file frontmatter `tools:` (search, fetch). Because the agents are LLMs
// that call `search`, the skill path (the flow's `chat` action) needs two keys:
// a model key, and one search-provider key — `search` throws when no provider is
// configured, while `fetch` falls through to a builtin and needs none. The
// deterministic no-key paths are the code-first board and router (see board.ts /
// flow.ts).
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSkillsLibrary, readSkillsDirectory } from "@flow-state-dev/orchestration";
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
 * A shared skills library preloaded with the bundled research skills. Bind it
 * per generator via `uses: [skillsLibrary.with({ ... })]`; a bound skill that
 * declares `agents:` gives that generator its board, the task tools, and
 * `runBoard`. The `catalog` holds the leaf tools the agents reference by key.
 */
export const skillsLibrary = createSkillsLibrary({
  catalog: { search: search(), fetch: fetch() },
  initialSkills: bundledSkills,
  // Session scope keeps the example self-contained — a per-session skill
  // library, no user/org persistence wiring needed.
  scope: "session",
});
