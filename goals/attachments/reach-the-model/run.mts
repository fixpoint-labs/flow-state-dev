/**
 * Goal check, FIX-2517: a person's message with files reaches a real model as
 * one turn with the text and every file, the conversation shows those files on
 * their line after a reload, and a later turn still sees them. See goal.md.
 *
 *   Host:   a generator flow (`send`, with `userMessage`) on an on-disk SQLite
 *           store in a scratch folder, in this process, driven through the
 *           one client over the engine's in-process fetch, as a signed-in user.
 *   Turn 1: two fresh PNGs, a random word drawn on each, uploaded and sent
 *           with "What word is written on each image?". The reply must name
 *           both words.
 *   Reload: the session read afresh holds one user line for turn 1 with a
 *           text part and two `file` parts whose `data` is a blob reference.
 *   Turn 3: after a turn with no files, "What word was on the second image?"
 *           is answered with the second word.
 *   Limit:  an eleventh image is refused by name, and no request is recorded.
 *
 * Control (same command): `GOAL_CONTROL=drop-file-parts` patches the history
 * build to keep a user line's text only. `names-both` must fail.
 *
 * Run: pnpm tsx goals/attachments/reach-the-model/run.mts
 */
import { spawnSync } from "node:child_process";
import { randomInt } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { createModelResolver, defineFlow, generator } from "@flow-state-dev/core";
import { parseBlobRef } from "@flow-state-dev/core/attachments";
import type { FileContent } from "@flow-state-dev/core/items";
import { createFlowState } from "@flow-state-dev/engine";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
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
import { wordPng } from "./png.mts";

const SCRATCH = goalTmpDir("reach-the-model");
const MODEL = gatewayModel(goalModel("openai/gpt-6-luna"));
const USER_ID = "u_reach_the_model";
const ORG_ID = "org_reach_the_model";
const FLOW = "files-chat";
const TURN_TIMEOUT_MS = 180_000;

/** Held-out: two of these, drawn per run. Any pair of distinct A–Z words works. */
const WORDS = [
  "MANGO", "TIGER", "PLANET", "CASTLE", "RIVER", "FALCON", "LEMON", "ORBIT", "WALNUT", "BISON",
  "CANYON", "HARBOR", "VELVET", "JUNGLE", "PEPPER", "QUARTZ", "SUMMIT", "TULIP", "ZEBRA", "KETTLE",
  "MARBLE", "NECTAR", "OTTER", "PARROT", "ROCKET", "SALMON", "TIMBER", "VIOLIN", "WAFFLE", "YOGURT",
];

