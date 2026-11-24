/**
 * Goal check, FIX-2519: a turn's images reach whichever coding harness runs
 * it, in the form that harness reads, and the reply shows it saw them. See
 * goal.md.
 *
 *   Host:   one harness session flow per harness (Claude Code, Codex,
 *           Cursor), each working in a fresh git checkout, on the in-memory
 *           profile (its files in memory), in this process, driven through
 *           the one client over the engine's in-process fetch as a signed-in
 *           user: upload, then `turn` with the files beside the prompt.
 *   Input:  two fresh PNGs, a random word drawn on each. The prompt names
 *           neither word.
 *   Legs:   per harness signed in here, the reply names both words. After the
 *           Codex turn, the checkout's `git status` is clean and no per-turn
 *           folder is left under Codex's private temp root.
 *
 * A harness not signed in here is named in the verdict, never skipped.
 *
 * Control (same command): `GOAL_CONTROL=strip-attachments` patches the session
 * flow's turn to drop the files before `HarnessRunInput`. `names-both` must
 * FAIL for every harness that runs.
 *
 * Run: pnpm tsx goals/attachments/reach-each-harness/run.mts
 */
import { execFileSync, spawnSync } from "node:child_process";
import { randomInt } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { harnessEnv, type HarnessBlock, type HarnessReadiness } from "@flow-state-dev/core/harness";
import type { FileContent } from "@flow-state-dev/core/items";
import { checkClaudeCodeReadiness, claudeCodeAgent } from "@flow-state-dev/claude-code";
import { checkCodexReadiness, codexAgent } from "@flow-state-dev/codex";
import { checkCursorReadiness, cursorAgent } from "@flow-state-dev/cursor";
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import { harnessSessionFlow, type HarnessSessionFeeds } from "@flow-state-dev/harness-manager";
import {
  REPO_ROOT,
  RUN_STAMP,
  actingAs,
  assertPatched,
  describePatches,
  goalTmpDir,
  modulePatchEnv,
  runGoal,
  silentLogger,
  type ModulePatch,
} from "../../lib/index.mts";
import { wordPng } from "../reach-the-model/png.mts";

const SCRATCH = goalTmpDir("reach-each-harness");
const USER_ID = "u_reach_each_harness";
const ORG_ID = "org_reach_each_harness";
const TURN_TIMEOUT_MS = 600_000;
const PROMPT = "Two images are attached. What word is written on each image? Answer with the two words only. Do not run any commands.";

/** Held-out: two of these, drawn per run. Any pair of distinct A–Z words works. */
const WORDS = [
  "MANGO", "TIGER", "PLANET", "CASTLE", "RIVER", "FALCON", "LEMON", "ORBIT", "WALNUT", "BISON",
  "CANYON", "HARBOR", "VELVET", "JUNGLE", "PEPPER", "QUARTZ", "SUMMIT", "TULIP", "ZEBRA", "KETTLE",
];

