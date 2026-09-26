/**
 * POC — FIX-1602 · can a stock wake pick its seats off the hired seats alone?
 *
 * Throwaway design evidence for the spec, not production code and not the goal
 * check. It answers two premises the spec rests on:
 *
 *   P1  A seat `hireWorkforce` returns carries its kind's internal entries, so
 *       "does this seat declare `onChannelPost`?" is answerable from the seat
 *       itself, with no kind table in the package or the host. The built-in
 *       `agent` kind says yes (once FIX-1590 lands); a kind with only a public
 *       action says no.
 *   P2  A notify block built ONLY from that answer — one dispatcher per seat
 *       that declares the entry, keyed on the channel, author posts routed to
 *       a silent fallback — wakes each such member once per post on a real
 *       in-process host, reuses one conversation per seat per channel, runs
 *       nothing for a member whose kind lacks the entry, and runs nothing for
 *       a post that names an author.
 *
 * Model-free: the woken kind here is a handler that writes a line to a file,
 * so "it ran" is a side effect, not a report. The agent kind is hired only to
 * read its entries (P1); it never runs.
 *
 * Run against a checkout where the agent kind declares `onChannelPost`
 * (FIX-1590's branch or later), from a directory whose node_modules resolves
 * the workspace packages, e.g. the goals workspace:
 *
 *   tsx specs/issues/FIX-1602/poc/wake-by-entry/run.mts
 *
 * Control: GOAL_CONTROL=no-author-filter drops the author rule from the sketch.
 * P2's "a seat's own post wakes nobody" leg must FAIL under it.
 */
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { defineFlow, dispatcher, handler, utility, type BlockDefinition } from "@flow-state-dev/core";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import {
  CHANNEL_KIND,
  channelInstances,
  channelNotifyInputSchema,
  defineAgentWorkerFlow,
  defineChannelFlow,
  hireWorkforce,
  openChannels,
  workerConfigSchema,
  type ChannelNotifyInput
} from "@flow-state-dev/workforce";
import { readChannelsDirectory, readWorkforce } from "@flow-state-dev/workforce/loader";

const TREE = fileURLToPath(new URL("./fixtures/workforce", import.meta.url));
const CONTROL = process.env.GOAL_CONTROL ?? "";
const USER_ID = "u_wake_poc";
const ORG_ID = "org_wake_poc";
const LOG = join(mkdtempSync(join(tmpdir(), "fsd-1602-poc-")), "heard.txt");
writeFileSync(LOG, "", "utf8");

const ENTRY = "onChannelPost";
const failures: string[] = [];
const note = (line: string) => console.log(line);

// ---- the two app kinds ------------------------------------------------------
const heard = handler({
  name: "listener-heard",
  inputSchema: channelNotifyInputSchema,
  outputSchema: z.object({ ok: z.boolean() }),
  execute: async (post: ChannelNotifyInput, ctx) => {
    // flow id | the conversation this ran in | which post
    writeFileSync(LOG, `${ctx.flow.id}|${ctx.session.identity.id}|${post.postId}|${post.body}\n`, { flag: "a" });
    return { ok: true };
  }
});
const answer = handler({
  name: "listener-answer",
  inputSchema: z.object({ message: z.string() }),
  outputSchema: z.object({ ok: z.boolean() }),
  execute: async () => ({ ok: true })
});
const listenerKind = defineFlow({
  kind: "listener",
  cardinality: "collection",
  configSchema: workerConfigSchema(),
  actions: { ask: { block: answer } },
  internal: { actions: { [ENTRY]: { inputSchema: channelNotifyInputSchema, block: heard } } }
} as never);
const noteKind = defineFlow({
  kind: "note",
  cardinality: "collection",
  configSchema: workerConfigSchema(),
  actions: { ask: { block: answer } }
} as never);

// ---- hire from the tree -----------------------------------------------------
const roster = await readWorkforce(TREE);
const read = await readChannelsDirectory(TREE);
if (roster.errors.length > 0 || read.errors.length > 0) throw new Error("fixture tree did not load");
const seats = hireWorkforce(roster.workers, {
  kinds: { listener: listenerKind as never, note: noteKind as never, agent: defineAgentWorkerFlow() }
});

// ---- P1: the entry is readable off the hired seat ---------------------------
const declares = (seat: (typeof seats)[number]) =>
  Object.prototype.hasOwnProperty.call(seat.internal?.actions ?? {}, ENTRY);
const table = seats.map((seat) => `${seat.id}(${seat.kind}): ${declares(seat) ? "declares" : "no"} ${ENTRY}`);
note(`P1 · ${table.join(" · ")}`);
const want: Record<string, boolean> = { listener: true, note: false, agent: true };
for (const seat of seats) {
  if (declares(seat) !== want[seat.kind]) failures.push(`P1: ${seat.id} (${seat.kind}) declares=${declares(seat)}`);
}

