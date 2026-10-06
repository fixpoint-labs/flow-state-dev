/**
 * Goal check: a person's post to a mailbox that declares `routing:` runs
 * exactly one specialist, the one its purpose and the recent lines point to;
 * that specialist answers with the recent lines in view, and its answer lands
 * in the mailbox as its own line whatever the model does with its tools. A
 * mailbox without the line behaves as before.
 *
 * Real path, scripted models, out of CI. See goal.md for the contract.
 *
 * The host is `host.mts`, an app built from the published packages and the
 * fixture tree alone. It is served in-process, and everything graded is read
 * back through its own router (each seat's conversations, dispatch runs
 * included, and the mailbox's lines), plus the route model's own calls. Legs:
 *
 *   import     `routeByPurpose` resolves from `@flow-state-dev/workforce`.
 *   source     the host imports only `@flow-state-dev/*`, calls
 *              `routeByPurpose`, and builds no dispatcher or router; the
 *              routed mailbox's file declares `routing:`.
 *   one        a device, an account and a framework post each reach their
 *              specialist, and nobody else.
 *   lands      each of those, and the unclear post, gets exactly one line in
 *              the mailbox, by the seat that answered it.
 *   followup   a follow-up after the account answer reaches the account
 *              specialist, by an evaluation that saw that answer's line.
 *   held       a post sent while the specialist has not answered yet goes to
 *              it alone, with no evaluation.
 *   context    "where can I buy it?" is answered, by a specialist that was
 *              never sent the post naming "it", from that post's line; its
 *              stored conversation keeps only its own posts and answers.
 *   fallback   a post the evaluation cannot place goes to the fallback alone.
 *   unrouted   a post to the mailbox with no `routing:` wakes every agent.
 *
 * With GOAL_LIVE=1 a live leg runs after them, on real models: the route on
 * the host's own evaluation model string, the answers on a small chat model.
 *
 * Run:      pnpm --dir goals exec tsx workforce-mailboxes/a-routed-post-gets-one-answer/run.mts
 * Controls: GOAL_CONTROL=no-route       (the routing line stripped from the file)
 *           GOAL_CONTROL=no-landing     (the agent kind replaced by one that hears posts and never lands)
 *           GOAL_CONTROL=no-transcript  (the recent lines hidden from the route's evaluation)
 *           GOAL_CONTROL=no-context     (the recent lines stripped from the routed delivery)
 * Live:     GOAL_LIVE=1 (needs AI_GATEWAY_API_KEY)
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { createModelResolver, defineFlow, generator, type BlockDefinition } from "@flow-state-dev/core";
import type { EvaluationModel, ModelResolver } from "@flow-state-dev/core/types";
import {
  mailboxNotifyInputSchema,
  workerConfigSchema,
  type MailboxManifest,
  type MailboxNotifyInput
} from "@flow-state-dev/workforce";
import { readMailboxesDirectory } from "@flow-state-dev/workforce/loader";
import { gatewayModel, runGoal } from "../../lib/index.mts";
import type { HostSeams, RoutedHost } from "./host.mts";

const TREE = fileURLToPath(new URL("./fixtures/workforce", import.meta.url));
const HOST_SOURCE = fileURLToPath(new URL("./host.mts", import.meta.url));
const CONTROL = process.env.GOAL_CONTROL ?? "";
const LIVE = process.env.GOAL_LIVE === "1";

/** The legs each control must redden, and only those. Set from the runs logged in goal.md. */
const EXPECTED: Record<string, string[]> = {
  // Unrouted, every agent hears every post and nothing lands: every routed leg.
  "no-route": ["one", "lands", "followup", "held", "context", "fallback"],
  // No line ever lands, so a specialist is always "still on" the last post and
  // the hold keeps the next one: lands, and every leg a hold then diverts.
  "no-landing": ["one", "lands", "followup", "held", "context"],
  // The evaluation cannot see the account answer, so the follow-up falls back.
  "no-transcript": ["followup"],
  // The routed turn gets no lines, so "it" has no referent.
  "no-context": ["context"]
};
if (CONTROL !== "" && EXPECTED[CONTROL] === undefined) {
  throw new Error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(EXPECTED).join(", ")}`);
}

/** A seat's turn as a routed or unrouted post is heard: `<writer> in <mailbox>: <body>`. */
const heard = (post: MailboxNotifyInput) => `${post.author ?? post.principal} in ${post.mailboxId}: ${post.body}`;

/**
 * `no-landing`'s kind: hears posts and answers through `agent-answer`, with
 * the recent lines as context, and posts nothing. A kind of the app's own gets
 * the routed mark and decides what to do with it; this one does nothing.
 */
function quietAgentKind() {
  const answer = generator({
    name: "agent-answer",
    inputSchema: mailboxNotifyInputSchema,
    model: "scripted/answer",
    prompt: (_post: MailboxNotifyInput, ctx) => (ctx.flow.config as { instructions?: string }).instructions ?? "",
    context: [
      (post: MailboxNotifyInput) =>
        post.recent === undefined || post.recent.length === 0
          ? undefined
          : ["Recent lines in the mailbox, oldest first:", ...post.recent.map((l) => `- ${l.author ?? l.principal}: ${l.body}`)].join("\n")
    ],
    user: heard
  });
  const run = generator({ name: "agent-answer", inputSchema: z.object({ message: z.string() }), model: "scripted/answer", prompt: "", user: (i: { message: string }) => i.message });
  return defineFlow({
    kind: "agent",
    cardinality: "collection",
    configSchema: workerConfigSchema(),
    actions: { run: { inputSchema: z.object({ message: z.string() }), block: run } },
    internal: { actions: { onMailboxPost: { inputSchema: mailboxNotifyInputSchema, block: answer, userMessage: heard } } }
  } as never);
}

/** The control's seams on the host, or none. */
function controlSeams(): HostSeams {
  switch (CONTROL) {
    case "no-route":
      return {
        adaptMailboxes: (mailboxes: MailboxManifest[]) =>
          mailboxes.map(({ declared: { routing: _routing, ...declared }, ...rest }) => ({ ...rest, declared }))
      };
    case "no-landing":
      return { kinds: { agent: quietAgentKind() } };
    case "no-transcript":
      return {
        adaptEvaluation: (model: EvaluationModel) =>
          ({
            ...model,
            doEvaluate: (call: { state: { recent?: unknown } }) => {
              const { recent: _recent, ...state } = call.state;
              return (model as unknown as { doEvaluate: (c: unknown) => unknown }).doEvaluate({ ...call, state });
            }
          }) as unknown as EvaluationModel
      };
    case "no-context":
      return {
        adaptNotify: (wake: BlockDefinition<any, any>) =>
          wake.connectInput(({ recent: _recent, ...post }: MailboxNotifyInput) => post)
      };
    default:
      return {};
  }
}

type Message = { role: string; text: string };
type Line = { author?: string; body: string };

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
    post: async (mailboxId: string, body: string) => {
      const res = await call("POST", ["mailbox", "actions", "post"], { userId: owner, sessionId: mailboxId, input: { body } });
      if (res.status !== 200) throw new Error(`post "${body}" refused: ${res.status} ${res.text.slice(0, 300)}`);
    },
    /** A seat's conversations of one mailbox: the kept messages of each. */
    conversationsOf: async (seat: string, mailboxId: string): Promise<Message[][]> => {
      const listed = await call("GET", ["sessions"], undefined, `?flowId=${encodeURIComponent(seat)}&userId=${owner}&include=dispatch-runs&limit=100`);
      const rows = (JSON.parse(listed.text) as { sessions?: Array<{ id: string; parentSessionId?: string | null }> }).sessions ?? [];
      const out: Message[][] = [];
      for (const row of rows.filter((r) => r.parentSessionId === mailboxId)) {
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
    /** The mailbox's lines, as its `mailbox-post` items carry them, oldest first. */
    linesOf: async (mailboxId: string): Promise<Line[]> => {
      const state = await call("GET", ["sessions", mailboxId, "state"], undefined, "?include_items=true&item_types=component&limit=1000");
      const items = (JSON.parse(state.text) as { items?: Array<{ component?: string; data?: Line }> }).items ?? [];
      return items.filter((item) => item.component === "mailbox-post").map((item) => item.data!);
    }
  };
}

/** Until every request in the host has settled, twice over (a landing starts one more). Not graded. */
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

/** The scripted legs. */
async function scriptedLegs(fail: (leg: string, line: string) => void, evidence: string[]): Promise<void> {
  const { mailboxes } = await readMailboxesDirectory(TREE);
  const help = mailboxes.find((c) => c.declared.routing !== undefined);
  const lounge = mailboxes.find((c) => c.declared.routing === undefined);
  if (help === undefined || lounge === undefined) throw new Error("the fixture needs one routed and one unrouted mailbox");
  const members = help.declared.members as string[];
  const fallback = (help.declared.routing as { fallback: string }).fallback;
  const [s1, s2, s3] = members.filter((m) => m !== fallback);
  if (s3 === undefined) throw new Error(`the routed mailbox needs three specialists beside its fallback; read ${members.join(", ")}`);

  const { startRoutedHost, MAILBOX_OWNER, REPLY_MARKER } = await import("./host.mts");
  const app = await startRoutedHost(TREE, controlSeams());
  const io = reader(app, MAILBOX_OWNER);
  const run = randomUUID().replace(/-/g, "").slice(0, 10);
  const tok = (n: number) => `tok-${run}p${n}`;
  const item = `item-${run}`;
  const posts = {
    device: `[route:${s1}] ${tok(1)} My phone stopped charging, and it's a brand new cable.`,
    account: `[route:${s2}] ${tok(2)} Different thing: I was charged twice for my subscription this month.`,
    followup: `[follow-up] ${tok(3)} It was the visa card.`,
    framework: `[route:${s3}] ${tok(4)} How do I make a generator return structured output?`,
    unclear: `${tok(5)} Who do I ask about getting a parking pass?`,
    unanswered: `[route:${s1}] [answer:none] ${tok(6)} My laptop ${item} won't join the office wifi.`,
    held: `${tok(7)} It sees the network. It fails right after the password.`,
    buyIt: `[route:${fallback}] [answer:from-context] ${tok(8)} Where can I buy it?`,
    lounge: `${tok(9)} Morning, all.`
  };

  const heardBy = async (mailboxId: string, token: string) => {
    const out: string[] = [];
    for (const seat of members) {
      const turns = (await io.conversationsOf(seat, mailboxId)).flat().filter((m) => m.role === "user" && m.text.includes(token));
      if (turns.length > 0) out.push(seat);
    }
    return out;
  };
  const callsFor = (token: string) =>
    app.routeCalls.filter((c) => (c.state as { post: { text: string } }).post.text.includes(token));

  try {
    for (const body of [posts.device, posts.account, posts.followup, posts.framework, posts.unclear, posts.unanswered, posts.held, posts.buyIt]) {
      await io.post(help.id, body);
      await quiet(app, 8_000);
    }
    await io.post(lounge.id, posts.lounge);
    await quiet(app, 8_000);

    const lines = await io.linesOf(help.id);

    // ---- one: each post reaches its specialist, and nobody else -------------
    for (const [token, want] of [[tok(1), s1], [tok(2), s2], [tok(4), s3]] as const) {
      const who = await heardBy(help.id, token);
      if (who.length !== 1 || who[0] !== want) fail("one", `${token} was heard by [${who.join(", ")}] (want [${want}])`);
      else evidence.push(`${token} reached ${want} alone`);
    }

    // ---- lands: one line each, by the seat that answered --------------------
    for (const [token, want] of [[tok(1), s1], [tok(2), s2], [tok(4), s3], [tok(5), fallback]] as const) {
      const answers = lines.filter((l) => l.author !== undefined && l.body.includes(token));
      if (answers.length !== 1 || answers[0]!.author !== want || !answers[0]!.body.includes(REPLY_MARKER)) {
        fail("lands", `${token} has ${answers.length} answer line(s) in ${help.id}: ${JSON.stringify(answers)} (want one, by ${want})`);
      } else evidence.push(`${token}'s answer landed once, by ${want}`);
    }

    // ---- followup: to the account specialist, by an evaluation that saw its line
    {
      const who = await heardBy(help.id, tok(3));
      const calls = callsFor(tok(3));
      const saw = calls.some((c) => ((c.state as { recent?: Array<{ from: string }> }).recent ?? []).some((l) => l.from === s2));
      if (who.length !== 1 || who[0] !== s2) fail("followup", `${tok(3)} was heard by [${who.join(", ")}] (want [${s2}])`);
      if (calls.length !== 1 || !saw) fail("followup", `${tok(3)}'s route made ${calls.length} evaluation call(s), ${saw ? "seeing" : "not seeing"} a line by ${s2} (want one, seeing it)`);
      if (who.length === 1 && who[0] === s2 && calls.length === 1 && saw) evidence.push(`the follow-up reached ${s2} by one evaluation that saw its line`);
    }

    // ---- held: sent before the specialist answered, so no evaluation --------
    {
      const unanswered = lines.filter((l) => l.author !== undefined && l.body.includes(tok(6)));
      if (unanswered.length > 0) fail("held", `${tok(6)} was answered in the mailbox, so ${tok(7)} was not sent before an answer: ${JSON.stringify(unanswered)}`);
      const who = await heardBy(help.id, tok(7));
      const calls = callsFor(tok(7));
      if (who.length !== 1 || who[0] !== s1) fail("held", `${tok(7)} was heard by [${who.join(", ")}] (want [${s1}])`);
      if (calls.length !== 0) fail("held", `${tok(7)}'s route made ${calls.length} evaluation call(s) (want 0)`);
      if (unanswered.length === 0 && who.length === 1 && who[0] === s1 && calls.length === 0) evidence.push(`${tok(7)} went to ${s1}, still on the last post, with no evaluation`);
    }

    // ---- context: answered from a line the answering seat was never sent ----
    {
      let ok = true;
      const answer = lines.filter((l) => l.author === fallback && l.body.includes(tok(8)));
      if (answer.length !== 1 || !answer[0]!.body.includes(item)) {
        ok = false;
        fail("context", `${fallback}'s answer to ${tok(8)} does not name ${item}: ${JSON.stringify(answer)}`);
      }
      // The post that named "it", as the mailbox holds it: in no message the seat kept.
      const named = lines.find((l) => l.author === undefined && l.body.includes(tok(6)))?.body ?? posts.unanswered;
      const conversation = (await io.conversationsOf(fallback, help.id)).flat();
      if (conversation.some((m) => m.text.includes(named))) {
        ok = false;
        fail("context", `${fallback}'s stored conversation keeps the line it was shown as context`);
      }
      // Each kept message is about one post: its own. The lines it was shown are in none.
      const crowded = conversation.filter((m) => new Set(m.text.match(/tok-[a-z0-9]+/g) ?? []).size > 1);
      if (crowded.length > 0) {
        ok = false;
        fail("context", `${fallback} kept message(s) carrying other posts' lines: ${JSON.stringify(crowded)}`);
      }
      if (ok) evidence.push(`${fallback}, never sent ${tok(6)}, answered "${answer[0]!.body}", and kept none of the lines it was shown`);
    }

    // ---- fallback: a post nobody could place goes to the fallback alone ------
    {
      const who = await heardBy(help.id, tok(5));
      if (who.length !== 1 || who[0] !== fallback) fail("fallback", `${tok(5)} was heard by [${who.join(", ")}] (want [${fallback}])`);
      else evidence.push(`${tok(5)} went to ${fallback} alone`);
    }

    // ---- unrouted: every agent member hears it once; nothing lands -----------
    {
      const agents = lounge.declared.members as string[];
      for (const seat of agents) {
        const turns = (await io.conversationsOf(seat, lounge.id)).flat().filter((m) => m.role === "user" && m.text.includes(tok(9)));
        if (turns.length !== 1) fail("unrouted", `${seat} heard ${tok(9)} in ${turns.length} turns (want 1)`);
      }
      const loungeLines = await io.linesOf(lounge.id);
      if (loungeLines.length !== 1) fail("unrouted", `${lounge.id} holds ${loungeLines.length} lines (want the post alone)`);
      evidence.push(`${lounge.id}: ${agents.length} agents woken`);
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

  const { mailboxes } = await readMailboxesDirectory(TREE);
  const help = mailboxes.find((c) => c.declared.routing !== undefined)!;
  const members = help.declared.members as string[];
  const fallback = (help.declared.routing as { fallback: string }).fallback;
  const [devices, accounts, framework] = members.filter((m) => m !== fallback);

  const { startRoutedHost, MAILBOX_OWNER } = await import("./host.mts");
  const app = await startRoutedHost(TREE, { live: { modelResolver } });
  const io = reader(app, MAILBOX_OWNER);
  const posts: Array<{ body: string; want?: string }> = [
    { body: "Hi, my laptop won't join the office wifi since this morning.", want: devices },
    { body: "It sees it. It fails right after the password.", want: devices },
    { body: "My phone stopped charging, and it's a brand new cable.", want: devices },
    { body: "Where can I buy it?" },
    { body: "Different thing: I was charged twice for my subscription this month.", want: accounts },
    { body: "How do I make a generator return structured output in flow-state-dev?", want: framework },
    { body: "Who do I ask about getting a parking pass?", want: fallback }
  ];
  try {
    for (const { body, want } of posts) {
      const before = (await io.linesOf(help.id)).length;
      await io.post(help.id, body);
      await quiet(app, 120_000);
      const after = (await io.linesOf(help.id)).slice(before + 1);
      const who: string[] = [];
      for (const seat of members) {
        const turns = (await io.conversationsOf(seat, help.id)).flat().filter((m) => m.role === "user");
        if (turns.some((m) => m.text.includes(`: ${body}`))) who.push(seat);
      }
      const answers = after.filter((l) => l.author !== undefined);
      const line = `"${body}" → [${who.join(", ")}] · ${answers.length} line(s): ${answers.map((a) => `${a.author}: ${a.body}`).join(" | ")}`;
      evidence.push(line);
      console.log(`  live  ${line}`);
      if (who.length !== 1) fail("live", `"${body}" was heard by [${who.join(", ")}] (want one member)`);
      else if (want !== undefined && who[0] !== want) fail("live", `"${body}" went to ${who[0]} (want ${want})`);
      if (answers.length !== 1 || answers[0]!.author !== who[0]) fail("live", `"${body}" got ${answers.length} answer line(s) (want one, by ${who[0] ?? "its member"})`);
    }
  } finally {
    await app.state.dispose();
  }
}

await runGoal(async () => {
  const failures: string[] = [];
  const evidence: string[] = [];
  const fail = (leg: string, line: string) => failures.push(`[${leg}] ${line}`);

  // ---- import: the route is there to call ----------------------------------
  const workforce = (await import("@flow-state-dev/workforce")) as Record<string, unknown>;
  if (typeof workforce.routeByPurpose !== "function") {
    fail("import", "@flow-state-dev/workforce exports no routeByPurpose");
    return { failures, evidence: "" };
  }
  evidence.push("routeByPurpose resolves from @flow-state-dev/workforce");

  // ---- source: what the host writes ----------------------------------------
  const builds = /\b(dispatcher|keyedRouter|router)\s*\(/;
  const host = readFileSync(HOST_SOURCE, "utf8");
  const imports = [...host.matchAll(/^import[^;]*?from\s+"([^"]+)"/gms)].map((m) => m[1]!);
  const foreign = imports.filter((spec) => !spec.startsWith("@flow-state-dev/"));
  if (foreign.length > 0) fail("source", `host.mts imports from outside @flow-state-dev/*: ${foreign.join(", ")}`);
  if (builds.test(host)) fail("source", `host.mts builds its own ${builds.exec(host)![1]}`);
  if (!/routeByPurpose\s*\(/.test(host)) fail("source", "host.mts never calls routeByPurpose");
  const routed = (await readMailboxesDirectory(TREE)).mailboxes.filter((c) => c.declared.routing !== undefined);
  if (routed.length !== 1) fail("source", `the tree declares routing: on ${routed.length} mailboxes (want 1)`);
  if (!failures.some((f) => f.startsWith("[source]"))) {
    evidence.push(`host.mts imports only ${[...new Set(imports)].join(", ")}, calls routeByPurpose, and builds no dispatcher or router`);
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
