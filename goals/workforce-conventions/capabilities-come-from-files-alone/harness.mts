/**
 * Real-path driver for the per-seat-capability goal check. Copied into
 * `apps/kitchen-sink` and run there as a real ESM file by run.mts (via
 * `runHarness`), because `goals/` is not a package and cannot resolve
 * `@ai-sdk/gateway` — only an app's node_modules can. Nothing is added to
 * kitchen-sink; it is the working directory, not the subject.
 *
 * Drives what a team adopting the convention would do: put a capability in a
 * team's `resources/` folder, run the command, hand the capabilities half to
 * the worker kind, and hire two seats whose own files differ only in what they
 * name. Then ask both the same question over the real HTTP route.
 *
 * OBSERVES ONLY — every assertion lives in run.mts. This file must not decide
 * whether anything passed; it reports what happened on one `__GOAL__` line.
 *
 * The answer attempts happen HERE, inside one execution, rather than as a
 * retry loop in run.mts: `runHarness` shells out per call, so a caller-side
 * retry would re-run discovery, installing and hiring every attempt — retrying
 * the mechanism under test and letting a fault in it be written off as model
 * flakiness. The install and the hire happen once; only the question repeats.
 *
 * Controls (`GOAL_CONTROL`) perturb THIS FILE, never the fixture tree, so the
 * fixture-integrity leg still passes and the expected failure arrives from
 * reply grading:
 *   install-everything  turn every preset on for the whole kind, which is the
 *                       shape the seat key exists to replace — both seats then
 *                       know both facts
 *   ignore-selection    drop each seat's `capabilities:` before hiring, so the
 *                       seat that named one is no better off than its sibling
 */
import { createGateway } from "@ai-sdk/gateway";
import { createModelResolver } from "@flow-state-dev/core";
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import {
  defineAgentWorkerFlow,
  hireWorkforce,
  splitResourceModules,
} from "@flow-state-dev/workforce";
import { readWorkforce } from "@flow-state-dev/workforce/loader";

const MODEL = process.env.GOAL_MODEL ?? "vercel/openai/gpt-5.4-mini";
const CONTROL = process.env.GOAL_CONTROL ?? "";
const ATTEMPTS = Number(process.env.GOAL_ATTEMPTS ?? "3");
const WORKFORCE_DIR = process.env.GOAL_WORKFORCE_DIR ?? "";
const GEN_MODULE = process.env.GOAL_GEN_MODULE ?? "";
const USER_ID = process.env.GOAL_USER_ID ?? "u_goal";
const ORG_ID = process.env.GOAL_ORG_ID ?? "org_goal";
const QUESTION = process.env.GOAL_QUESTION ?? "";
/** Seat id -> the fact only that seat's own file should have reached. */
const KNOWS = JSON.parse(process.env.GOAL_KNOWS ?? "{}") as Record<string, string | null>;

/**
 * The built-in kind's default model setting is the provider-neutral intent
 * `intent/chat`, so the app's resolver picks the concrete model and every
 * WORKER.md can stay free of one.
 */
const gatewayApiKey = process.env.AI_GATEWAY_API_KEY;
const modelResolver = createModelResolver({
  gateways: gatewayApiKey ? { vercel: createGateway({ apiKey: gatewayApiKey }) } : undefined,
  defaultModel: MODEL,
  intents: { chat: [MODEL] },
});

/**
 * The answer loop's stopping rule: the seat that named a preset said its fact
 * and the seat that named nothing did not. Deliberately the same shape as
 * run.mts's grading, duplicated rather than shared because a harness cannot
 * import `goals/lib` — and because run.mts stays the only place a verdict is
 * reached. Erring lenient here costs an extra call; erring strict here cannot
 * turn a failing pair green.
 */
function eachSeatOnItsOwnFile(replies: Record<string, string>): boolean {
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, "");
  return Object.entries(KNOWS).every(([id, fact]) => {
    const reply = norm(replies[id] ?? "");
    if (reply === "") return false;
    return fact === null ? !reply.includes(norm(fact ?? "")) : reply.includes(norm(fact));
  });
}

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

