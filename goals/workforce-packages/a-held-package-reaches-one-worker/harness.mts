/**
 * Real-path driver for the held-package goal check. Copied into
 * `apps/kitchen-sink` and run there as a real ESM file by run.mts (via
 * `runHarness`), because `goals/` cannot resolve `@ai-sdk/gateway` and an
 * app's node_modules can. Nothing is added to kitchen-sink; it is the working
 * directory, not the subject.
 *
 * Drives what a team adopting packages would do: import the module `fsdev gen`
 * wrote from the tree, install the workforce kit over the tree with the
 * generated `packageBlocks` (every seat runs on the kit's one built-in
 * `agent` copy), and ask each seat the same question over the real HTTP
 * route, in a session on that copy that names it.
 *
 * OBSERVES ONLY. Every assertion lives in run.mts; this file reports what
 * happened on one `__GOAL__` line. The tool calls are observed as a real side
 * effect: the package's block bumps a process-wide counter, which is reset
 * before each seat's turn and read after it (turns run one at a time).
 *
 * Control `drop-tools-line` (set by run.mts) deletes every seat's `tools` line
 * from a copy of the tree before the kit reads it: the shape of a kind that
 * ignored a written `tools: []`.
 *
 * The attempts repeat HERE, inside one execution, so the load, the codegen
 * import and the hire happen once and only the question repeats.
 */
import { createGateway } from "@ai-sdk/gateway";
import { createModelResolver } from "@flow-state-dev/core";
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import { cpSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WORKER_ID_STATE_KEY, inventoryWorkers, type WorkerInstallation } from "@flow-state-dev/workforce";
import { workforce, type WorkforceConfig } from "@flow-state-dev/workforce/kit";
import { readWorkforceFolder } from "@flow-state-dev/workforce/loader";

const MODEL = process.env.GOAL_MODEL ?? "vercel:openai/gpt-5.4-mini";
const CONTROL = process.env.GOAL_CONTROL ?? "";
const ATTEMPTS = Number(process.env.GOAL_ATTEMPTS ?? "3");
const WORKFORCE_DIR = process.env.GOAL_WORKFORCE_DIR ?? "";
const GEN_MODULE = process.env.GOAL_GEN_MODULE ?? "";
const USER_ID = process.env.GOAL_USER_ID ?? "u_goal";
const QUESTION = process.env.GOAL_QUESTION ?? "";
/** Seat id -> [should carry the instruction token, should call the tool]. The stopping rule only. */
const EXPECT = JSON.parse(process.env.GOAL_EXPECT ?? "{}") as Record<string, [boolean, boolean]>;
const TOKEN = process.env.GOAL_TOKEN ?? "";

const gatewayApiKey = process.env.AI_GATEWAY_API_KEY;
const modelResolver = createModelResolver({
  gateways: gatewayApiKey ? { vercel: createGateway({ apiKey: gatewayApiKey }) } : undefined,
  defaultModel: MODEL,
  intents: { chat: [MODEL] },
});

const counter = globalThis as { __goalStampCalls?: number };

type Item = { type?: string; role?: string; content?: unknown; text?: unknown };

/** Same extraction as `goals/lib/capture.mts`: string, parts array, or `text`. */
function messageText(item: Item): string {
  const content = item.content ?? item.text ?? "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        typeof part === "string" ? part : String((part as { text?: string })?.text ?? ""),
      )
      .join(" ");
  }
  return String(content);
}

function assistantText(items: Item[]): string {
  return items
    .filter((i) => i.type === "message" && i.role !== "user")
    .map(messageText)
    .join("\n")
    .trim();
}

/** Stop asking once every seat matched what it was expected to do. Lenient on purpose; run.mts grades. */
function settled(turns: Record<string, { reply: string; calls: number }>): boolean {
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, "");
  return Object.entries(EXPECT).every(([id, [says, calls]]) => {
    const turn = turns[id];
    if (turn === undefined || turn.reply === "") return false;
    return norm(turn.reply).includes(norm(TOKEN)) === says && turn.calls > 0 === calls;
  });
}

// The harness runs from the app's root and can't import `goals/lib`, so what
// it needs of `goals/lib/workers.mts` is written out here.

/** What the workforce kit reads of `directory`. */
const readTree = (directory: string) => readWorkforceFolder({ path: directory, claim: () => undefined });

/** A copy of the tree at `directory` with every `WORKER.md`'s `key:` line taken out. */
function treeWithout(directory: string, key: string): string {
  const copy = join(mkdtempSync(join(tmpdir(), "fsd-goal-packages-")), "workforce");
  cpSync(directory, copy, { recursive: true });
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name === "WORKER.md") writeFileSync(path, readFileSync(path, "utf8").replace(new RegExp(`^${key}:.*\\n`, "m"), ""));
    }
  };
  walk(copy);
  return copy;
}

