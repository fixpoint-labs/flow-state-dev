/**
 * Goal check, FIX-2520: a PDF, a Markdown file and a CSV sent with a message
 * reach every target in the form it reads, and each reply shows it read them;
 * a text file over the cap is refused at upload. See goal.md.
 *
 *   Host:   a generator flow (`send`, with `userMessage`) and one harness
 *           session flow per harness signed in here, each in a fresh git
 *           checkout, on the in-memory profile, in this process, driven
 *           through the one client over the engine's in-process fetch as a
 *           signed-in user.
 *   Input:  a three-page PDF with a code word on page 3 only, a `.md` and a
 *           `.csv` with their own, all drawn per run; a 250 KB `.txt`.
 *   Legs:   text-cap: the `.txt` is refused at upload by name and size.
 *           reads-all: the generator's reply, and each harness's, carries
 *           all three code words.
 *
 * A target with no key or sign-in here is named in the verdict, never skipped.
 *
 * Control (same command): `GOAL_CONTROL=drop-documents` drops every document
 * before the model call and from a harness turn. `reads-all` must FAIL for
 * every target that runs.
 *
 * Run: pnpm tsx goals/attachments/read-a-document/run.mts
 */
import { execFileSync, spawnSync } from "node:child_process";
import { randomInt } from "node:crypto";
import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { createModelResolver, defineFlow, generator } from "@flow-state-dev/core";
import { harnessEnv, type HarnessBlock, type HarnessReadiness } from "@flow-state-dev/core/harness";
import type { FileContent } from "@flow-state-dev/core/items";
import { checkClaudeCodeReadiness, claudeCodeAgent } from "@flow-state-dev/claude-code";
import { checkCodexReadiness, codexAgent } from "@flow-state-dev/codex";
import { checkCursorReadiness, cursorAgent } from "@flow-state-dev/cursor";
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import { harnessSessionFlow, type HarnessSessionFeeds } from "@flow-state-dev/harness-manager";
import { makePdf } from "../../../packages/engine/test/blobs/pdf-fixture.ts";
import {
  REPO_ROOT,
  RUN_STAMP,
  actingAs,
  assertPatched,
  describePatches,
  gatewayModel,
  goalModel,
  goalTmpDir,
  keysServing,
  modulePatchEnv,
  runGoal,
  silentLogger,
  type ModulePatch,
} from "../../lib/index.mts";

const SCRATCH = goalTmpDir("read-a-document");
const MODEL = gatewayModel(goalModel("openai/gpt-6-luna"));
const USER_ID = "u_read_a_document";
const ORG_ID = "org_read_a_document";
const CHAT = "documents-chat";
const TURN_TIMEOUT_MS = 600_000;
const PROMPT =
  "Three files are attached: a PDF, a Markdown file and a CSV. Each holds one code word in capital letters. " +
  "What is the code word in each? Answer with the three words only. Do not run any commands.";

/** Held-out: three of these, drawn per run. Any three distinct A–Z words work. */
const WORDS = [
  "TANGERINE", "PLUM", "GRANITE", "LANTERN", "COBALT", "MEADOW", "SPARROW", "FJORD", "BEACON", "CINDER", "HAZEL", "MOSAIC",
  "NUTMEG", "OPAL", "PRISM", "QUILL", "RAVEN", "SAFFRON", "THISTLE", "UMBER", "VORTEX", "WILLOW", "YARROW", "ZEPHYR",
];

