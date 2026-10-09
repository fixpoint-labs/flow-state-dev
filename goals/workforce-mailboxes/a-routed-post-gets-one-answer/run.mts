/**
 * Goal check: a person's post to a coordinator on `routing: best-fit` runs
 * exactly one specialist, the one its purpose points to, and that
 * specialist's answer lands in the person's conversation as its own line
 * every time. A coordinator on `routing: everyone` hands each post to every
 * delegate.
 *
 * Real path, scripted models, out of CI. See goal.md for the contract.
 *
 * The host is `host.mts`, an app built from the published packages and the
 * fixture tree alone. It is served in-process, and everything graded is read
 * back through its own router (each delegate's conversations, dispatch runs
 * included, and the person's conversation's answer lines), plus the route
 * model's own calls. Legs:
 *
 *   import     `defineCoordinatorFlow` resolves from `@flow-state-dev/workforce`.
 *   source     the host imports only `@flow-state-dev/*`, registers the
 *              coordinator flow, and builds no dispatcher or router; exactly
 *              one coordinator in the tree routes by best fit.
 *   one        a device, an account and a framework post each reach their
 *              specialist, and nobody else.
 *   lands      each of those, and the unclear post, gets exactly one line in
 *              the conversation, by the specialist that answered it.
 *   held       a post sent while the specialist has not answered yet goes to
 *              it alone, with no evaluation.
 *   fallback   a post the evaluation cannot place goes to the fallback alone.
 *   everyone   a post to the coordinator on `routing: everyone` reaches every
 *              agent once, and each answer lands there once.
 *   org        both of the person's conversations and every delegate
 *              conversation under them carry the host's named org, not the
 *              development default (FIX-1792 BR-25). Read from the store, since
 *              the router scopes what it lists to the caller's org and could not
 *              show one that landed elsewhere.
 *
 * With GOAL_LIVE=1 a live leg runs after them, on real models: the route on
 * the host's own evaluation model string, the answers on a small chat model.
 *
 * Run:      pnpm --dir goals exec tsx workforce-mailboxes/a-routed-post-gets-one-answer/run.mts
 * Controls: GOAL_CONTROL=no-route     (the best-fit coordinator read as `routing: everyone`)
 *           GOAL_CONTROL=no-landing   (the agent flow replaced by one that answers a delegated post and hands nothing back)
 *           GOAL_CONTROL=no-org       (the host's resolvePrincipal left out)
 * Live:     GOAL_LIVE=1 (needs AI_GATEWAY_API_KEY)
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { createModelResolver, defineFlow, generator, handler } from "@flow-state-dev/core";
import type { ModelResolver } from "@flow-state-dev/core/types";
import {
  delegatedPostSchema,
  workerConfigOf,
  workerConfigSchema,
  type DelegatedPost,
  type WorkerInstallation,
  type WorkerManifest
} from "@flow-state-dev/workforce";
import { readWorkforce } from "@flow-state-dev/workforce/loader";
import { gatewayModel, runGoal } from "../../lib/index.mts";
import type { HostSeams, RoutedHost } from "./host.mts";

const TREE = fileURLToPath(new URL("./fixtures/workforce", import.meta.url));
const HOST_SOURCE = fileURLToPath(new URL("./host.mts", import.meta.url));
const CONTROL = process.env.GOAL_CONTROL ?? "";
const LIVE = process.env.GOAL_LIVE === "1";

/** The legs each control must redden, and only those. Set from the runs logged in goal.md. */
const EXPECTED: Record<string, string[]> = {
  // Every delegate hears every post, and each answers it: every best-fit leg.
  "no-route": ["one", "lands", "held", "fallback"],
  // No answer ever lands, so the specialist on the first post holds every next
  // one: lands, every leg the hold then diverts, and the answers on everyone.
  "no-landing": ["one", "lands", "fallback", "everyone"],
  // No resolver names the org: every session lands in the development default.
  "no-org": ["org"]
};
if (CONTROL !== "" && EXPECTED[CONTROL] === undefined) {
  throw new Error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(EXPECTED).join(", ")}`);
}

/** How a delegate's turn reads a delegated post: `<from>, through <coordinator>: <body>`. */
const heard = (post: DelegatedPost) => `${post.from}, through ${post.coordinator}: ${post.body}`;

/**
 * `no-landing`'s agent flow: takes a delegated post and answers it through
 * `agent-answer` in its own conversation, and never hands the answer back.
 */
function quietAgentFlow(installation: WorkerInstallation) {
  const answer = generator({
    name: "agent-answer",
    inputSchema: delegatedPostSchema,
    model: "scripted/answer",
    prompt: (_post: DelegatedPost, ctx) => (workerConfigOf(ctx) as { instructions?: string }).instructions ?? "",
    user: heard
  });
  const run = generator({ name: "agent-answer", inputSchema: z.object({ message: z.string() }), model: "scripted/answer", prompt: "", user: (i: { message: string }) => i.message });
  const loadWorker = handler({
    name: "quiet-agent-load-worker",
    inputSchema: z.unknown(),
    resources: { ...installation.resources },
    execute: async (_input, ctx) => ({ worker: (await installation.resolveWorker(ctx, "agent")).id })
  });
  return defineFlow({
    kind: "agent",
    configSchema: workerConfigSchema(),
    session: installation.session(),
    resources: { ...installation.resources },
    request: { onStarted: loadWorker },
    actions: { run: { inputSchema: z.object({ message: z.string() }), block: run, userMessage: (i: { message: string }) => i.message } },
    internal: { actions: { onDelegatedPost: { inputSchema: delegatedPostSchema, block: answer, userMessage: heard } } }
  } as never);
}

/** The control's seams on the host, or none. */
function controlSeams(): HostSeams {
  switch (CONTROL) {
    case "no-route":
      return {
        adaptWorkers: (workers: WorkerManifest[]) =>
          workers.map((w) => (w.declared.routing === "best-fit" ? { ...w, declared: { ...w.declared, routing: "everyone" } } : w))
      };
    case "no-landing":
      return { agent: (installation: WorkerInstallation) => quietAgentFlow(installation) };
    case "no-org":
      return { omitPrincipal: true };
    default:
      return {};
  }
}

type Message = { role: string; text: string };
type Line = { author?: string; text: string };

/** Reads through the host's own router, the routes a page reads. */
function reader(app: RoutedHost, owner: string) {
  const call = async (method: "GET" | "POST", segments: string[], body?: unknown, query = "") => {
    const res = await app.router[method](
      new Request(`http://routed-host.local/api/flows/${segments.map(encodeURIComponent).join("/")}${query}`, {
        method,
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      }),
      { params: { path: segments } }
    );
    return { status: res.status, text: await res.text() };
  };
  return {
    /** The person's conversation with a coordinator, opened the way a page opens one. */
    open: async (coordinator: string) => {
      const res = await call("POST", ["coordinator", "sessions"], { userId: owner, state: { workerId: coordinator } });
      if (res.status !== 201) throw new Error(`a conversation with ${coordinator} was not opened: ${res.status} ${res.text.slice(0, 300)}`);
      return (JSON.parse(res.text) as { session: { id: string } }).session.id;
    },
    post: async (conversation: string, message: string) => {
      const res = await call("POST", ["coordinator", "actions", "run"], { userId: owner, sessionId: conversation, input: { message } });
      if (res.status !== 200) throw new Error(`post "${message}" refused: ${res.status} ${res.text.slice(0, 300)}`);
    },
    /** A delegate's conversations under one of the person's: the kept messages of each. */
    conversationsOf: async (seat: string, conversation: string): Promise<Message[][]> => {
      const listed = await call("GET", ["sessions"], undefined, `?flowId=agent&state.workerId=${encodeURIComponent(seat)}&userId=${owner}&include=dispatch-runs&limit=100`);
      const rows = (JSON.parse(listed.text) as { sessions?: Array<{ id: string; parentSessionId?: string | null }> }).sessions ?? [];
      const out: Message[][] = [];
      for (const row of rows.filter((r) => r.parentSessionId === conversation)) {
        const state = await call("GET", ["sessions", row.id, "state"], undefined, "?include_items=true&item_types=message&limit=1000");
        const items = (JSON.parse(state.text) as { items?: Array<{ role?: string; transient?: boolean; content?: Array<{ text?: string }> }> }).items ?? [];
        out.push(
          items
            .filter((item) => item.transient !== true)
            .map((item) => ({ role: item.role ?? "", text: (item.content ?? []).map((c) => c.text ?? "").join("") }))
        );
      }
      return out;
    },
    /** The conversation's lines, oldest first: the person's posts, and each answer under its delegate's name. */
    linesOf: async (conversation: string): Promise<Line[]> => {
      const state = await call("GET", ["sessions", conversation, "state"], undefined, "?include_items=true&item_types=message&limit=1000");
      const items = (JSON.parse(state.text) as { items?: Array<{ role?: string; agentName?: string; transient?: boolean; content?: Array<{ text?: string }> }> }).items ?? [];
      return items
        .filter((item) => item.transient !== true && (item.role === "user" || item.agentName !== undefined))
        .map((item) => ({
          ...(item.agentName === undefined ? {} : { author: item.agentName }),
          text: (item.content ?? []).map((c) => c.text ?? "").join("")
        }));
    }
  };
}

