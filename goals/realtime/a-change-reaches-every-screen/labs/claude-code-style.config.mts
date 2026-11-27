/**
 * The Claude Code-style lab as the closure's j2-claude-code-style scene
 * serves it: the lab's own host (`labs/claude-code-style/host.mts`) on its own
 * workers, read from the environment as the lab's own config reads it, with
 * only the model scripted (`scripts.mts`) and every coding worker on
 * harness-manager's scripted coder. The run serves it twice with `fsdev dev
 * --config`, and swaps the host's store line to Postgres as each process
 * loads it (`run.mts`).
 */
import { mkdirSync, realpathSync } from "node:fs";
import { delimiter, resolve } from "node:path";
import { openClaudeCodeStyle } from "../../../../labs/claude-code-style/host.mts";
import { labModels } from "./scripts.mts";

const need = (key: string) => {
  const value = process.env[key];
  if (value === undefined || value === "") throw new Error(`j2-claude-code-style lab: ${key} is unset`);
  return value;
};

const data = resolve(need("CLAUDE_CODE_STYLE_DATA"));
mkdirSync(data, { recursive: true });

/** A session's title, as the lab's tests title one: the first line of its first message. */
const firstLineOf = (said: string) => {
  const first = (JSON.parse(said) as { role: string; content: unknown }[]).find((message) => message.role === "user");
  return typeof first?.content === "string" ? first.content.split("\n")[0]!.trim() : "Untitled";
};

const { flowState } = await openClaudeCodeStyle({
  data,
  userId: need("CLAUDE_CODE_STYLE_USER"),
  model: "test/scripted",
  utilityModel: "test/utility",
  repositories: need("CLAUDE_CODE_STYLE_REPOSITORIES").split(delimiter).map((path) => realpathSync(path)),
  modelResolver: labModels(/You are main[,.]/i, "desk.coder", { "auto-title:generate": ({ said }) => ({ output: { title: firstLineOf(said) } }) }),
  scriptedStepMs: 50,
});

export default flowState;
