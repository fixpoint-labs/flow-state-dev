/**
 * Goal check for FIX-1613: a conversation longer than its history window still
 * answers from a turn that left it, because a running summary holds what was
 * said before the window, and the model reads that summary instead of the turn.
 *
 * The flow is this goal's own: a chat whose answer generator installs core's
 * `historySummary` capability and runs its fold step first, on a real model,
 * over the SQLite store, with no memory. The host is disposed and started again
 * on the same file midway, so later folds read the summary back from the store.
 * The legs and what each control must fail are in goal.md.
 *
 * Run: pnpm tsx goals/history-window/remembers-turns-past-the-window/run.mts
 * Size: GOAL_WINDOW=50 GOAL_TURNS=60 (default 8 and 14); GOAL_RUNS (default 3)
 * Controls: GOAL_CONTROL=no-summary (no capability, no fold) · GOAL_CONTROL=no-mark (no historyStart)
 */
import { spawnSync } from "node:child_process";
import { randomInt } from "node:crypto";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { defineFlow, generator, sequencer, utility } from "@flow-state-dev/core";
import { createFlowState, createModelResolver } from "@flow-state-dev/engine";
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
  loadFixture,
  modulePatchEnv,
  runGoal,
  silentLogger,
  type ModulePatch
} from "../../lib/index.mts";

const SCRATCH = goalTmpDir("remembers-turns-past-the-window");
const MODEL = gatewayModel(goalModel());
const USER_ID = "u_history_window";
const ORG_ID = "org_history_window";
const FLOW = "history-chat";
const WINDOW = Number(process.env.GOAL_WINDOW ?? 8);
const TURNS = Number(process.env.GOAL_TURNS ?? 14);
const RUNS = Number(process.env.GOAL_RUNS ?? 3);
const TURN_TIMEOUT_MS = 180_000;
const SUMMARY_LIMIT = 4_000;

