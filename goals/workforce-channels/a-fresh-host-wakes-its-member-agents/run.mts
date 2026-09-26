/**
 * Goal check: a host with none of kitchen-sink's code wakes each member agent
 * seat once per post, and never on a seat's own post, by calling one Workforce
 * helper, and kitchen-sink runs on that same helper.
 *
 * Real path, scripted model, out of CI. See goal.md for the contract.
 *
 * The host is `host.mts`, an app built from the published packages and the
 * fixture tree alone. It is served in-process, and everything graded is read
 * back through its own router, the routes a page reads: each seat's
 * conversations, dispatch runs included. Legs:
 *
 *   import     `wakeMemberSeats` resolves from `@flow-state-dev/workforce`.
 *   woken      each agent member holds one conversation of the channel, both
 *              person posts heard once in it, each with a reply under it.
 *   seat-post  a post an agent member wrote is heard by no seat.
 *   other      the member whose kind declares no `onChannelPost` holds nothing.
 *   source     the host imports only `@flow-state-dev/*` and builds no
 *              dispatcher or router; kitchen-sink's notify module calls the
 *              helper and builds neither, and its kind map has no wake column.
 *
 * Who is an agent member is read off the tree (a worker with no `flow:`), so
 * renamed folders grade the same way.
 *
 * Run:      pnpm tsx goals/workforce-channels/a-fresh-host-wakes-its-member-agents/run.mts
 * Controls: GOAL_CONTROL=no-wake           (no notify block: must FAIL at woken, and nothing else)
 *           GOAL_CONTROL=no-author-filter  (author stripped before the helper: must FAIL at seat-post, and nothing else)
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { BlockDefinition } from "@flow-state-dev/core";
import type { ChannelNotifyInput } from "@flow-state-dev/workforce";
import { readChannelsDirectory, readWorkforce } from "@flow-state-dev/workforce/loader";
import { KITCHEN_SINK, runGoal } from "../../lib/index.mts";

const TREE = fileURLToPath(new URL("./fixtures/workforce", import.meta.url));
const HOST_SOURCE = fileURLToPath(new URL("./host.mts", import.meta.url));
const CONTROL = process.env.GOAL_CONTROL ?? "";

/** The legs each control must redden, and only those. */
const EXPECTED: Record<string, string[]> = {
  // No notify block: a post reaches no seat.
  "no-wake": ["woken"],
  // The host strips `author` before the helper: an agent's own post wakes the agents.
  "no-author-filter": ["seat-post"],
};
if (CONTROL !== "" && EXPECTED[CONTROL] === undefined) {
  throw new Error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(EXPECTED).join(", ")}`);
}

/** The control's change to the wake the host builds, or none. */
function adaptNotify(wake: BlockDefinition<any, any>): BlockDefinition<any, any> | undefined {
  if (CONTROL === "no-wake") return undefined;
  if (CONTROL === "no-author-filter") {
    return wake.connectInput(({ author: _author, ...post }: ChannelNotifyInput) => post);
  }
  return wake;
}

type Message = { role: string; text: string };
type Conversation = { id: string; parentSessionId?: string; messages: Message[] };

await runGoal(async () => {
  const failures: string[] = [];
  const evidence: string[] = [];
  const fail = (leg: string, line: string) => failures.push(`[${leg}] ${line}`);

  // ---- import: the helper is there to call --------------------------------
  const workforce = (await import("@flow-state-dev/workforce")) as Record<string, unknown>;
  if (typeof workforce.wakeMemberSeats !== "function") {
    fail("import", "@flow-state-dev/workforce exports no wakeMemberSeats");
    return { failures, evidence: "" };
  }
  evidence.push("wakeMemberSeats resolves from @flow-state-dev/workforce");

  // ---- source: what the host and kitchen-sink write ------------------------
  const builds = /\b(dispatcher|keyedRouter|router)\s*\(/;
  const host = readFileSync(HOST_SOURCE, "utf8");
  const imports = [...host.matchAll(/^import[^;]*?from\s+"([^"]+)"/gms)].map((m) => m[1]!);
  const foreign = imports.filter((spec) => !spec.startsWith("@flow-state-dev/"));
  if (foreign.length > 0) fail("source", `host.mts imports from outside @flow-state-dev/*: ${foreign.join(", ")}`);
  if (builds.test(host)) fail("source", `host.mts builds its own ${builds.exec(host)![1]}`);
  if (!/wakeMemberSeats\s*\(/.test(host)) fail("source", "host.mts never calls wakeMemberSeats");
  const notifyModule = readFileSync(`${KITCHEN_SINK}/workforce/channel-notify.ts`, "utf8");
  if (builds.test(notifyModule)) fail("source", `kitchen-sink's channel-notify.ts builds its own ${builds.exec(notifyModule)![1]}`);
  if (!/wakeMemberSeats\s*\(/.test(notifyModule)) fail("source", "kitchen-sink's channel-notify.ts never calls wakeMemberSeats");
  const shell = readFileSync(`${KITCHEN_SINK}/lib/workforce-shell.ts`, "utf8");
  const asks = /export const SEAT_ASKS = \{([\s\S]*?)\} as const/.exec(shell)?.[1];
  if (asks === undefined) fail("source", "kitchen-sink's lib/workforce-shell.ts has no SEAT_ASKS to read");
  else if (/\bwake\s*:/.test(asks)) fail("source", "kitchen-sink's SEAT_ASKS still carries a wake column");
  if (!failures.some((f) => f.startsWith("[source]"))) {
    evidence.push(`host.mts imports only ${[...new Set(imports)].join(", ")} and builds no dispatcher or router; kitchen-sink's notify module calls wakeMemberSeats and builds neither`);
  }

  // ---- the tree: who should hear a post ------------------------------------
  const { workers } = await readWorkforce(TREE);
  const { channels } = await readChannelsDirectory(TREE);
  const channel = channels[0]!;
  const members = channel.declared.members as string[];
  const agents = members.filter((id) => !Object.hasOwn(workers.find((w) => w.id === id)?.declared ?? {}, "flow"));
  const others = members.filter((id) => !agents.includes(id));
  if (agents.length < 2 || others.length < 1) {
    throw new Error(`the fixture needs two agent members and one other; read ${agents.join(", ")} / ${others.join(", ")}`);
  }

  const { startFreshHost, CHANNEL_OWNER, REPLY_MARKER } = await import("./host.mts");
  const app = await startFreshHost(TREE, adaptNotify);
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
  const post = async (body: string, author?: string) => {
    const input = author === undefined ? { body } : { body, author };
    const res = await call("POST", [String(channel.declared.flow ?? "channel"), "actions", "post"], { userId: CHANNEL_OWNER, sessionId: channel.id, input });
    if (res.status !== 200) throw new Error(`post "${body}" refused: ${res.status} ${res.text.slice(0, 300)}`);
  };
  const conversationsOf = async (seat: string): Promise<Conversation[]> => {
    const listed = await call("GET", ["sessions"], undefined, `?flowId=${encodeURIComponent(seat)}&userId=${CHANNEL_OWNER}&include=dispatch-runs&limit=100`);
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
  /** Poll until `done`, up to `ms`. Not graded: whatever did not happen fails below. */
  const settle = async (done: () => Promise<boolean>, ms: number) => {
    const until = Date.now() + ms;
    while (Date.now() < until && !(await done())) await new Promise((r) => setTimeout(r, 50));
  };
  const answered = async (token: string) => {
    for (const seat of agents) {
      const heard = (await conversationsOf(seat)).flatMap((c) => c.messages);
      if (!heard.some((m) => m.role === "assistant" && m.text.includes(REPLY_MARKER))) return false;
      if (!heard.some((m) => m.text.includes(token))) return false;
    }
    return true;
  };

  const run = randomUUID().replace(/-/g, "").slice(0, 10);
  const tokens = [`wake-token-a${run}`, `wake-token-b${run}`];
  const seatToken = `seat-token-${run}`;
  try {
    for (const token of tokens) {
      await post(`${token} can someone look at the refund queue?`);
      await settle(() => answered(token), 5_000);
    }
    // An agent member speaks in the channel, as a seat would: with its author.
    await post(`${seatToken} I looked; it is empty.`, agents[0]);
    // Give a wrongly woken seat time to run, so its absence is not a race.
    await new Promise((r) => setTimeout(r, 1_500));

    // ---- woken: one conversation each, both posts heard once, a reply to each
    for (const seat of agents) {
      const runs = (await conversationsOf(seat)).filter((c) => c.parentSessionId === channel.id);
      if (runs.length !== 1) {
        fail("woken", `${seat} holds ${runs.length} conversations of ${channel.id} (want 1)`);
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
      if (ok) evidence.push(`${seat}: one conversation of ${channel.id}, each person's post heard once and answered ("${messages.find((m) => m.role === "user")!.text}")`);
    }

    // ---- seat-post: the agent's own post is heard by nobody ------------------
    const heardSeatPost: string[] = [];
    for (const seat of members) {
      const turns = (await conversationsOf(seat)).flatMap((c) => c.messages).filter((m) => m.text.includes(seatToken));
      if (turns.length > 0) heardSeatPost.push(`${seat} (${JSON.stringify(turns[0]!.text)})`);
    }
    if (heardSeatPost.length > 0) fail("seat-post", `${agents[0]}'s own post was heard by ${heardSeatPost.join(", ")}`);
    else evidence.push(`${agents[0]}'s own post was heard by no seat`);

    // ---- other: the member whose kind cannot hear a post holds nothing -------
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