/** The workforce kit over `directory`, installed as an app's start does, and what it hired and serves. */
async function installWorkers(directory: string, config: Omit<WorkforceConfig, "directory"> = {}) {
  let installation: WorkerInstallation | undefined;
  const state = createFlowState({
    kits: [workforce({ ...config, directory })],
    fill: { [workforce.slots.flows]: { harness: (hired: WorkerInstallation) => ((installation = hired), []) } },
    stores: { dev: { primary: inMemoryStores() } },
  });
  await state.ready();
  const copies = (await state.getRuntime()).registry.list();
  await state.dispose();
  return { installation: installation!, copies };
}

async function main(): Promise<void> {
  const out: Record<string, unknown> = { ok: false, model: MODEL };

  // The kit's reader: a file it can't load stops the harness, as it stops an app's start.
  const directory = CONTROL === "drop-tools-line" ? treeWithout(WORKFORCE_DIR, "tools") : WORKFORCE_DIR;
  const loaded = await readTree(directory);
  // HELD, not reach: `w.packages` is every package in the seat's reach, and an
  // org or team library there is held only when a `packages:` line names it.
  // This goal forbids that line, so a seat holds exactly its own folder's.
  out.held = Object.fromEntries(
    loaded.workers.map((w) => [
      w.id,
      (w.packages ?? []).filter((p) => p.level === "worker").map((p) => p.path),
    ]),
  );

  const generated = (await import(GEN_MODULE)) as {
    packageBlocks: Record<string, Record<string, never>>;
  };
  out.generatedPackages = Object.fromEntries(
    Object.entries(generated.packageBlocks).map(([address, blocks]) => [address, Object.keys(blocks)]),
  );

  // No worker flow is given, so every seat runs on the kit's built-in `agent`,
  // bound to the installation it hired.
  const { installation, copies } = await installWorkers(directory, { generated: { packageBlocks: generated.packageBlocks } });
  // Each seat, and the flow it runs on.
  const seats = inventoryWorkers(installation);
  out.workerIds = seats.map((s) => s.id);

  const flowState = createFlowState({
    flows: copies,
    stores: { dev: { primary: inMemoryStores() } },
    modelResolver,
  } as never);
  const router = await flowState.getRouter();
  const stores = (await flowState.getRuntime()).stores;

  async function ask(seat: { id: string; kind: string }, sessionId: string): Promise<string> {
    const address = seat.id;
    // A seat has no flow address of its own: it answers in a session of the
    // flow it runs on, created naming it.
    const sessionPath = [seat.kind, "sessions"];
    const opened = await router.POST(
      new Request(`http://goal/api/flows/${sessionPath.join("/")}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: USER_ID, sessionId, state: { [WORKER_ID_STATE_KEY]: seat.id } }),
      }),
      { params: { path: sessionPath } } as never,
    );
    if (opened.status !== 201) {
      throw new Error(`${address}: a session on "${seat.kind}" naming it answered ${opened.status}: ${await opened.text()}`);
    }
    const path = [seat.kind, sessionId, "actions", "respond"];
    const res = await router.POST(
      new Request(`http://goal/api/flows/${path.join("/")}`, {
        method: "POST",
        body: JSON.stringify({ userId: USER_ID, input: { message: QUESTION } }),
      }),
      { params: { path } } as never,
    );
    if (!res.ok) throw new Error(`POST ${path.join("/")} returned ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { request?: { id: string } };
    const requestId = body.request?.id;
    if (requestId === undefined || requestId === "") {
      throw new Error(`POST ${path.join("/")} returned no request id: ${JSON.stringify(body)}`);
    }
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const record = (await stores.request.get(requestId)) as
        | { status?: string; items?: Item[]; output?: unknown }
        | undefined;
      if (record !== undefined && record.status !== undefined && record.status !== "in_progress") {
        // Only a completed turn counts: text a failed turn emitted is not an answer.
        if (record.status !== "completed") {
          throw new Error(`${address}: the request ended "${record.status}", not "completed"`);
        }
        const fromItems = assistantText(record.items ?? []);
        const fromOutput = typeof record.output === "string" ? record.output : "";
        return `${fromItems}\n${fromOutput}`.trim();
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`${address}: no terminal status within 60s`);
  }

  const attempts: Array<Record<string, { reply: string; calls: number }>> = [];
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    const turns: Record<string, { reply: string; calls: number }> = {};
    for (const seat of seats) {
      counter.__goalStampCalls = 0;
      const reply = await ask(seat, `s_${attempt}_${seat.id.replace(/\W/g, "_")}`);
      turns[seat.id] = { reply, calls: counter.__goalStampCalls ?? 0 };
    }
    attempts.push(turns);
    if (settled(turns)) break;
  }
  out.attempts = attempts;

  out.ok = true;
  console.log("__GOAL__" + JSON.stringify(out));
}

await main();
