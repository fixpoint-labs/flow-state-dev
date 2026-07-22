// Skills wiring for the research-team example.
//
// The two SKILL.md folders under `./skills` declare their teams as delegation
// `workers:` (FIX-918). Binding a worker-declaring skill to a generator
// installs the delegation surface automatically: a private task board, the
// task tools (`addTask`/`listTasks`/…), one callable tool per worker, and
// `runBoard` — a real board drain over that ledger. The skill body tells the
// coordinator how to plan the tasks; `runBoard` executes the graph with
// concurrency and dependency gating. The skill runs the board.
//
// The workers are the same deterministic handlers `board.ts` uses, registered
// here as `block-ref` targets — so activating a skill and draining its board
// needs no model or API key, which is what the tests check. Swap a handler
// for a `generator({ model, prompt })` (or a `prompt:`/`prompt-ref:` worker
// in the SKILL.md) to put an LLM in a seat — a worker is any block.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSkillsLibrary, readSkillsDirectory } from "@flow-state-dev/orchestration";
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

/**
 * A shared skills library preloaded with the bundled research skills. Bind it
 * per generator via `uses: [skillsLibrary.with({ ... })]`; a bound skill that
 * declares `workers:` gives that generator its board, worker tools, and
 * `runBoard`.
 */
export const skillsLibrary = createSkillsLibrary({
  catalog: {},
  initialSkills: bundledSkills,
  // The skills' `block-ref:` workers resolve against this registry. Both
  // skills share the same synthesizer — identical worker specs dedupe.
  blocks: {
    "market-analyst": analyst("market"),
    "financial-analyst": analyst("financial"),
    "competitor-analyst": analyst("competitor"),
    synthesizer,
  },
  // Session scope keeps the example self-contained — a per-session skill
  // library, no user/org persistence wiring needed.
  scope: "session",
});
