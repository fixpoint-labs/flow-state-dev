/**
 * Goal check — kitchen-sink-harness › a trusted session follows the repo.
 * The contract, controls and verdict log are `goal.md`; this is its runnable form.
 *
 * A fresh repository holds a `CLAUDE.md` with a code word made for this run,
 * one project skill, and project hooks that write a marker file outside the
 * checkout. Kitchen Sink's own Claude Code session flow (`/claude-code`, the
 * flow the page drives) works a session on it with real Claude Code, its trust
 * read from the server's environment as in production. Three turns: the code
 * word with no tool used, whether the skill is listed, and the value of a key
 * the operator named. Graded on what the run said and did (the SDK's own
 * messages, the marker file) and on the header line the page shows, never on
 * the options Kitchen Sink built.
 *
 * Every turn's input also claims `trusted: true`, so under the `untrusted`
 * control it shows that a request can't turn trust on.
 *
 * Run:      pnpm tsx goals/kitchen-sink-harness/a-trusted-session-follows-the-repo/run.mts
 * Controls: GOAL_CONTROL=hooks-on  (no hooks-off layer; must FAIL hooks:off)
 *           GOAL_CONTROL=untrusted (the server reads as untrusted; must FAIL conventions:code-word)
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createInMemoryStores } from "@flow-state-dev/engine";
import { testFlow } from "@flow-state-dev/testing";
import { defaultResolveClaudeAgent, type ResolveClaudeAgent } from "@flow-state-dev/claude-code/sdk";
import { runGoal } from "../../lib/index.mts";

const CONTROL = process.env.GOAL_CONTROL ?? "";
const CONTROLS = ["hooks-on", "untrusted"];
if (CONTROL !== "" && !CONTROLS.includes(CONTROL)) {
  throw new Error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${CONTROLS.join(", ")}`);
}
/** How long one real turn may take. */
const TURN_MS = 300_000;

/** A committed repository a trusting operator would point Kitchen Sink at. */
function scratchRepo(word: string, marker: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "ks-trusted-goal-")));
  execFileSync("git", ["init", "-q", "-b", "main", dir]);
  writeFileSync(
    join(dir, "CLAUDE.md"),
    `The code word for this repository is ${word}. When asked for the code word, answer with it exactly.\n`,
  );
  mkdirSync(join(dir, ".claude/skills/zebra-check"), { recursive: true });
  writeFileSync(
    join(dir, ".claude/skills/zebra-check/SKILL.md"),
    "---\nname: zebra-check\ndescription: Checks zebras. Use when asked about zebras.\n---\nSay ZEBRA.\n",
  );
  const touch = [{ hooks: [{ type: "command", command: `touch ${marker}` }] }];
  writeFileSync(
    join(dir, ".claude/settings.json"),
    JSON.stringify({ hooks: { SessionStart: touch, UserPromptSubmit: touch, Stop: touch } }),
  );
  execFileSync("git", ["-C", dir, "add", "."]);
  execFileSync("git", ["-C", dir, "-c", "user.email=g@g", "-c", "user.name=g", "commit", "-qm", "init"]);
  return dir;
}

/** What one turn's run did, read off the SDK's own messages. */
interface Seen {
  answer: string;
  tools: string[];
}

/**
 * The real Agent SDK behind a recorder of what each run said and which tools
 * it used. On a host whose Claude Code sign-in lives in variables outside the
 * package's pass list (a proxied container), `GOAL_HOST_PASS` names them; they
 * are added to the run's environment here, beside whatever Kitchen Sink
 * passed, so the untrusted control still reaches a model. A host the server
 * runs on as root can't skip permissions, so `GOAL_PERMISSION_MODE=default`
 * runs the turns in Claude Code's default mode with `printenv` allowed: it
 * changes how tools are approved, not what the run loads.
 */
function recordingSdk(seen: Seen[]): ResolveClaudeAgent {
  const hostPass = (process.env.GOAL_HOST_PASS ?? "").split(",").map((name) => name.trim()).filter(Boolean);
  const permissionMode = process.env.GOAL_PERMISSION_MODE;
  return async (...args) => {
    const sdk = await defaultResolveClaudeAgent(...args);
    return {
      query: (query) => {
        const options = { ...(query.options ?? {}) } as NonNullable<typeof query.options> & Record<string, unknown>;
        const extra = Object.fromEntries(hostPass.flatMap((name) => (process.env[name] === undefined ? [] : [[name, process.env[name]!]])));
        options.env = { ...((options.env as Record<string, string> | undefined) ?? {}), ...extra };
        if (permissionMode !== undefined) {
          options.permissionMode = permissionMode;
          options.allowedTools = [...((options.allowedTools as string[] | undefined) ?? []), "Bash(printenv:*)"];
        }
        const run: Seen = { answer: "", tools: [] };
        seen.push(run);
        const messages = sdk.query({ ...query, options });
        return (async function* () {
          for await (const message of messages) {
            const m = message as { type?: string; result?: string; message?: { content?: Array<{ type?: string; name?: string }> } };
            if (m.type === "assistant") {
              for (const block of m.message?.content ?? []) if (block.type === "tool_use" && block.name) run.tools.push(block.name);
            }
            if (m.type === "result" && typeof m.result === "string") run.answer = m.result.trim();
            yield message;
          }
        })();
      },
    };
  };
}