async function main(): Promise<void> {
  const out: Record<string, unknown> = { ok: false, control: CONTROL || null, model: MODEL };

  // ---- the roster and the capability, from files alone --------------------
  const loaded = await readWorkforce(WORKFORCE_DIR);
  out.loadErrors = loaded.errors ?? [];
  out.skillErrors = loaded.skillErrors ?? [];

  const workers = loaded.workers.map((w) => ({ ...w, declared: { ...w.declared } }));
  if (CONTROL === "ignore-selection") {
    for (const w of workers) delete w.declared.capabilities;
  }
  out.rosterIds = workers.map((w) => w.id);
  out.selections = Object.fromEntries(workers.map((w) => [w.id, w.declared.capabilities ?? null]));

  // The generated module, imported the way an app imports it — a committed
  // file of ordinary static imports, written by `fsdev gen` from the tree.
  const generated = (await import(GEN_MODULE)) as { resourceModules: Record<string, unknown> };
  out.discoveredRefs = Object.keys(generated.resourceModules);

  const { capabilities } = splitResourceModules(generated.resourceModules as never);
  out.installedCapabilities = capabilities.map((c) => c.name);

  // The failure mode the seat key replaces: every preset on, for every seat.
  const installed =
    CONTROL === "install-everything"
      ? capabilities.map((c) =>
          (c as unknown as { presets(o: Record<string, boolean>): unknown }).presets(
            Object.fromEntries(
              Object.keys((c as unknown as { __presetDefs?: Record<string, unknown> }).__presetDefs ?? {})
                .filter((k) => k !== "default")
                .map((k) => [k, true]),
            ),
          ),
        )
      : capabilities;

  const agent = defineAgentWorkerFlow({ uses: installed as never });
  const seats = hireWorkforce(workers, { kinds: { agent } });
  out.seatIds = seats.map((s) => s.id);

  // ---- register and ask, over the real route ------------------------------
  const flowState = createFlowState({
    flows: Object.fromEntries(seats.map((seat) => [seat.id, seat])),
    stores: { dev: { primary: inMemoryStores() } },
    modelResolver,
  } as never);
  const router = await flowState.getRouter();
  const stores = (await flowState.getRuntime()).stores;
  out.registered = seats.map((s) => s.id);

  async function ask(address: string, sessionId: string): Promise<string> {
    const path = [address, sessionId, "actions", "run"];
    const res = await router.POST(
      new Request(`http://goal/api/flows/${path.join("/")}`, {
        method: "POST",
        body: JSON.stringify({ userId: USER_ID, orgId: ORG_ID, input: { message: QUESTION } }),
      }),
      { params: { path } } as never,
    );
    if (!res.ok) {
      throw new Error(`POST ${path.join("/")} returned ${res.status}: ${await res.text()}`);
    }
    const body = (await res.json()) as { request?: { id: string } };
    const requestId = body.request?.id;
    if (requestId === undefined || requestId === "") {
      // Polling an empty id just times out, and an empty reply grades as a
      // wrong answer — a route error wearing the grading leg's failure as a
      // mask.
      throw new Error(`POST ${path.join("/")} returned no request id: ${JSON.stringify(body)}`);
    }
    // The engine's own liveness window is 30s, so a shorter budget here would
    // report a healthy-but-slow call as an empty reply for the same reason.
    const deadline = Date.now() + 35_000;
    while (Date.now() < deadline) {
      const record = (await stores.request.get(requestId)) as
        | { status?: string; items?: Item[]; output?: unknown }
        | undefined;
      if (record !== undefined && record.status !== undefined && record.status !== "in_progress") {
        // Only a completed turn's text counts: the engine persists whatever a
        // turn emitted before it died, so accepting any terminal status would
        // let a model that printed the fact and then failed pass.
        if (record.status !== "completed") {
          throw new Error(`${address}: the request ended "${record.status}", not "completed"`);
        }
        const fromItems = assistantText(record.items ?? []);
        const fromOutput = typeof record.output === "string" ? record.output : "";
        return `${fromItems}\n${fromOutput}`.trim();
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`${address}: no terminal status within 35s`);
  }

  // Discovery, installing and hiring happened once, above. Only the question
  // repeats, and only while the model is being flaky. This is a STOPPING rule,
  // not a verdict: run.mts grades every attempt recorded here.
  const attempts: Array<Record<string, string>> = [];
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    const replies: Record<string, string> = {};
    for (const seat of seats) {
      replies[seat.id] = await ask(seat.id, `s_${attempt}_${seat.id.replace(/\W/g, "_")}`);
    }
    attempts.push(replies);
    if (eachSeatOnItsOwnFile(replies)) break;
  }
  out.attempts = attempts;

  out.ok = true;
  console.log("__GOAL__" + JSON.stringify(out));
}

await main();