const CONTROL = process.env.GOAL_CONTROL ?? "";
const CONTROLS: Record<string, { patches: ModulePatch[]; assertions: string[] }> = {
  // The history build keeps a user line's text and drops its files.
  "drop-file-parts": {
    assertions: ["names-both"],
    patches: [
      {
        module: "packages/engine/src/context/history.ts",
        from: String.raw`if \(files\.length > 0\) \{`,
        to: "if (false && files.length > 0) {",
      },
    ],
  },
};
if (CONTROL !== "" && CONTROLS[CONTROL] === undefined) {
  console.error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(CONTROLS).join(", ")}`);
  process.exit(2);
}
const control = CONTROL === "" ? undefined : CONTROLS[CONTROL]!;
if (control !== undefined && process.env.GOAL_MODULE_PATCH === undefined) {
  const mark = join(SCRATCH, `patch-mark-${RUN_STAMP}`);
  rmSync(mark, { force: true });
  console.error(`control ${CONTROL}:\n${describePatches(control.patches, REPO_ROOT)}`);
  const child = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, ...modulePatchEnv(control.patches, REPO_ROOT, mark) },
  });
  assertPatched(control.patches, REPO_ROOT, mark);
  process.exit(child.status ?? 1);
}

const say = (s: string) => console.error(`[reach-the-model ${new Date().toISOString().slice(11, 19)}] ${s}`);
const textOf = (content: unknown): string =>
  Array.isArray(content) ? content.map((part: { text?: string }) => part.text ?? "").join("") : String(content ?? "");

function startHost() {
  const answer = generator({
    name: "answer",
    model: "goal/answer",
    prompt: "You answer questions about what the user sent, briefly. When asked for a word, give the word.",
    history: true,
    // A chat: the reply shows on the page and is part of the conversation.
    itemVisibility: { client: true, history: true },
  });
  const input = z.object({ message: z.string() });
  const flow = defineFlow({
    kind: FLOW,
    actions: { send: { inputSchema: input, block: answer, userMessage: (i: { message: string }) => i.message } },
  })();
  const real = createModelResolver() as unknown as (id: string, block?: string) => unknown;
  const mapped = (id: string) => (id.startsWith("goal/") ? MODEL : id);
  const modelResolver = Object.assign((id: string, block?: string) => real(mapped(id), block), { resolveId: mapped });
  return createFlowState({
    flows: { [FLOW]: flow },
    stores: { default: { primary: sqliteStores({ filename: join(SCRATCH, `store-${RUN_STAMP}.sqlite`) }) } },
    logger: silentLogger,
    modelResolver,
    resolvePrincipal: (context: { request?: Request }) => {
      const user = context.request?.headers.get("x-user");
      return typeof user === "string" ? { userId: user, orgId: ORG_ID } : null;
    },
  } as never);
}

await runGoal(async (failures, tell) => {
  const key = keysServing(MODEL).find((k) => (process.env[k] ?? "") !== "");
  if (key === undefined) {
    return { failures: [`blocked: no key here serves ${MODEL}; none of ${keysServing(MODEL).join(", ")} is set`], evidence: "" };
  }
  // The default blob store is on disk under the working directory: keep it in scratch.
  mkdirSync(SCRATCH, { recursive: true });
  process.chdir(SCRATCH);

  const host = startHost();
  const { client } = actingAs(host as never, USER_ID);
  const flow = client.flow(FLOW);
  const first = WORDS[randomInt(WORDS.length)]!;
  let second = first;
  while (second === first) second = WORDS[randomInt(WORDS.length)]!;
  say(`model ${MODEL}; words ${first}, ${second}${CONTROL ? `; control ${CONTROL}` : ""}`);

  const shots: FileContent[] = [];
  for (const [i, word] of [first, second].entries()) {
    shots.push(await flow.upload({ data: wordPng(word), mediaType: "image/png", filename: `image-${i + 1}.png` }));
  }
  const sessionId = (await flow.createSession()).id;
  const turn = async (message: string, attachments?: FileContent[]) => {
    const sent = await flow.send("send", { message }, { sessionId, ...(attachments ? { attachments } : {}) });
    const { status } = await sent.wait({ pollMs: 100, timeoutMs: TURN_TIMEOUT_MS });
    if (status !== "completed") throw new Error(`setup: "${message}" ended ${status}`);
    return sent.id;
  };
  const turn1 = await turn("What word is written on each image? Answer with the two words.", shots);
  const turn2 = await turn("Thanks. Reply with just OK.");
  const turn3 = await turn("What word was on the second image? Answer with the word only.");

  // --- Reload: the session as a fresh page reads it -------------------------
  const snapshot = await client.sessions.state(sessionId, { includeItems: true, offset: 0, limit: 200 });
  const items = ((snapshot as { items?: unknown[] }).items ?? []) as Array<{ type: string; role?: string; requestId?: string; content?: unknown[] }>;
  // The reply as the person sees it: the assistant's line, or the request's
  // answer when the run left no line (a model that answered without streaming).
  const listed = await client.sessions.requests(sessionId, { includeResultOutput: true, limit: 100 });
  const reply = (requestId: string) => {
    const said = items
      .filter((item) => item.type === "message" && item.role === "assistant" && item.requestId === requestId)
      .map((item) => textOf(item.content))
      .join(" ");
    if (said !== "") return said;
    const output = (listed.find((request) => request.id === requestId)?.result as { output?: unknown } | undefined)?.output;
    return typeof output === "string" ? output : JSON.stringify(output ?? "");
  };

  const reply1 = reply(turn1);
  const reply3 = reply(turn3);
  say(`turn 1 reply: ${reply1.slice(0, 200)}`);
  say(`turn 3 reply: ${reply3.slice(0, 200)}`);
  if (!reply(turn2)) say("turn 2 had no reply text");

  // names-both: the model read both images.
  for (const word of tell.over("names-both · the two words", [first, second])) {
    if (!reply1.toUpperCase().includes(word)) failures.push(`names-both: turn 1's reply does not name ${word}: "${reply1.slice(0, 200)}"`);
  }

  // reload: one user line for turn 1, its text then two references.
  const lines = tell.over(
    "reload · turn 1's user lines",
    items.filter((item) => item.type === "message" && item.role === "user" && item.requestId === turn1),
  );
  if (lines.length !== 1) failures.push(`reload: turn 1 has ${lines.length} user lines, not 1`);
  const parts = (lines[0]?.content ?? []) as Array<{ type: string; text?: string; data?: string }>;
  const files = parts.filter((p) => p.type === "file");
  if (parts[0]?.type !== "output_text") failures.push(`reload: turn 1's line does not start with its text: ${JSON.stringify(parts[0])}`);
  if (files.length !== 2 || files.some((f) => typeof f.data !== "string" || parseBlobRef(f.data) === undefined)) {
    failures.push(`reload: turn 1's line holds ${files.length} file parts, not two references: ${JSON.stringify(files).slice(0, 300)}`);
  }

  // later-turn: two turns on, the second image is still the model's to read.
  if (!reply3.toUpperCase().includes(second)) failures.push(`later-turn: turn 3's reply does not name ${second}: "${reply3.slice(0, 200)}"`);

  // limit: an eleventh image is refused by name, with no request recorded.
  const before = (await client.sessions.requests(sessionId, { limit: 100 })).length;
  const eleven: FileContent[] = [];
  for (let i = 0; i < 11; i += 1) eleven.push(await flow.upload({ data: wordPng(first), mediaType: "image/png", filename: `extra-${i}.png` }));
  const refused = await flow.send("send", { message: "too many" }, { sessionId, attachments: eleven }).then(
    () => undefined,
    (error: { status?: number; body?: unknown }) => error,
  );
  const after = (await client.sessions.requests(sessionId, { limit: 100 })).length;
  const body = JSON.stringify(refused?.body ?? null);
  if (refused === undefined || !body.includes("attachment_limit")) failures.push(`limit: eleven images were not refused by name: ${body}`);
  if (after !== before) failures.push(`limit: the refused send recorded a request (${before} → ${after})`);

  return {
    failures,
    evidence:
      `words ${first}/${second}; turn 1 replied "${reply1.slice(0, 120)}"; reload: 1 user line, text + ${files.length} references; ` +
      `turn 3 replied "${reply3.slice(0, 60)}"; 11 images → ${refused?.status ?? "accepted"} ${body.slice(0, 80)}, requests ${before} → ${after}`,
  };
});
