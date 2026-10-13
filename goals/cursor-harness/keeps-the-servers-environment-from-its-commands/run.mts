/**
 * Goal check — cursor-harness › it keeps the server's environment from its commands.
 *
 * Two real Cursor runs in a throwaway directory, each told to run one shell
 * command that prints a variable planted in this process. The control runs with
 * `env` unset and must see it; the fenced run sets `env` and must not find it in
 * its command's own environment. Graded on the run's items, which is what the
 * stream carried, not on what the model says. What a same-user command could dig
 * out of `/proc` is out of scope: `env` is not a security boundary.
 *
 * Run: CURSOR_API_KEY=… pnpm tsx goals/cursor-harness/keeps-the-servers-environment-from-its-commands/run.mts
 * Control: GOAL_CONTROL=ignore-env (the fenced leg runs with env unset; f:fenced must FAIL)
 */
import { randomUUID } from "node:crypto";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { harnessEnv } from "@flow-state-dev/core";
import { cursorAgent } from "@flow-state-dev/cursor";
import { testBlock } from "@flow-state-dev/testing";
import { loadFixture, runGoal } from "../../lib/index.mts";

interface Fixture {
  variable: string;
  model: string;
}

const fixture = loadFixture<Fixture>(import.meta.url);
const control = process.env.GOAL_CONTROL;
if (control !== undefined && control !== "ignore-env") {
  throw new Error(`unknown GOAL_CONTROL ${control}; this goal understands ignore-env`);
}
if (!process.env.CURSOR_API_KEY) throw new Error("CURSOR_API_KEY is required: this goal runs real Cursor.");

const token = `canary-${randomUUID()}`;
process.env[fixture.variable] = token;

/** Run one real Cursor turn; return its items as text and whether a shell step settled. */
async function runOnce(env: Record<string, string> | undefined) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "cursor-env-goal-")));
  const block = cursorAgent({
    cwd: () => dir,
    agent: { model: { id: fixture.model }, mode: "agent" },
    ...(env !== undefined ? { env } : {}),
  });
  const { error, items } = await testBlock(block, {
    input: {
      prompt:
        `Run exactly this shell command once, in this directory, and then stop: printf '%s' "$${fixture.variable}"\n` +
        "Do not edit any file.",
    },
  });
  const text = JSON.stringify(items);
  const ranShell = items.some(
    (item) =>
      (item as { type?: string }).type === "tool_output" && /printf/.test(JSON.stringify(item)),
  );
  return { error, text, ranShell };
}

await runGoal(async (failures) => {
  const c = await runOnce(undefined);
  if (c.error !== null) failures.push(`c:control: the run failed: ${c.error.message}`);
  if (!c.text.includes(token)) {
    failures.push("c:control: the unfenced run's items do not contain the token, so Cursor never showed running the command");
  }

  const fencedEnv =
    control === "ignore-env" ? undefined : harnessEnv({ pass: ["PATH", "HOME", "CURSOR_API_KEY"] });
  const f = await runOnce(fencedEnv);
  if (f.error !== null) failures.push(`f:fenced: the run failed: ${f.error.message}`);
  if (!f.ranShell) failures.push("f:fenced: no shell step settled, so an empty answer would prove nothing");
  if (f.text.includes(token)) failures.push("f:fenced: the token reached the fenced run's items");

  return {
    failures,
    evidence: `control saw the token; fenced run (${f.ranShell ? "shell step settled" : "no shell step"}) did not`,
  };
});