const CONTROL = process.env.GOAL_CONTROL ?? "";
const CONTROLS: Record<string, ModulePatch[]> = {
  // Every document is named, not sent, to a model and to a harness.
  "drop-documents": [
    {
      module: "packages/engine/src/context/history-files.ts",
      from: String.raw`if \(attachmentKind\(mediaType\) === "image"\) return \{ type: "image", image: resolved\.base64\(\), mediaType \};`,
      to: 'if (attachmentKind(mediaType) === "image") return { type: "image", image: resolved.base64(), mediaType }; return fileNote(file, "dropped");',
    },
    {
      module: "packages/core/src/types/harness-attachments.ts",
      from: String.raw`if \(attachmentSentAs\(file\.mediaType, accepts\) === "file"\) files\.push\(file\);`,
      to: 'if (!file.mediaType.startsWith("image/")) continue; if (true) files.push(file);',
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

const say = (s: string) => console.error(`[read-a-document ${new Date().toISOString().slice(11, 19)}] ${s}`);
const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
const encode = (text: string) => new TextEncoder().encode(text);

/** A fresh git repository with one commit: a harness session's checkout. */
function checkout(name: string): string {
  const dir = join(SCRATCH, `checkout-${name}`);
  if (existsSync(dir)) return dir;
  mkdirSync(dir, { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main", dir]);
  writeFileSync(join(dir, "README.md"), "read a document\n");
  execFileSync("git", ["-C", dir, "add", "."]);
  execFileSync("git", ["-C", dir, "-c", "user.email=g@g", "-c", "user.name=g", "commit", "-qm", "init"]);
  return realpathSync(dir);
}

interface Harness {
  name: string;
  kind: string;
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
        thread: { sandboxMode: "read-only", approvalPolicy: "never", skipGitRepoCheck: true },
      }) as never,
  },
  {
    name: "Cursor",
    kind: "cursor-session",
    model: process.env.GOAL_CURSOR_MODEL ?? "composer-2.5",
    ready: () => checkCursorReadiness(env),
    agent: (feeds) =>
      cursorAgent({ cwd: feeds.cwd, resume: feeds.resume, onSession: feeds.onSession, model: feeds.model, agent: { mode: "agent" } }) as never,
  },
];

/** The generator flow: its model string is mapped to the goal's model, and so is its provider, so a PDF goes as a file. */
function chatFlow() {
  const answer = generator({
    name: "answer",
    model: "goal/answer",
    prompt: "You answer questions about the files the user sent, briefly.",
    history: true,
    itemVisibility: { client: true, history: true },
  });
  const input = z.object({ message: z.string() });
  return defineFlow({
    kind: CHAT,
    actions: { send: { inputSchema: input, block: answer, userMessage: (i: { message: string }) => i.message } },
  })();
}

function modelResolver() {
  const real = createModelResolver();
  const mapped = (id: string) => (id.startsWith("goal/") ? MODEL : id);
  return Object.assign((id: string, block?: string) => real(mapped(id), block), {
    resolveId: mapped,
    providerOf: (id: string) => real.providerOf?.(mapped(id)) ?? "unknown",
  });
}

/** The reply a request left: a generator's string answer, or a harness's final message. */
async function replyOf(client: ReturnType<typeof actingAs>["client"], sessionId: string, requestId: string): Promise<string> {
  const listed = await client.sessions.requests(sessionId, { includeResultOutput: true, limit: 10 });
  const output = (listed.find((request) => request.id === requestId)?.result as { output?: unknown } | undefined)?.output;
  if (typeof output === "string") return output;
  const final = (output as { finalMessage?: unknown } | undefined)?.finalMessage;
  return typeof final === "string" ? final : JSON.stringify(output ?? "");
}

await runGoal(async (failures, tell) => {
  const pick = () => WORDS[randomInt(WORDS.length)]!;
  const words = new Set<string>();
  while (words.size < 3) words.add(pick());
  const [pdfWord, mdWord, csvWord] = [...words] as [string, string, string];
  say(`words: pdf ${pdfWord}, md ${mdWord}, csv ${csvWord}${CONTROL ? `; control ${CONTROL}` : ""}`);

  const generatorKey = keysServing(MODEL).find((k) => (process.env[k] ?? "") !== "");
  const running: Harness[] = [];
  for (const harness of HARNESSES) {
    const readiness = await harness.ready();
    if (readiness.ready) running.push(harness);
    else failures.push(`blocked: ${harness.name} is not signed in here: ${readiness.reason}${readiness.remedy ? ` (${readiness.remedy})` : ""}`);
  }
  if (generatorKey === undefined) failures.push(`blocked: no key here serves ${MODEL}; none of ${keysServing(MODEL).join(", ")} is set`);

  mkdirSync(SCRATCH, { recursive: true });
  const flows = {
    [CHAT]: chatFlow(),
    ...Object.fromEntries(
      running.map((harness) => [
        harness.kind,
        harnessSessionFlow({
          kind: harness.kind,
          workspace: { provision: async (place) => checkout(place.sessionId), locate: (place) => checkout(place.sessionId), branch: () => null },
          agent: harness.agent,
        }),
      ]),
    ),
  };
  const host = createFlowState({
    flows,
    stores: { goal: { primary: inMemoryStores() } },
    defaultProfile: "goal",
    logger: silentLogger,
    modelResolver: modelResolver(),
    resolvePrincipal: (context: { request?: Request }) => {
      const user = context.request?.headers.get("x-user");
      return typeof user === "string" ? { userId: user, orgId: ORG_ID } : null;
    },
  } as never);
  const { client } = actingAs(host as never, USER_ID);
  const evidence: string[] = [];

  // text-cap: refused at upload, by name and size, before any send.
  const big = await client
    .flow(CHAT)
    .upload({ data: encode("filler line\n".repeat(Math.ceil((250 * 1024) / 12))), mediaType: "text/plain", filename: "big.txt" })
    .then(
      () => undefined,
      (error: { status?: number; body?: unknown }) => error,
    );
  const bigBody = JSON.stringify(big?.body ?? null);
  if (big?.status !== 413 || !bigBody.includes("attachment_text_too_large") || !bigBody.includes("KB")) {
    failures.push(`text-cap: a 250 KB .txt was not refused at upload by name and size: ${big?.status ?? "accepted"} ${bigBody}`);
  }
  evidence.push(`250 KB .txt → ${big?.status ?? "accepted"} ${bigBody.slice(0, 80)}`);

  const uploader = client.flow(CHAT);
  /** The three documents, uploaded fresh for `flow`: each upload is claimed by one conversation. */
  const documents = async (flow: { upload: (typeof uploader)["upload"] }): Promise<FileContent[]> => [
    await flow.upload({
      data: makePdf(["Project brief. The code word is not on this page.", "Background. Still not here.", `The code word is ${pdfWord}`]),
      mediaType: "application/pdf",
      filename: "brief.pdf",
    }),
    await flow.upload({ data: encode(`# Notes\n\nThe code word is ${mdWord}.\n`), mediaType: "text/markdown", filename: "notes.md" }),
    await flow.upload({ data: encode(`ts,level,message\n2026-11-08T10:02:11Z,error,code word: ${csvWord}\n`), mediaType: "text/csv", filename: "errors.csv" }),
  ];

  const check = (target: string, reply: string) => {
    for (const word of tell.over(`reads-all · ${target}'s three code words`, [pdfWord, mdWord, csvWord])) {
      if (!reply.toUpperCase().includes(word)) failures.push(`reads-all: ${target}'s reply does not carry ${word}: "${reply.slice(0, 200)}"`);
    }
  };

  if (generatorKey !== undefined) {
    const flow = client.flow(CHAT);
    const files = await documents(flow);
    const sessionId = (await flow.createSession()).id;
    const sent = await flow.send("send", { message: PROMPT }, { sessionId, attachments: files });
    const { status } = await sent.wait({ pollMs: 200, timeoutMs: TURN_TIMEOUT_MS });
    const reply = await replyOf(client, sessionId, sent.id);
    say(`generator (${MODEL}): ${status}; reply "${reply.slice(0, 160)}"`);
    evidence.push(`generator ${status} "${reply.slice(0, 80)}"`);
    if (status !== "completed") failures.push(`generator: the turn ended ${status}`);
    check("the generator", reply);
  }

  for (const harness of running) {
    const flow = client.flow(harness.kind);
    const files = await documents(flow);
    const sessionId = (await flow.createSession({ state: { model: harness.model } } as never)).id;
    const sent = await flow.send("turn", { prompt: PROMPT }, { sessionId, attachments: files });
    const { status } = await sent.wait({ pollMs: 250, timeoutMs: TURN_TIMEOUT_MS });
    const reply = await replyOf(client, sessionId, sent.id);
    say(`${harness.name}: ${status}; reply "${reply.slice(0, 160)}"`);
    evidence.push(`${harness.name} ${status} "${reply.slice(0, 80)}"`);
    if (status !== "completed") failures.push(`${harness.name}: the turn ended ${status}`);
    check(harness.name, reply);
  }

  return { failures, evidence: `words ${pdfWord}/${mdWord}/${csvWord}; ${evidence.join("; ")}` };
});