// ---- P2: the sketch — derived from the seats, nothing else ------------------
const silent = handler({
  name: "wake-none",
  inputSchema: channelNotifyInputSchema,
  outputSchema: z.object({ woke: z.literal(false) }),
  execute: async () => ({ woke: false as const })
});
const wakes: Record<string, BlockDefinition<any, any>> = {};
for (const seat of seats.filter(declares)) {
  wakes[seat.id] = dispatcher({
    name: `wake-${seat.id}`,
    flowKind: seat.id,
    action: ENTRY,
    inputSchema: channelNotifyInputSchema,
    session: { key: (post: ChannelNotifyInput) => `channel:${post.channelId}` }
  });
}
const notify = utility.keyedRouter({
  name: "wake-member-seats-sketch",
  inputSchema: channelNotifyInputSchema,
  blocks: wakes,
  select: (post: ChannelNotifyInput) =>
    CONTROL !== "no-author-filter" && post.author !== undefined ? "" : post.member,
  fallback: silent
});

const channels = read.channels;
const channel = channels[0]!;
const instances = channelInstances(channels, { kinds: { channel: defineChannelFlow({ notify }) } });
const state = createFlowState({
  flows: {
    ...Object.fromEntries(instances.map((i) => [i.kind, i])),
    ...Object.fromEntries(seats.map((s) => [s.id, s]))
  },
  stores: { default: { primary: inMemoryStores() } }
} as never);

try {
  const runtime = await state.getRuntime();
  await openChannels(channels, {
    client: {
      createSession: async (o: { flowKind: string; userId: string; sessionId?: string; orgId?: string; description?: string; state?: Record<string, unknown> }) => {
        const id = String(o.sessionId);
        const now = Date.now();
        await runtime.stores.session.set(
          id,
          { id, flowKind: o.flowKind, flowId: o.flowKind, userId: o.userId, orgId: o.orgId ?? ORG_ID, description: o.description, state: o.state ?? {}, lineageId: `lin_${id}`, version: 0, createdAt: now, updatedAt: now, journal: [] } as never,
          "absent"
        );
        return { id };
      },
      getSession: async (sessionId: string) => {
        const f = (await runtime.stores.session.get(sessionId)) as { flowKind: string; flowId?: string; userId: string; orgId?: string; state?: Record<string, unknown> } | undefined;
        return { flowKind: String(f?.flowKind), flowId: f?.flowId, userId: String(f?.userId), orgId: f?.orgId, state: f?.state };
      },
      deleteSession: async (sessionId: string) => { await runtime.stores.session.delete(sessionId); }
    },
    userId: USER_ID
  } as never);

  const channelFlow = instances.find((i) => i.kind === CHANNEL_KIND)!;
  const post = async (body: string, author?: string) => {
    const r = (await runAction({
      flow: channelFlow, actionName: "post", input: { body, ...(author ? { author } : {}) },
      userId: USER_ID, orgId: ORG_ID, sessionId: channel.id,
      stores: runtime.stores, runtimeConfig: { ...runtime.runtimeConfig }
    } as never)) as { error?: unknown };
    if (r.error !== undefined) failures.push(`post "${body}" refused: ${String(r.error)}`);
  };
  const lines = () => readFileSync(LOG, "utf8").split("\n").filter(Boolean).map((l) => l.split("|"));
  const settle = async (n: number) => {
    for (let i = 0; i < 40 && lines().length < n; i++) await new Promise((r) => setTimeout(r, 50));
    await new Promise((r) => setTimeout(r, 150)); // let any extra wake land, so "exactly" means exactly
  };

  const tok = `t${Date.now()}`;
  await post(`first ${tok}`);
  await settle(2);
  await post(`second ${tok}`);
  await settle(4);
  const afterPeople = lines();
  await post(`from ivy ${tok}`, "desk.ivy");
  await settle(afterPeople.length + 1);
  const all = lines();
  note(`P2 · heard lines:\n  ${all.map((l) => l.join(" | ")).join("\n  ")}`);

  const listeners = seats.filter((s) => s.kind === "listener").map((s) => s.id);
  for (const id of listeners) {
    const mine = afterPeople.filter((l) => l[0] === id);
    if (mine.length !== 2) failures.push(`P2: ${id} heard ${mine.length} of the two people's posts, not 2`);
    if (new Set(mine.map((l) => l[1])).size !== 1) failures.push(`P2: ${id} used ${new Set(mine.map((l) => l[1])).size} conversations, not 1`);
  }
  if (all.some((l) => l[0] === "desk.ned")) failures.push("P2: desk.ned (no entry) ran");
  const fromSeat = all.filter((l) => l[3]?.startsWith("from ivy"));
  if (fromSeat.length > 0) failures.push(`P2: a seat's own post woke ${fromSeat.map((l) => l[0]).join(", ")}`);
} finally {
  await state.dispose();
}

if (failures.length === 0) {
  note("PASS — P1 and P2 hold");
} else {
  note(`FAIL —\n${failures.map((f) => `  - ${f}`).join("\n")}`);
  process.exitCode = 1;
}