await runGoal(async (failures) => {
  const word = `WORD-${randomBytes(4).toString("hex").toUpperCase()}`;
  const keyValue = `key-${randomBytes(6).toString("hex")}`;
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "ks-trusted-goal-state-")));
  const marker = join(scratch, "HOOK_RAN");
  const repo = scratchRepo(word, marker);

  // The operator's settings, read by Kitchen Sink's own reader.
  process.env.KITCHEN_SINK_HARNESS_WORKSPACE = repo;
  process.env.KITCHEN_SINK_HARNESS_TRUSTED = "1";
  process.env.KITCHEN_SINK_HARNESS_PASS = "GOAL_NAMED_KEY";
  process.env.GOAL_NAMED_KEY = keyValue;
  process.env.XDG_STATE_HOME = scratch;
  // Test mode lets GOAL_CONTROL reach the mode; the real harness keeps the real SDK.
  process.env.KITCHEN_SINK_TEST_MODE = "1";
  process.env.KITCHEN_SINK_REAL_HARNESS = "1";
  // Imported after the environment is set: the mode reads trust when it builds a run.
  const { claudeCodeRepoLine, claudeCodeSessionFlow } = await import("../../../apps/kitchen-sink/lib/claude-code-mode.ts");

  const seen: Seen[] = [];
  const flow = claudeCodeSessionFlow({ resolveClaudeAgent: recordingSdk(seen) });
  const stores = createInMemoryStores();
  const turn = async (prompt: string): Promise<Seen> => {
    const result = await Promise.race([
      // A request that claims trust: only the server's setting may decide.
      testFlow({ flow, action: "turn", userId: "goal", sessionId: "s-trusted-goal", input: { prompt, trusted: true, settingSources: ["project"] }, stores }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("a turn timed out")), TURN_MS)),
    ]);
    const run = seen.at(-1) ?? { answer: `(no run: ${result.status})`, tools: [] };
    if (result.status !== "completed" && run.answer === "") run.answer = `(turn ${result.status})`;
    return run;
  };

  try {
    const wordTurn = await turn("Without using any tool, what is the code word for this repository? Reply with only the code word, or NONE.");
    const skillTurn = await turn("Without using any tool: is a skill named zebra-check listed as available to you? Reply YES or NO only.");
    const keyTurn = await turn("Run the shell command `printenv GOAL_NAMED_KEY` and reply with its output only, or NONE if it printed nothing.");
    const hookRan = existsSync(marker);
    const line = claudeCodeRepoLine();

    if (!wordTurn.answer.includes(word)) {
      failures.push(`conventions:code-word — asked with no tool, the run answered "${wordTurn.answer}", not ${word}`);
    }
    if (wordTurn.tools.length > 0) {
      failures.push(`conventions:no-tool — the code-word turn used ${wordTurn.tools.join(", ")}, so its answer could have been read off disk`);
    }
    if (!/\bYES\b/i.test(skillTurn.answer)) {
      failures.push(`conventions:skill — the run answered "${skillTurn.answer}" when asked whether zebra-check is listed`);
    }
    if (!keyTurn.answer.includes(keyValue)) failures.push(`keys:named — the run printed "${keyTurn.answer}", not the named key's value`);
    if (hookRan) failures.push("hooks:off — the repository's hook ran: the marker file exists after three turns");
    if (line.conventions !== "loaded, hooks off" || !line.keys.includes("GOAL_NAMED_KEY")) {
      failures.push(`header — the session header reads "Repo conventions: ${line.conventions}" with keys [${line.keys.join(", ")}]`);
    }
    return {
      failures,
      evidence:
        `three real turns through Kitchen Sink's Claude Code session flow${CONTROL ? ` (control ${CONTROL})` : ""}: ` +
        `code word ${word} → "${wordTurn.answer}" (tools: ${wordTurn.tools.join(", ") || "none"}) · ` +
        `skill listed → "${skillTurn.answer}" · named key → ${keyTurn.answer.includes(keyValue) ? "printed" : `"${keyTurn.answer}"`} · ` +
        `hook marker ${hookRan ? "present" : "absent"} · header "Repo conventions: ${line.conventions}" keys [${line.keys.join(", ")}]`,
    };
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  }
});