/** Until every request in the host has settled, three reads running. Not graded. */
async function quiet(app: RoutedHost, ms: number): Promise<void> {
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

/** The two coordinators the fixture holds: the routed one and the one on `everyone`, read off the tree. */
async function coordinatorsOf(tree: string) {
  const { workers } = await readWorkforce(tree);
  const coordinators = workers.filter((w) => w.declared.flow === "coordinator");
  const help = coordinators.find((w) => w.declared.routing === "best-fit");
  const lounge = coordinators.find((w) => w.declared.routing === "everyone");
  if (help === undefined || lounge === undefined) throw new Error("the fixture needs one coordinator on best-fit and one on everyone");
  const delegates = help.declared.delegates as string[];
  const fallback = help.declared.fallback as string;
  return { help, lounge, delegates, fallback };
}

/** The scripted legs. */
async function scriptedLegs(fail: (leg: string, line: string) => void, evidence: string[]): Promise<void> {
  const { help, lounge, delegates, fallback } = await coordinatorsOf(TREE);
  const [s1, s2, s3] = delegates.filter((m) => m !== fallback);
  if (s3 === undefined) throw new Error(`the routed coordinator needs three specialists beside its fallback; read ${delegates.join(", ")}`);

  const { startRoutedHost, OWNER, ORG, REPLY_MARKER } = await import("./host.mts");
  const app = await startRoutedHost(TREE, controlSeams());
  const io = reader(app, OWNER);
  const run = randomUUID().replace(/-/g, "").slice(0, 10);
  const tok = (n: number) => `tok-${run}p${n}`;
  const posts = {
    device: `[route:${s1}] ${tok(1)} My phone stopped charging, and it's a brand new cable.`,
    account: `[route:${s2}] ${tok(2)} Different thing: I was charged twice for my subscription this month.`,
    framework: `[route:${s3}] ${tok(4)} How do I make a generator return structured output?`,
    unclear: `${tok(5)} Who do I ask about getting a parking pass?`,
    unanswered: `[route:${s1}] [answer:none] ${tok(6)} My laptop won't join the office wifi.`,
    held: `${tok(7)} It sees the network. It fails right after the password.`,
    lounge: `${tok(9)} Morning, all.`
  };

  try {
    const conversation = await io.open(help.id);
    const loungeConversation = await io.open(lounge.id);
    const heardBy = async (token: string) => {
      const out: string[] = [];
      for (const seat of delegates) {
        const turns = (await io.conversationsOf(seat, conversation)).flat().filter((m) => m.role === "user" && m.text.includes(token));
        if (turns.length > 0) out.push(seat);
      }
      return out;
    };
    const callsFor = (token: string) =>
      app.routeCalls.filter((c) => (c.state as { post: { text: string } }).post.text.includes(token));

    for (const body of [posts.device, posts.account, posts.framework, posts.unclear, posts.unanswered, posts.held]) {
      await io.post(conversation, body);
      await quiet(app, 8_000);
    }
    await io.post(loungeConversation, posts.lounge);
    await quiet(app, 8_000);

    const lines = await io.linesOf(conversation);

    // ---- one: each post reaches its specialist, and nobody else -------------
    for (const [token, want] of [[tok(1), s1], [tok(2), s2], [tok(4), s3]] as const) {
      const who = await heardBy(token);
      if (who.length !== 1 || who[0] !== want) fail("one", `${token} was heard by [${who.join(", ")}] (want [${want}])`);
      else evidence.push(`${token} reached ${want} alone`);
    }

    // ---- lands: one line each, by the specialist that answered --------------
    for (const [token, want] of [[tok(1), s1], [tok(2), s2], [tok(4), s3], [tok(5), fallback]] as const) {
      const answers = lines.filter((l) => l.author !== undefined && l.text.includes(token));
      if (answers.length !== 1 || answers[0]!.author !== want || !answers[0]!.text.includes(REPLY_MARKER)) {
        fail("lands", `${token} has ${answers.length} answer line(s) in ${help.id}'s conversation: ${JSON.stringify(answers)} (want one, by ${want})`);
      } else evidence.push(`${token}'s answer landed once, by ${want}`);
    }

    // ---- held: sent before the specialist answered, so no evaluation --------
    {
      const unanswered = lines.filter((l) => l.author !== undefined && l.text.includes(tok(6)));
      if (unanswered.length > 0) fail("held", `${tok(6)} was answered in the conversation, so ${tok(7)} was not sent before an answer: ${JSON.stringify(unanswered)}`);
      const who = await heardBy(tok(7));
      const calls = callsFor(tok(7));
      if (who.length !== 1 || who[0] !== s1) fail("held", `${tok(7)} was heard by [${who.join(", ")}] (want [${s1}])`);
      if (calls.length !== 0) fail("held", `${tok(7)}'s route made ${calls.length} evaluation call(s) (want 0)`);
      if (unanswered.length === 0 && who.length === 1 && who[0] === s1 && calls.length === 0) evidence.push(`${tok(7)} went to ${s1}, still on the last post, with no evaluation`);
    }

    // ---- fallback: a post nobody could place goes to the fallback alone ------
    {
      const who = await heardBy(tok(5));
      if (who.length !== 1 || who[0] !== fallback) fail("fallback", `${tok(5)} was heard by [${who.join(", ")}] (want [${fallback}])`);
      else evidence.push(`${tok(5)} went to ${fallback} alone`);
    }

    // ---- everyone: every agent hears it once; each answer lands once ---------
    {
      const agents = lounge.declared.delegates as string[];
      let ok = true;
      for (const seat of agents) {
        const turns = (await io.conversationsOf(seat, loungeConversation)).flat().filter((m) => m.role === "user" && m.text.includes(tok(9)));
        if (turns.length !== 1) {
          ok = false;
          fail("everyone", `${seat} heard ${tok(9)} in ${turns.length} turns (want 1)`);
        }
      }
      const loungeLines = (await io.linesOf(loungeConversation)).filter((l) => l.author !== undefined && l.text.includes(tok(9)));
      for (const seat of agents) {
        const by = loungeLines.filter((l) => l.author === seat);
        if (by.length !== 1) {
          ok = false;
          fail("everyone", `${lounge.id}'s conversation holds ${by.length} answer line(s) by ${seat} to ${tok(9)} (want 1)`);
        }
      }
      if (ok) evidence.push(`${lounge.id}: ${agents.length} agents heard the post once, and each answer landed once`);
    }

    // ---- org: both conversations and each delegate's carry the named org -----
    {
      const runtime = await app.state.getRuntime();
      const opened = [conversation, loungeConversation];
      const made = (await runtime.stores.session.list({ parentage: "all" })).filter(
        (s) => opened.includes(s.id) || (s.parentSessionId != null && opened.includes(s.parentSessionId))
      );
      const delegateSessions = made.filter((s) => !opened.includes(s.id));
      // How many delegate sessions there should be is the other legs' to
      // grade; this leg grades the org of the ones there are.
      const missing = opened.filter((id) => !made.some((s) => s.id === id));
      const off = made.filter((s) => s.orgId !== ORG);
      for (const id of missing) fail("org", `the store holds no session ${id}`);
      for (const s of off) fail("org", `${s.flowId ?? s.flowKind} session ${s.id} carries org ${String(s.orgId)} (want ${ORG})`);
      if (missing.length === 0 && off.length === 0) {
        evidence.push(`both conversations and their ${delegateSessions.length} delegate session(s) carry ${ORG}`);
      }
    }
  } finally {
    await app.state.dispose();
  }
}

/** The live leg: real models, the POC's posts. */
async function liveLeg(fail: (leg: string, line: string) => void, evidence: string[]): Promise<void> {
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) {
    fail("live", "GOAL_LIVE=1 needs AI_GATEWAY_API_KEY");
    return;
  }
  // `goals/` cannot resolve the gateway package; kitchen-sink's node_modules can.
  const ksRequire = createRequire(new URL("../../../apps/kitchen-sink/package.json", import.meta.url));
  const { createGateway } = (await import(ksRequire.resolve("@ai-sdk/gateway"))) as {
    createGateway: (options: { apiKey: string }) => unknown;
  };
  const answerModel = gatewayModel();
  const modelResolver: ModelResolver = createModelResolver({
    gateways: { vercel: createGateway({ apiKey }) as never },
    defaultModel: answerModel,
    intents: { chat: [answerModel] }
  });

  const { help, delegates, fallback } = await coordinatorsOf(TREE);
  const [devices, accounts, framework] = delegates.filter((m) => m !== fallback);

  const { startRoutedHost, OWNER } = await import("./host.mts");
  const app = await startRoutedHost(TREE, { live: { modelResolver } });
  const io = reader(app, OWNER);
  const posts: Array<{ body: string; want?: string }> = [
    { body: "Hi, my laptop won't join the office wifi since this morning.", want: devices },
    // The follow-up names no subject; best fit routes it on its own words (goal.md, "Retired legs").
    { body: "It sees it. It fails right after the password." },
    { body: "My phone stopped charging, and it's a brand new cable.", want: devices },
    { body: "Where can I buy it?" },
    { body: "Different thing: I was charged twice for my subscription this month.", want: accounts },
    { body: "How do I make a generator return structured output in flow-state-dev?", want: framework },
    { body: "Who do I ask about getting a parking pass?", want: fallback }
  ];
  try {
    const conversation = await io.open(help.id);
    for (const { body, want } of posts) {
      const before = (await io.linesOf(conversation)).length;
      await io.post(conversation, body);
      await quiet(app, 120_000);
      const after = (await io.linesOf(conversation)).slice(before + 1);
      const who: string[] = [];
      for (const seat of delegates) {
        const turns = (await io.conversationsOf(seat, conversation)).flat().filter((m) => m.role === "user");
        if (turns.some((m) => m.text.endsWith(`: ${body}`))) who.push(seat);
      }
      const answers = after.filter((l) => l.author !== undefined);
      const line = `"${body}" → [${who.join(", ")}] · ${answers.length} line(s): ${answers.map((a) => `${a.author}: ${a.text}`).join(" | ")}`;
      evidence.push(line);
      console.log(`  live  ${line}`);
      if (who.length !== 1) fail("live", `"${body}" was heard by [${who.join(", ")}] (want one delegate)`);
      else if (want !== undefined && who[0] !== want) fail("live", `"${body}" went to ${who[0]} (want ${want})`);
      if (answers.length !== 1 || answers[0]!.author !== who[0]) fail("live", `"${body}" got ${answers.length} answer line(s) (want one, by ${who[0] ?? "its delegate"})`);
    }
  } finally {
    await app.state.dispose();
  }
}