const CONTROL = process.env.GOAL_CONTROL ?? "";
const CONTROLS: Record<string, ModulePatch[]> = {
  // The turn hands the harness the prompt alone, as before this change.
  "strip-attachments": [
    {
      module: "packages/harness-manager/src/session-flow.ts",
      from: String.raw`return \{ prompt: input\.prompt, attachments: \[\.\.\.attachments\] \};`,
      to: "return { prompt: input.prompt };",
    },
  ],
};
if (CONTROL !== "" && CONTROLS[CONTROL] === undefined) {
  console.error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(CONTROLS).join(", ")}`);
  process.exit(2);
}
if (CONTROL !== "" && process.env.GOAL_MODULE_PATCH === undefined) {
  const patches = CONTROLS[CONTROL]!;
  const mark = join(SCRATCH, `patch-mark-${RUN_STAMP}`);
  rmSync(mark, { force: true });
  console.error(`control ${CONTROL}:\n${describePatches(patches, REPO_ROOT)}`);
  const child = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, ...modulePatchEnv(patches, REPO_ROOT, mark) },
  });
  assertPatched(patches, REPO_ROOT, mark);
  process.exit(child.status ?? 1);
}

const say = (s: string) => console.error(`[reach-each-harness ${new Date().toISOString().slice(11, 19)}] ${s}`);
const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));

/** A fresh git repository with one commit: the session's checkout. */
function checkout(name: string): string {
  const dir = join(SCRATCH, `checkout-${name}`);
  if (existsSync(dir)) return dir;
  mkdirSync(dir, { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main", dir]);
  writeFileSync(join(dir, "README.md"), "reach each harness\n");
  execFileSync("git", ["-C", dir, "add", "."]);
  execFileSync("git", ["-C", dir, "-c", "user.email=g@g", "-c", "user.name=g", "commit", "-qm", "init"]);
  return realpathSync(dir);
}

/** The per-turn folders under Codex's private temp root, by name. */
function codexTurnFolders(): string[] {
  const uid = process.getuid?.();
  const root = join(tmpdir(), uid === undefined ? "fsd-codex" : `fsd-codex-${uid}`);
  return existsSync(root) ? readdirSync(root).filter((name) => name.startsWith("turn-")) : [];
}

interface Harness {
  name: string;
  kind: string;
  /** The model a session runs, as it names it at creation. */
  model: string;
  ready: () => Promise<HarnessReadiness>;
  agent: (feeds: HarnessSessionFeeds) => HarnessBlock;
}

const HARNESSES: Harness[] = [
  {
    name: "Claude Code",
    kind: "claude-code-session",
    model: process.env.GOAL_CLAUDE_MODEL ?? "claude-haiku-4-5",
    ready: () => checkClaudeCodeReadiness({ env }),
    agent: (feeds) =>
      claudeCodeAgent({
        ...feeds,
        env: harnessEnv({ pass: ["PATH", "HOME", "USER", "TMPDIR", "ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "HTTPS_PROXY", "NODE_EXTRA_CA_CERTS"] }),
        allowedTools: [],
        settingSources: [],
        detached: true,
      } as never) as never,
  },
  {
    name: "Codex",
    kind: "codex-session",
    model: process.env.GOAL_CODEX_MODEL ?? "gpt-5.4-codex",
    ready: () => checkCodexReadiness({ env }),
    agent: (feeds) =>
      codexAgent({
        cwd: feeds.cwd,
        resume: feeds.resume,
        onSession: feeds.onSession,
        model: feeds.model,
        thread: {
          sandboxMode: "read-only",
          approvalPolicy: "never",
          skipGitRepoCheck: true,
        },
      }) as never,
  },
  {
    name: "Cursor",
    kind: "cursor-session",
    model: process.env.GOAL_CURSOR_MODEL ?? "composer-2.5",
    ready: () => checkCursorReadiness(env),
    agent: (feeds) =>
      cursorAgent({
        cwd: feeds.cwd,
        resume: feeds.resume,
        onSession: feeds.onSession,
        model: feeds.model,
        agent: { mode: "agent" },
      }) as never,
  },
];

await runGoal(async (failures, tell) => {
  const first = WORDS[randomInt(WORDS.length)]!;
  let second = first;
  while (second === first) second = WORDS[randomInt(WORDS.length)]!;
  say(`words ${first}, ${second}${CONTROL ? `; control ${CONTROL}` : ""}`);

  const evidence: string[] = [];
  const running: Harness[] = [];
  for (const harness of HARNESSES) {
    const readiness = await harness.ready();
    if (readiness.ready) running.push(harness);
    else failures.push(`blocked: ${harness.name} is not signed in here: ${readiness.reason}${readiness.remedy ? ` (${readiness.remedy})` : ""}`);
  }
  if (running.length === 0) return { failures, evidence: "" };

  const flows = Object.fromEntries(
    running.map((harness) => [
      harness.kind,
      harnessSessionFlow({
        kind: harness.kind,
        workspace: { provision: async (place) => checkout(place.sessionId), locate: (place) => checkout(place.sessionId), branch: () => null },
        agent: harness.agent,
      }),
    ]),
  );
  const host = createFlowState({
    flows: Object.values(flows),
    stores: { goal: { primary: inMemoryStores() } },
    defaultProfile: "goal",
    logger: silentLogger,
    resolvePrincipal: (context: { request?: Request }) => {
      const user = context.request?.headers.get("x-user");
      return typeof user === "string" ? { userId: user, orgId: ORG_ID } : null;
    },
  } as never);
  const { client } = actingAs(host as never, USER_ID);

  for (const harness of running) {
    const flow = client.flow(harness.kind);
    const shots: FileContent[] = [];
    for (const [i, word] of [first, second].entries()) {
      shots.push(await flow.upload({ data: wordPng(word), mediaType: "image/png", filename: `image-${i + 1}.png` }));
    }
    const sessionId = (await flow.createSession({ state: { model: harness.model } } as never)).id;
    const foldersBefore = new Set(codexTurnFolders());
    const sent = await flow.send("turn", { prompt: PROMPT }, { sessionId, attachments: shots });
    const { status } = await sent.wait({ pollMs: 250, timeoutMs: TURN_TIMEOUT_MS });
    const listed = await client.sessions.requests(sessionId, { includeResultOutput: true, limit: 10 });
    const output = (listed.find((request) => request.id === sent.id)?.result as { output?: { finalMessage?: string | null } } | undefined)?.output;
    const reply = output?.finalMessage ?? "";
    say(`${harness.name}: ${status}; reply "${reply.slice(0, 160)}"`);
    evidence.push(`${harness.name} ${status} "${reply.slice(0, 80)}"`);
    if (status !== "completed") failures.push(`${harness.name}: the turn ended ${status}`);

    // names-both: the harness read both images.
    for (const word of tell.over(`names-both · ${harness.name}'s two words`, [first, second])) {
      if (!reply.toUpperCase().includes(word)) failures.push(`names-both: ${harness.name}'s reply does not name ${word}: "${reply.slice(0, 200)}"`);
    }

    if (harness.name === "Codex") {
      // checkout-clean: the images never landed in the checkout.
      const porcelain = execFileSync("git", ["-C", checkout(sessionId), "status", "--porcelain", "--untracked-files=all"], { encoding: "utf8" }).trim();
      if (porcelain !== "") failures.push(`checkout-clean: Codex's checkout is not clean after the turn:\n${porcelain}`);
      // folder-gone: no per-turn folder outlived the turn.
      const left = codexTurnFolders().filter((name) => !foldersBefore.has(name));
      if (left.length > 0) failures.push(`folder-gone: the turn's folder is still there: ${left.join(", ")}`);
      evidence.push(`Codex checkout ${porcelain === "" ? "clean" : "dirty"}, ${left.length} folder(s) left`);
    }
  }

  return { failures, evidence: `words ${first}/${second}; ${evidence.join("; ")}` };
});
