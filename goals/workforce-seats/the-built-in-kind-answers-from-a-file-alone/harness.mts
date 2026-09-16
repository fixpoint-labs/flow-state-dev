/**
 * Real-path driver for the built-in-worker-kind goal check. Copied into
 * `apps/kitchen-sink` and run there as a real ESM file by run.mts (via
 * `runHarness`), because `goals/` is not a package and cannot resolve
 * `@ai-sdk/gateway` — only an app's node_modules can. Nothing is added to
 * kitchen-sink; it is the working directory, not the subject.
 *
 * Drives the path a team adopting the framework would: read worker Markdown
 * files from disk, hire them with NO `kinds` argument so only the built-in
 * `agent` kind can answer, register the seats, and ask each one a question over
 * the real HTTP route.
 *
 * OBSERVES ONLY — every assertion lives in run.mts. This file must not decide
 * whether anything passed; it reports what happened on one `__GOAL__` line.
 *
 * The answer attempts happen HERE, inside one execution, rather than as a
 * retry loop in run.mts: `runHarness` shells out with `execFileSync`, so each
 * call is a fresh child process and a caller-side retry would re-run loading,
 * hiring and registration every attempt — re-running the very mechanism under
 * test and letting a transient fault in it be retried away as model flakiness.
 * Hiring happens once; only the question is repeated.
 *
 * Controls (`GOAL_CONTROL`) perturb THIS FILE, never the fixture tree, so the
 * fixture-integrity leg still passes and the expected failure arrives from
 * reply grading:
 *   withhold-instructions  drop each worker's body before hiring
 *   cross-wire             give each seat its sibling's body
 *   partial-hire           admit the valid record from the mixed roster
 */
import { createGateway } from "@ai-sdk/gateway";
import { createModelResolver } from "@flow-state-dev/core";
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import { hireWorkforce } from "@flow-state-dev/workforce";
import { readWorkforce } from "@flow-state-dev/workforce/loader";

const MODEL = process.env.GOAL_MODEL ?? "vercel/openai/gpt-5.4-mini";
const CONTROL = process.env.GOAL_CONTROL ?? "";
const ATTEMPTS = Number(process.env.GOAL_ATTEMPTS ?? "3");
const WORKFORCE_DIR = process.env.GOAL_WORKFORCE_DIR ?? "";
const MIXED_DIR = process.env.GOAL_MIXED_DIR ?? "";
const USER_ID = process.env.GOAL_USER_ID ?? "u_goal";
const QUESTION = process.env.GOAL_QUESTION ?? "";
const ORG_ID = process.env.GOAL_ORG_ID ?? "org_goal";
/** Worker id -> its held-out token, for the stopping rule only. See the loop. */
const TOKENS = JSON.parse(process.env.GOAL_TOKENS ?? "{}") as Record<string, string>;

/**
 * The built-in kind's default model setting is the provider-neutral intent
 * `intent/chat`. Declaring the ladder (rather than stripping it) is what lets
 * every WORKER.md carry only a description and a body, with the model coming
 * from the app's resolver — which is the shape acceptance criterion 1 names.
 */
const gatewayApiKey = process.env.AI_GATEWAY_API_KEY;
const modelResolver = createModelResolver({
  gateways: gatewayApiKey ? { vercel: createGateway({ apiKey: gatewayApiKey }) } : undefined,
  defaultModel: MODEL,
  intents: { chat: [MODEL] },
});

/**
 * The answer loop's stopping rule: every seat carried its own token and none
 * of its siblings'. Deliberately the same shape as run.mts's leg (b) grading,
 * duplicated rather than shared because a harness cannot import `goals/lib`
 * (it runs copied into the app's root) — and because run.mts stays the only
 * place a verdict is reached. Erring lenient here costs an extra call; erring
 * strict here cannot turn a failing pair green.
 */
function everySeatOnItsOwnToken(replies: Record<string, string>): boolean {
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, "");
  const ids = Object.keys(TOKENS);
  if (ids.length === 0) return false;
  return ids.every((id) => {
    const reply = norm(replies[id] ?? "");
    if (reply === "" || !reply.includes(norm(TOKENS[id]))) return false;
    return ids.every((other) => other === id || !reply.includes(norm(TOKENS[other])));
  });
}

type Item = { type?: string; role?: string; content?: unknown; text?: unknown };