const CONTROL = process.env.GOAL_CONTROL ?? "";
const CONTROLS: Record<string, { patches: ModulePatch[]; assertions: string[] }> = {
  // The flow as it was before: the answer generator reads the window and nothing else.
  "no-summary": { patches: [], assertions: ["w:answer"] },
  // Main before this change: no request records where the turns it read begin.
  "no-mark": {
    assertions: ["w:mark"],
    patches: [
      {
        module: "packages/engine/src/context/createExecutionContext.ts",
        from: String.raw`if \(historyStart !== undefined && requestRecord\.historyStart`,
        to: "if (false && historyStart !== undefined && requestRecord.historyStart"
      }
    ]
  }
};
if (CONTROL !== "" && CONTROLS[CONTROL] === undefined) {
  console.error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(CONTROLS).join(", ")}`);
  process.exit(2);
}
const control = CONTROL === "" ? undefined : CONTROLS[CONTROL]!;
if (control !== undefined && control.patches.length > 0 && process.env.GOAL_MODULE_PATCH === undefined) {
  const mark = join(SCRATCH, `patch-mark-${RUN_STAMP}`);
  rmSync(mark, { force: true });
  console.error(`control ${CONTROL}:\n${describePatches(control.patches, REPO_ROOT)}`);
  const child = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, ...modulePatchEnv(control.patches, REPO_ROOT, mark) }
  });
  assertPatched(control.patches, REPO_ROOT, mark);
  process.exit(child.status ?? 1);
}
if (TURNS - 1 <= WINDOW) {
  console.error(`GOAL_TURNS (${TURNS}) must exceed GOAL_WINDOW + 1 (${WINDOW + 1}), or turn 1 never leaves the window`);
  process.exit(2);
}

const say = (s: string) => console.error(`[history-window ${new Date().toISOString().slice(11, 19)}] ${s}`);
const show = (value: unknown) => JSON.stringify(value)?.slice(0, 400);
const pick = <T,>(list: readonly T[]): T => list[randomInt(list.length)]!;
const textOf = (content: unknown): string =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((part: { text?: string }) => part.text ?? "").join("")
      : JSON.stringify(content ?? "");

const fixture = loadFixture<{ colours: string[]; animals: string[]; numbers: number[]; fillers: string[] }>(
  import.meta.url,
  "conversation.json"
);

/** Folds the fold step should run over `turns` turns, each one finished before the next: the rule in history-summary.ts. */
function expectedFolds(window: number, turns: number): { total: number; firstAt: number } {
  const quarter = Math.max(1, Math.floor(window / 4));
  let mark = 0;
  let total = 0;
  let firstAt = 0;
  for (let t = 1; t <= turns; t += 1) {
    const windowStart = Math.max(1, t - window);
    const after = t - 1 - Math.max(mark, windowStart - 1);
    if (after > window - quarter) {
      mark += quarter;
      total += 1;
      if (firstAt === 0) firstAt = t;
    }
  }
  return { total, firstAt };
}

type ModelCall = { id: string; messages: Array<{ role: string; content: unknown }> };

function startHost(db: string, calls: ModelCall[]) {
  const earlier =
    CONTROL === "no-summary"
      ? undefined
      : utility.historySummary({
          summarize: utility.summarizer({
            name: "earlier-turns",
            model: "goal/summary",
            granularity: "detailed",
            // `summary` is the running summary and `turns` the turns to add to it.
            objectives: [
              "The input's `summary` is the summary so far and `turns` are newer turns: write one summary of both, never of the turns alone.",
              "Keep every name, code and number the user stated, word for word."
            ]
          })
        });
  const answer = generator({
    name: "answer",
    model: "goal/answer",
    prompt: "You are a helpful assistant. Answer in one or two sentences.",
    history: true,
    itemVisibility: { client: true, history: true },
    ...(earlier ? { uses: [earlier.capability] } : {})
  });
  const chat = sequencer({ name: "chat", inputSchema: z.object({ message: z.string() }) });
  const flow = defineFlow({
    kind: FLOW,
    session: { historyWindow: { turns: WINDOW } },
    actions: {
      say: {
        inputSchema: z.object({ message: z.string() }),
        block: earlier ? chat.tap(earlier.fold).step(answer) : chat.step(answer),
        userMessage: (input: { message: string }) => input.message
      }
    }
  })();

  const real = createModelResolver() as unknown as (id: string, block?: string) => any;
  const mapped = (id: string) => (id.startsWith("goal/") || id.startsWith("intent/") ? MODEL : id);
  const recorded = (id: string, model: any) =>
    new Proxy(model, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value !== "function") return value;
        if (["generate", "stream", "generateStep", "streamStep"].includes(String(prop))) {
          return (options: { messages: ModelCall["messages"] }) => {
            calls.push({ id, messages: options.messages });
            return value.call(target, options);
          };
        }
        return value.bind(target);
      }
    });
  const modelResolver = Object.assign((id: string, block?: string) => recorded(id, real(mapped(id), block)), {
    resolveId: mapped
  });
  return createFlowState({
    flows: { [FLOW]: flow },
    stores: { default: { primary: sqliteStores({ filename: db }) } },
    logger: silentLogger,
    modelResolver,
    resolvePrincipal: (context: any) => {
      const user = context.request?.headers.get("x-user");
      return typeof user === "string" ? { userId: user, orgId: ORG_ID } : null;
    }
  } as never);
}

type Host = ReturnType<typeof startHost>;

async function turn(host: Host, sessionId: string, message: string): Promise<void> {
  const { client } = actingAs(host as never, USER_ID);
  const sent = await client.flow(FLOW).send("say", { message }, { sessionId });
  const { status } = await sent.wait({ pollMs: 50, timeoutMs: TURN_TIMEOUT_MS });
  if (status !== "completed") throw new Error(`turn "${message.slice(0, 40)}" ended ${status}`);
}

/** The summary's public face, as a screen reads it. */
async function summaryAsSeen(host: Host, sessionId: string): Promise<{ complete?: boolean; folds?: number; throughRequestId?: string } | undefined> {
  const { client } = actingAs(host as never, USER_ID);
  const snapshot = await client.sessions.state(sessionId);
  return (snapshot.resources?.session?.historySummary as { clientData?: any } | undefined)?.clientData;
}

/** The stored summary itself, read off the store: its length is graded, never its wording. */
async function storedSummary(host: Host, sessionId: string): Promise<string | null | undefined> {
  const stores = (await host.getRuntime()).stores as any;
  const row = await stores.resourceState.get("session", sessionId, "historySummary");
  return row === undefined ? undefined : (row.state?.summary ?? null);
}

await runGoal(async (failures, tell) => {
  const key = keysServing(MODEL).find((k) => (process.env[k] ?? "") !== "");
  if (key === undefined) return { failures: [`blocked: no key here serves ${MODEL}; none of ${keysServing(MODEL).join(", ")} is set`], evidence: "" };
  const plan = expectedFolds(WINDOW, TURNS);
  const restartBefore = plan.firstAt + 1;
  say(`model ${MODEL}; window ${WINDOW}; turns ${TURNS}; runs ${RUNS}; folds expected ${plan.total}, restart before turn ${restartBefore}${CONTROL ? `; control ${CONTROL}` : ""}`);
  const notes: string[] = [];

  for (let run = 1; run <= RUNS; run += 1) {
    const fact = { colour: pick(fixture.colours), animal: pick(fixture.animals), number: pick(fixture.numbers) };
    const code = `${fact.colour} ${fact.animal} ${fact.number}`;
    const fillers = [...fixture.fillers].sort(() => randomInt(3) - 1);
    const messages = [
      `Something to remember for later: I am naming my new sailboat "${code}". Just say OK for now.`,
      ...Array.from({ length: TURNS - 2 }, (_, i) => fillers[i % fillers.length]!),
      "What did I say I am naming my sailboat? Reply with just the name."
    ];
    const db = join(SCRATCH, `${RUN_STAMP}-${run}.sqlite`);
    const calls: ModelCall[] = [];
    let host = startHost(db, calls);
    const sessionId = await actingAs(host as never, USER_ID).open(FLOW, {});
    let foldsBeforeRestart = 0;
    try {
      for (let t = 1; t <= TURNS; t += 1) {
        if (t === restartBefore) {
          foldsBeforeRestart = (await summaryAsSeen(host, sessionId))?.folds ?? 0;
          await host.dispose();
          host = startHost(db, calls);
          say(`run ${run}: restarted on ${db} before turn ${t} (${foldsBeforeRestart} folds so far)`);
        }
        if (t === TURNS) calls.length = 0;
        await turn(host, sessionId, messages[t - 1]!);
      }

      const { client } = actingAs(host as never, USER_ID);
      const requests = await client.sessions.requests(sessionId, { includeResultOutput: true, limit: TURNS + 5 });
      tell.over(`run ${run} · the session's requests`, requests);
      const byStart = [...requests].sort((a: any, b: any) => (a.startedAtMs ?? a.createdAt) - (b.startedAtMs ?? b.createdAt));
      const last = byStart.at(-1) as any;
      const answer = textOf(last?.result?.output);
      say(`run ${run}: code ${code}; answer ${show(answer)}`);

      // w:answer — the last answer holds the fact said in turn 1.
      tell.over(`run ${run} · the last answer`, [answer].filter((s) => s !== ""));
      const missing = [fact.colour, fact.animal, String(fact.number)].filter((word) => !answer.toLowerCase().includes(word));
      if (missing.length > 0) failures.push(`w:answer — run ${run}: the last answer lacks ${missing.join(", ")} of "${code}": ${show(answer)}`);

      // w:out-of-window — turn 1 is not among what the answer model read on the last turn.
      const answerCalls = tell.over(`run ${run} · the answer model's calls on the last turn`, calls.filter((c) => c.id === "goal/answer"));
      const spoken = answerCalls.flatMap((c) => c.messages.filter((m) => m.role !== "system"));
      tell.over(`run ${run} · the conversation the answer model read`, spoken);
      say(`run ${run}: the answer model read ${show(spoken.map((m) => [m.role, textOf(m.content).slice(0, 30)]))}`);
      const leaked = spoken.filter((m) => textOf(m.content).toLowerCase().includes(fact.animal));
      if (leaked.length > 0) failures.push(`w:out-of-window — run ${run}: turn 1's words reached the answer model as conversation: ${show(leaked.map((m) => [m.role, textOf(m.content).slice(0, 80)]))}`);

      // w:mark — the screen's divider and the summary's public state.
      const seen = await summaryAsSeen(host, sessionId);
      const ids = new Set(requests.map((r: any) => r.id));
      if (last?.historyStart?.requestId === undefined || !ids.has(last.historyStart.requestId)) {
        failures.push(`w:mark — run ${run}: the last request carries no historyStart naming a turn of this session: ${show(last?.historyStart)}`);
      }
      if (seen?.complete !== true || seen.throughRequestId === undefined || !ids.has(seen.throughRequestId)) {
        failures.push(`w:mark — run ${run}: the summary does not read complete through a turn of this session: ${show(seen)}`);
      }

      // w:folds — enough folds, one after the restart, and the summary stays bounded.
      const folds = seen?.folds ?? 0;
      const summary = await storedSummary(host, sessionId);
      const wanted = Math.min(3, plan.total);
      say(`run ${run}: summary ${show(summary)}`);
      if (folds < wanted) failures.push(`w:folds — run ${run}: ${folds} folds ran, wanted at least ${wanted} (${plan.total} by the rule)`);
      if (folds <= foldsBeforeRestart) failures.push(`w:folds — run ${run}: no fold ran after the restart (${foldsBeforeRestart} before, ${folds} after)`);
      if (typeof summary !== "string" || summary.length >= SUMMARY_LIMIT) {
        failures.push(`w:folds — run ${run}: the stored summary is ${typeof summary === "string" ? `${summary.length} characters` : show(summary)}, wanted under ${SUMMARY_LIMIT}`);
      }
      notes.push(`run ${run}: "${code}" → ${show(answer)}; folds ${foldsBeforeRestart}→${folds}; summary ${typeof summary === "string" ? summary.length : "-"} chars; historyStart ${last?.historyStart?.requestId}; read ${spoken.length} conversation messages (${spoken.map((m) => m.role[0]).join("")})`);
    } finally {
      await host.dispose();
    }
  }

  return {
    failures,
    evidence: `${RUNS} conversations of ${TURNS} turns on a ${WINDOW}-turn window, each restarted on its SQLite file before turn ${restartBefore}:\n${notes.join("\n")}`
  };
});
