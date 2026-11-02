/**
 * Goal check — claude-code-harness › loads a trusted repo's conventions with hooks off.
 * The contract is `goal.md`; this is its runnable form.
 *
 * A fresh git repository holds a `CLAUDE.md` with a code word made for this
 * run, one project skill, and a project hook that writes a marker file on
 * every prompt. Two real Claude Code turns run in it through `claudeCodeAgent`
 * with `settingSources: ["project"]` and `settings: { disableAllHooks: true }`:
 * one asks for the code word with every file and shell tool off, so only a
 * loaded `CLAUDE.md` can answer; one asks whether the skill is listed. Graded on
 * the answers and on the marker file, never on the options the block built.
 *
 * Run:      pnpm tsx goals/claude-code-harness/loads-a-trusted-repos-conventions-with-hooks-off/run.mts
 * Controls: GOAL_CONTROL=hooks-on  (no `settings`; must FAIL hooks:off)
 *           GOAL_CONTROL=untrusted (`settingSources: []`; must FAIL conventions:code-word)
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { claudeCodeAgent, type SdkAgentHandle } from "@flow-state-dev/claude-code/sdk";
import { testBlock } from "@flow-state-dev/testing";
import { runGoal } from "../../lib/index.mts";

const CONTROL = process.env.GOAL_CONTROL ?? "";
const CONTROLS = ["hooks-on", "untrusted"];
if (CONTROL !== "" && !CONTROLS.includes(CONTROL)) {
  throw new Error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${CONTROLS.join(", ")}`);
}

/** Every tool that could read the code word off disk instead of out of loaded instructions. */
const READING_TOOLS = ["Read", "Grep", "Glob", "Bash", "Task", "Agent", "NotebookRead", "WebFetch"];

/** A repository a trusting host would point a run at: conventions, a skill, and a hook. */
function scratchRepo(word: string): { dir: string; marker: string } {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "trusted-repo-goal-")));
  execFileSync("git", ["init", "-q", "."], { cwd: dir });
  writeFileSync(
    join(dir, "CLAUDE.md"),
    `The code word for this repository is ${word}. When asked for the code word, answer with it exactly.\n`,
  );
  mkdirSync(join(dir, ".claude/skills/zebra-check"), { recursive: true });
  writeFileSync(
    join(dir, ".claude/skills/zebra-check/SKILL.md"),
    "---\nname: zebra-check\ndescription: Checks zebras. Use when asked about zebras.\n---\nSay ZEBRA.\n",
  );
  const marker = join(dir, "HOOK_RAN");
  writeFileSync(
    join(dir, ".claude/settings.json"),
    JSON.stringify({
      hooks: {
        UserPromptSubmit: [{ hooks: [{ type: "command", command: `touch ${marker}` }] }],
        SessionStart: [{ hooks: [{ type: "command", command: `touch ${marker}` }] }],
      },
    }),
  );
  return { dir, marker };
}

/** One real turn in `dir`; the run's closing answer, or why it had none. */
async function ask(dir: string, prompt: string, disallowedTools: string[]): Promise<string> {
  const block = claudeCodeAgent({
    cwd: () => dir,
    settingSources: CONTROL === "untrusted" ? [] : ["project"],
    ...(CONTROL === "hooks-on" ? {} : { settings: { disableAllHooks: true } }),
    disallowedTools,
    maxTurns: 3,
  });
  const { error, output } = await testBlock(block, { input: { prompt } });
  if (error) return `(run failed: ${String(error.message).slice(0, 200)})`;
  return String((output as SdkAgentHandle | undefined)?.finalMessage ?? "(no answer)").trim();
}

await runGoal(async (failures) => {
  const word = `WORD-${randomBytes(4).toString("hex").toUpperCase()}`;
  const { dir, marker } = scratchRepo(word);
  try {
    const wordAnswer = await ask(
      dir,
      "Without using any tool, what is the code word for this repository? Reply with only the code word, or NONE.",
      READING_TOOLS,
    );
    const skillAnswer = await ask(
      dir,
      "Without using any tool: is a skill named zebra-check listed as available to you? Reply YES or NO only.",
      READING_TOOLS,
    );
    const hookRan = existsSync(marker);
    if (!wordAnswer.includes(word)) {
      failures.push(`conventions:code-word — asked with no reading tool, the run answered "${wordAnswer}", not ${word}`);
    }
    if (!/\bYES\b/i.test(skillAnswer)) {
      failures.push(`conventions:skill — the run answered "${skillAnswer}" when asked whether zebra-check is listed`);
    }
    if (hookRan) failures.push("hooks:off — the repository's hook ran: the marker file exists after two turns");
    return {
      failures,
      evidence:
        `two real turns in a fresh repository${CONTROL ? ` (control ${CONTROL})` : ""}: ` +
        `code word ${word} → "${wordAnswer}" · skill listed → "${skillAnswer}" · hook marker ${hookRan ? "present" : "absent"}`,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
