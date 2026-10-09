/**
 * Goal check: a host with none of kitchen-sink's code hands each post in a
 * coordinator conversation to every agent delegate once, and a delegate's
 * answer wakes nobody, by declaring the coordinator in a worker file
 * (`flow: coordinator`, `routing: everyone`) and registering Workforce's
 * coordinator flow; kitchen-sink runs on that same flow.
 *
 * Real path, scripted model, out of CI. See goal.md for the contract.
 *
 * The host is `host.mts`, an app built from the published packages and the
 * fixture tree alone. It is served in-process, and everything graded is read
 * back through its own router, the routes a page reads: the coordinator
 * conversation's items and each delegate's conversations, dispatch runs
 * included. Legs:
 *
 *   import     `defineCoordinatorFlow` resolves from `@flow-state-dev/workforce`.
 *   woken      each agent delegate holds one conversation under the person's,
 *              both posts heard once in it, each with a reply under it.
 *   answers    the person's conversation holds one answer line per post from
 *              each agent delegate, under its name.
 *   quiet      no delegate hears another's answer.
 *   other      the delegate whose flow takes no posts holds nothing.
 *   source     the host imports only `@flow-state-dev/*`, registers the
 *              coordinator flow and builds no dispatcher or router, and the
 *              tree's coordinator routes to everyone; kitchen-sink registers
 *              the same flow and builds neither, and its kind map has no wake
 *              column.
 *
 * Who is an agent delegate is read off the tree (a worker with no `flow:`),
 * so renamed folders grade the same way.
 *
 * Run:      pnpm --dir goals exec tsx workforce-mailboxes/a-fresh-host-wakes-its-member-agents/run.mts
 * Controls: GOAL_CONTROL=no-wake        (no flow takes a delegated post: must FAIL at woken and answers, and nothing else)
 *           GOAL_CONTROL=answers-go-on  (the coordinator read with `rounds: 1`: must FAIL at answers and quiet, and nothing else)
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { WorkerManifest } from "@flow-state-dev/workforce";
import { readWorkforce } from "@flow-state-dev/workforce/loader";
import { KITCHEN_SINK, runGoal } from "../../lib/index.mts";
import type { FreshHost, HostSeams } from "./host.mts";

const TREE = fileURLToPath(new URL("./fixtures/workforce", import.meta.url));
const HOST_SOURCE = fileURLToPath(new URL("./host.mts", import.meta.url));
const CONTROL = process.env.GOAL_CONTROL ?? "";

/** The legs each control must redden, and only those. */
const EXPECTED: Record<string, string[]> = {
  // No flow takes a delegated post: the post reaches no delegate, and nothing answers.
  "no-wake": ["woken", "answers"],
  // Each round's answers go back out: each delegate hears the other's answer and answers it.
  "answers-go-on": ["answers", "quiet"],
};
if (CONTROL !== "" && EXPECTED[CONTROL] === undefined) {
  throw new Error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(EXPECTED).join(", ")}`);
}

/** The control's seams on the host, or none. */
function controlSeams(): HostSeams {
  switch (CONTROL) {
    case "no-wake":
      return { adaptDelegateFlows: () => [] };
    case "answers-go-on":
      return {
        adaptWorkers: (workers: WorkerManifest[]) =>
          workers.map((w) => (w.declared.flow === "coordinator" ? { ...w, declared: { ...w.declared, rounds: 1 } } : w)),
      };
    default:
      return {};
  }
}

type Message = { role: string; text: string };
type Conversation = { id: string; parentSessionId?: string; messages: Message[] };

/** Until every request in the host has settled, three reads running. Not graded. */
async function quiet(app: FreshHost, ms: number): Promise<void> {
  const runtime = await app.state.getRuntime();
  const busy = async () => {
    for (const session of await runtime.stores.session.list({ parentage: "all" })) {
      const requests = await runtime.stores.request.list({ sessionId: session.id });
      if (requests.some((r) => r.status === "in_progress")) return true;
    }
    return false;
  };
  const until = Date.now() + ms;
  for (let calm = 0; calm < 3 && Date.now() < until; ) {
    calm = (await busy()) ? 0 : calm + 1;
    await new Promise((r) => setTimeout(r, 50));
  }
}

await runGoal(async (failures) => {
  const evidence: string[] = [];
  const fail = (leg: string, line: string) => failures.push(`[${leg}] ${line}`);

  // ---- import: the flow is there to register --------------------------------
  const workforce = (await import("@flow-state-dev/workforce")) as Record<string, unknown>;
  if (typeof workforce.defineCoordinatorFlow !== "function") {
    fail("import", "@flow-state-dev/workforce exports no defineCoordinatorFlow");
    return { failures, evidence: "" };
  }
  evidence.push("defineCoordinatorFlow resolves from @flow-state-dev/workforce");

  // ---- the tree: the coordinator, and who should hear a post ------------------
  const { workers } = await readWorkforce(TREE);
  const coordinators = workers.filter((w) => w.declared.flow === "coordinator");
  const coordinator = coordinators[0];
  if (coordinators.length !== 1 || coordinator === undefined) {
    throw new Error(`the fixture needs one coordinator; read ${coordinators.map((w) => w.id).join(", ") || "none"}`);
  }
  const delegates = (coordinator.declared.delegates ?? []) as string[];
  const agents = delegates.filter((id) => !Object.hasOwn(workers.find((w) => w.id === id)?.declared ?? {}, "flow"));
  const others = delegates.filter((id) => !agents.includes(id));
  if (agents.length < 2 || others.length < 1) {
    throw new Error(`the fixture needs two agent delegates and one other; read ${agents.join(", ")} / ${others.join(", ")}`);
  }

  // ---- source: what the host and kitchen-sink write ---------------------------
  const builds = /\b(dispatcher|keyedRouter|router)\s*\(/;
  const host = readFileSync(HOST_SOURCE, "utf8");
  const imports = [...host.matchAll(/^import[^;]*?from\s+"([^"]+)"/gms)].map((m) => m[1]!);
  const foreign = imports.filter((spec) => !spec.startsWith("@flow-state-dev/"));
  if (foreign.length > 0) fail("source", `host.mts imports from outside @flow-state-dev/*: ${foreign.join(", ")}`);
  if (builds.test(host)) fail("source", `host.mts builds its own ${builds.exec(host)![1]}`);
  if (!/defineCoordinatorFlow\s*\(/.test(host)) fail("source", "host.mts never registers defineCoordinatorFlow");
  if (coordinator.declared.routing !== "everyone") {
    fail("source", `${coordinator.id} routes by ${String(coordinator.declared.routing ?? "its default")} (want everyone)`);
  }
  const hire = readFileSync(`${KITCHEN_SINK}/workforce/hire.ts`, "utf8");
  if (builds.test(hire)) fail("source", `kitchen-sink's workforce/hire.ts builds its own ${builds.exec(hire)![1]}`);
  if (!/defineCoordinatorFlow\s*\(/.test(hire)) fail("source", "kitchen-sink's workforce/hire.ts never registers defineCoordinatorFlow");
  const shell = readFileSync(`${KITCHEN_SINK}/lib/workforce-shell.ts`, "utf8");
  const asks = /export const SEAT_ASKS = \{([\s\S]*?)\} as const/.exec(shell)?.[1];
  if (asks === undefined) fail("source", "kitchen-sink's lib/workforce-shell.ts has no SEAT_ASKS to read");
  else if (/\bwake\s*:/.test(asks)) fail("source", "kitchen-sink's SEAT_ASKS still carries a wake column");
  if (!failures.some((f) => f.startsWith("[source]"))) {
    evidence.push(
      `host.mts imports only ${[...new Set(imports)].join(", ")}, registers defineCoordinatorFlow and builds no dispatcher or router; ` +
        `${coordinator.id} routes to everyone; kitchen-sink registers defineCoordinatorFlow and builds neither`,
    );
  }

  const { startFreshHost, OWNER, REPLY_MARKER } = await import("./host.mts");
  const app = await startFreshHost(TREE, controlSeams());
  const call = async (method: "GET" | "POST", segments: string[], body?: unknown, query = "") => {
    const res = await app.router[method](
      new Request(`http://fresh-host.local/api/flows/${segments.map(encodeURIComponent).join("/")}${query}`, {
        method,
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      { params: { path: segments } },
    );
    return { status: res.status, text: await res.text() };
  };
  /** The person's conversation with the coordinator, opened the way a page opens one. */
  const opened = await call("POST", ["coordinator", "sessions"], { userId: OWNER, state: { workerId: coordinator.id } });
  if (opened.status !== 201) throw new Error(`the conversation was not opened: ${opened.status} ${opened.text.slice(0, 300)}`);
  const conversation = (JSON.parse(opened.text) as { session: { id: string } }).session.id;
  const post = async (message: string) => {
    const res = await call("POST", ["coordinator", "actions", "run"], { userId: OWNER, sessionId: conversation, input: { message } });
    if (res.status !== 200) throw new Error(`post "${message}" refused: ${res.status} ${res.text.slice(0, 300)}`);
  };
  const conversationsOf = async (seat: string): Promise<Conversation[]> => {
    const listed = await call("GET", ["sessions"], undefined, `?flowId=agent&state.workerId=${encodeURIComponent(seat)}&userId=${OWNER}&include=dispatch-runs&limit=100`);
    const rows = (JSON.parse(listed.text) as { sessions?: Array<{ id: string; parentSessionId?: string | null }> }).sessions ?? [];
    const out: Conversation[] = [];
    for (const row of rows) {
      const state = await call("GET", ["sessions", row.id, "state"], undefined, "?include_items=true&item_types=message&limit=1000");
      const items = (JSON.parse(state.text) as { items?: Array<{ role?: string; transient?: boolean; content?: Array<{ text?: string }> }> }).items ?? [];
      out.push({
        id: row.id,
        ...(row.parentSessionId == null ? {} : { parentSessionId: row.parentSessionId }),
        messages: items
          .filter((item) => item.transient !== true)
          .map((item) => ({ role: item.role ?? "", text: (item.content ?? []).map((c) => c.text ?? "").join("") })),
      });
    }
    return out;
  };
  /** The answer lines the person's conversation holds: each message a delegate's name is on. */
  const answerLines = async () => {
    const state = await call("GET", ["sessions", conversation, "state"], undefined, "?include_items=true&item_types=message&limit=1000");
    const items = (JSON.parse(state.text) as { items?: Array<{ agentName?: string; transient?: boolean; content?: Array<{ text?: string }> }> }).items ?? [];
    return items
      .filter((item) => item.transient !== true && typeof item.agentName === "string")
      .map((item) => ({ author: item.agentName!, text: (item.content ?? []).map((c) => c.text ?? "").join("") }));
  };

  const run = randomUUID().replace(/-/g, "").slice(0, 10);
  const tokens = [`wake-token-a${run}`, `wake-token-b${run}`];
  try {
    for (const token of tokens) {
      await post(`${token} can someone look at the refund queue?`);
      await quiet(app, 8_000);
    }
    // Give a wrongly woken delegate time to run, so its absence is not a race.
    await new Promise((r) => setTimeout(r, 1_500));
    await quiet(app, 8_000);

    // ---- woken: one conversation each, both posts heard once, a reply to each --
    for (const seat of agents) {
      const runs = (await conversationsOf(seat)).filter((c) => c.parentSessionId === conversation);
      if (runs.length !== 1) {
        fail("woken", `${seat} holds ${runs.length} conversations under ${conversation} (want 1)`);
        continue;
      }
      const messages = runs[0]!.messages;
      let ok = true;
      for (const token of tokens) {
        const at = messages.map((m, i) => (m.role === "user" && m.text.includes(token) ? i : -1)).filter((i) => i >= 0);
        const reply = at.length === 1 ? messages[at[0]! + 1] : undefined;
        if (at.length !== 1 || reply?.role !== "assistant" || !reply.text.includes(REPLY_MARKER)) {
          ok = false;
          fail("woken", `${seat} heard ${token} in ${at.length} turns (want 1, with a reply under it): ${JSON.stringify(messages.map((m) => `${m.role}: ${m.text}`))}`);
        }
      }
      if (ok) evidence.push(`${seat}: one conversation under ${coordinator.id}'s, each post heard once and answered ("${messages.find((m) => m.role === "user")!.text}")`);
    }

    // ---- answers: one line per post from each agent delegate, under its name ---
    {
      const lines = await answerLines();
      let ok = true;
      for (const seat of agents) {
        const by = lines.filter((line) => line.author === seat && line.text.includes(REPLY_MARKER));
        if (by.length !== tokens.length) {
          ok = false;
          fail("answers", `${conversation} holds ${by.length} answer line(s) by ${seat} (want ${tokens.length}, one per post)`);
        }
      }
      const strangers = lines.filter((line) => !agents.includes(line.author));
      if (strangers.length > 0) {
        ok = false;
        fail("answers", `${conversation} holds answer lines by ${[...new Set(strangers.map((l) => l.author))].join(", ")}, which are not agent delegates`);
      }
      if (ok) evidence.push(`${conversation}: ${tokens.length} answer lines from each of ${agents.join(", ")}`);
    }

    // ---- quiet: no delegate hears another's answer -----------------------------
    {
      const heardAnswers: string[] = [];
      for (const seat of delegates) {
        const turns = (await conversationsOf(seat)).flatMap((c) => c.messages).filter((m) => m.role === "user" && m.text.includes(REPLY_MARKER));
        if (turns.length > 0) heardAnswers.push(`${seat} (${JSON.stringify(turns[0]!.text)})`);
      }
      if (heardAnswers.length > 0) fail("quiet", `a delegate's answer was heard by ${heardAnswers.join(", ")}`);
      else evidence.push("no delegate heard another's answer");
    }

    // ---- other: the delegate whose flow takes no posts holds nothing -----------
    for (const seat of others) {
      const held = await conversationsOf(seat);
      if (held.length > 0) fail("other", `${seat} holds ${held.length} conversations (want 0)`);
      else evidence.push(`${seat}: no conversation`);
    }
  } finally {
    await app.state.dispose();
  }

  // A control must redden each leg it names, and only those.
  if (CONTROL !== "") {
    const want = EXPECTED[CONTROL]!;
    const legs = new Set(failures.map((f) => /^\[([^\]]+)\]/.exec(f)?.[1] ?? ""));
    for (const leg of want) {
      if (!legs.has(leg)) failures.push(`[control] GOAL_CONTROL=${CONTROL} left the ${leg} leg green, so that leg cannot fail`);
    }
    for (const leg of legs) {
      if (!want.includes(leg) && leg !== "control") failures.push(`[control] GOAL_CONTROL=${CONTROL} also reddened the ${leg} leg`);
    }
  }
  return { failures, evidence: evidence.join("; ") };
});