/** Same extraction as `goals/lib/capture.mts`: string, parts array, or `text`. */
function messageText(item: Item): string {
  const content = item.content ?? item.text ?? "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "string" ? part : String((part as { text?: string })?.text ?? "")))
      .join("");
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

  // ---- the roster, from files alone ---------------------------------------
  const loaded = await readWorkforce(WORKFORCE_DIR);
  out.loadErrors = loaded.errors ?? [];
  out.skillErrors = loaded.skillErrors ?? [];

  const workers = loaded.workers.map((w) => ({ ...w }));
  if (CONTROL === "withhold-instructions") {
    for (const w of workers) w.body = "";
  } else if (CONTROL === "cross-wire" && workers.length === 2) {
    const [a, b] = [workers[0].body, workers[1].body];
    workers[0].body = b;
    workers[1].body = a;
  }

  out.rosterIds = workers.map((w) => w.id);
  out.rosterBodies = Object.fromEntries(workers.map((w) => [w.id, w.body]));

  // THE call under test: no `kinds` argument, so only the built-in can answer.
  const seats = hireWorkforce(workers);
  out.seatIds = seats.map((s) => s.id);

  // ---- register and ask, over the real route ------------------------------
  // `createFlowState` is the path a real app uses: it builds the flow registry
  // AND registers each flow's declared resources (the built-in kind declares a
  // skills collection), then resolves the same HTTP router.
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
      // wrong answer — a route error wearing leg (b)'s failure as a mask.
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
        // Only a completed turn's text counts. The engine persists whatever
        // items a turn emitted before it died, so accepting any terminal
        // status would let a model that printed the token and then failed
        // satisfy leg (b).
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

  // Hiring and registration happened once, above. Only the question repeats,
  // and only while the model is being flaky: a clean pair ends the loop, so a
  // passing run costs one call per seat rather than ATTEMPTS per seat.
  //
  // This is a STOPPING rule, not a verdict. run.mts grades every attempt
  // recorded here and owns the pass/fail, so a stopping rule that is too
  // lenient can only make the check fail, never pass.
  const attempts: Array<Record<string, string>> = [];
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    const replies: Record<string, string> = {};
    for (const seat of seats) {
      replies[seat.id] = await ask(seat.id, `s_${attempt}_${seat.id.replace(/\W/g, "_")}`);
    }
    attempts.push(replies);
    if (everySeatOnItsOwnToken(replies)) break;
  }
  out.attempts = attempts;

  // ---- the mixed roster: one valid worker, one naming an unregistered kind -
  const mixed = await readWorkforce(MIXED_DIR);
  const mixedRecords = mixed.workers.map((w) => ({ ...w }));
  out.mixedRosterIds = mixedRecords.map((w) => w.id);

  let threw = false;
  let refusal = "";
  let hiredSeats: Array<{ id: string }> = [];
  let returned: string[] | null = null;
  try {
    hiredSeats =
      CONTROL === "partial-hire"
        ? // The failure mode the leg exists to catch: admit the good record and
          // report the bad one, instead of refusing the whole call.
          hireWorkforce(mixedRecords.filter((w) => !Object.hasOwn(w.declared, "flow")))
        : hireWorkforce(mixedRecords);
    returned = hiredSeats.map((s) => s.id);
  } catch (error) {
    threw = true;
    refusal = error instanceof Error ? error.message : String(error);
  }
  out.refusal = { threw, message: refusal, returnedSeatIds: returned };

  // A host built from exactly what came back. Meaningful only because the
  // roster is mixed: with a valid record in play, a seat reaching the registry
  // is a real failure mode rather than an impossibility.
  {
    const afterState = createFlowState({
      flows: Object.fromEntries(hiredSeats.map((seat) => [seat.id, seat])),
      stores: { dev: { primary: inMemoryStores() } },
      modelResolver,
    } as never);
    const afterRouter = await afterState.getRouter();
    const validId = mixedRecords.find((w) => !Object.hasOwn(w.declared, "flow"))?.id ?? "";
    const path = [validId, "s_after_refusal", "actions", "run"];
    const res = await afterRouter.POST(
      new Request(`http://goal/api/flows/${path.join("/")}`, {
        method: "POST",
        body: JSON.stringify({ userId: USER_ID, orgId: ORG_ID, input: { message: QUESTION } }),
      }),
      { params: { path } } as never,
    );
    out.validWorkerStatusAfterRefusal = res.status;
  }

  out.ok = true;
  console.log("__GOAL__" + JSON.stringify(out));
}

await main();