await runGoal(async (failures) => {
  const evidence: string[] = [];
  const fail = (leg: string, line: string) => failures.push(`[${leg}] ${line}`);

  // ---- import: the flow is there to register -------------------------------
  const workforce = (await import("@flow-state-dev/workforce")) as Record<string, unknown>;
  if (typeof workforce.defineCoordinatorFlow !== "function") {
    fail("import", "@flow-state-dev/workforce exports no defineCoordinatorFlow");
    return { failures, evidence: "" };
  }
  evidence.push("defineCoordinatorFlow resolves from @flow-state-dev/workforce");

  // ---- source: what the host writes ----------------------------------------
  const builds = /\b(dispatcher|keyedRouter|router)\s*\(/;
  const host = readFileSync(HOST_SOURCE, "utf8");
  const imports = [...host.matchAll(/^import[^;]*?from\s+"([^"]+)"/gms)].map((m) => m[1]!);
  const foreign = imports.filter((spec) => !spec.startsWith("@flow-state-dev/"));
  if (foreign.length > 0) fail("source", `host.mts imports from outside @flow-state-dev/*: ${foreign.join(", ")}`);
  if (builds.test(host)) fail("source", `host.mts builds its own ${builds.exec(host)![1]}`);
  if (!/defineCoordinatorFlow\s*\(/.test(host)) fail("source", "host.mts never registers defineCoordinatorFlow");
  const routed = (await readWorkforce(TREE)).workers.filter((w) => w.declared.flow === "coordinator" && w.declared.routing === "best-fit");
  if (routed.length !== 1) fail("source", `the tree declares routing: best-fit on ${routed.length} coordinators (want 1)`);
  if (!failures.some((f) => f.startsWith("[source]"))) {
    evidence.push(`host.mts imports only ${[...new Set(imports)].join(", ")}, registers defineCoordinatorFlow, and builds no dispatcher or router`);
  }

  await scriptedLegs(fail, evidence);
  if (LIVE) await liveLeg(fail, evidence);

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
