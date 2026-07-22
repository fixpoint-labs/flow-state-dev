// Skills wiring for the research-team example.
//
// The two SKILL.md folders under `./skills` declare their teams as delegation
// `agents:` (FIX-918). Binding an agent-declaring skill to a generator installs
// the board-commanded delegation surface automatically: a private task board,
// the task tools (`addTask`/`listTasks`/…), and `runBoard` — a real drain over
// that board. The skill body plans the work as tasks (assignee names an agent,
// deps order them); `runBoard` executes the graph with concurrency and
// dependency gating. The board runs the agents — there are no per-agent tools.
//
// Each agent is declared with `agent-ref` and resolved through the registry +
// materializer below. To keep the whole example model-free (its tests run with
// no API key), the materializer returns the same deterministic handler workers
// `board.ts` uses instead of building an LLM generator. In a real app you'd use
// `@flow-state-dev/workforce`'s `materializeAgent` (persona + model) or declare
// inline `prompt:`/`prompt-ref:` agents in the SKILL.md — an agent is any block.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSkillsLibrary, readSkillsDirectory } from "@flow-state-dev/orchestration";
import type {
  Agent,
  AgentRegistry,
  BlockDefinition,
  MaterializeAgentFn,
} from "@flow-state-dev/core";
import { analyst, synthesizer } from "./workers";

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

// The example's deterministic team, keyed by the `agent-ref` name each SKILL.md
// uses. Both skills share the same `synthesizer` — identical specs dedupe.
const teamBlocks: Record<string, BlockDefinition> = {
  "market-analyst": analyst("market") as unknown as BlockDefinition,
  "financial-analyst": analyst("financial") as unknown as BlockDefinition,
  "competitor-analyst": analyst("competitor") as unknown as BlockDefinition,
  synthesizer: synthesizer as unknown as BlockDefinition,
};

/** A minimal registry over the team — `agent-ref` names resolve to these. */
const agentRegistry: AgentRegistry = {
  get: async (name: string) =>
    name in teamBlocks ? ({ name, description: name, persona: name } as Agent) : undefined,
  list: async () =>
    Object.keys(teamBlocks).map((name) => ({ name, description: name, persona: name }) as Agent),
};

/**
 * Model-free materializer: return the deterministic handler worker for the
 * resolved agent instead of building an LLM generator. Keeps the example (and
 * its tests) runnable with no API key.
 */
const materializeAgent: MaterializeAgentFn = (agent) =>
  teamBlocks[agent.name] as unknown as ReturnType<MaterializeAgentFn>;

/**
 * A shared skills library preloaded with the bundled research skills. Bind it
 * per generator via `uses: [skillsLibrary.with({ ... })]`; a bound skill that
 * declares `agents:` gives that generator its board, the task tools, and
 * `runBoard`.
 */
export const skillsLibrary = createSkillsLibrary({
  catalog: {},
  initialSkills: bundledSkills,
  agentRegistry,
  materializeAgent,
  // Session scope keeps the example self-contained — a per-session skill
  // library, no user/org persistence wiring needed.
  scope: "session",
});
