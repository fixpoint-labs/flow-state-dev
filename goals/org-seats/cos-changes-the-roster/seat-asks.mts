/**
 * The "a seat asks" leg (BR-21): a declared seat, not the person, asks the
 * chief of staff for a hire, and the hire lands.
 *
 * DevTeam has no seat that messages another seat: its EM files rows and its
 * coder and reviewer run a harness. So this leg runs its own small host, in
 * process, over a tree written at run time:
 *
 * - `org/workers/chief-of-staff/` on the built-in `agent` kind, holding `hire`,
 *   on a real model;
 * - `teams/ops/workers/lead/` on this fixture's `requester` kind, whose one
 *   job is to post its own instructions into its channel, as itself. The
 *   held-out seat id it asks for lives only in that file;
 * - `teams/ops/channels/room/`, with both as members.
 *
 * Nothing new carries the request. The lead posts through the channel's own
 * `post` action with its `seatId` as the author, which is how a seat posts.
 * The channel runs its notify block per member, and the block hands the post
 * to the chief of staff's `onChannelPost`, the entry the agent kind hears a
 * post on and answers like any message. The stock wake skips a post that
 * names an author, so that two seats can't answer each other forever; here
 * the lead never hears a post, so no loop can start, and the block delivers
 * to the chief of staff only.
 *
 * `dropDelivery` is the control's seam: the block records the post and hands
 * it to nobody.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defineFlow, dispatcher, handler, sequencer } from "@flow-state-dev/core";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import {
  CHANNEL_KIND,
  channelInstances,
  channelNotifyInputSchema,
  createSeatHireCapability,
  defineAgentWorkerFlow,
  defineChannelFlow,
  hireWorkforce,
  openChannels,
  workerConfigSchema,
  type ChannelNotifyInput,
  type HireOptions,
} from "@flow-state-dev/workforce";
import { readChannelsDirectory, readWorkforce } from "@flow-state-dev/workforce/loader";
import { z } from "zod";

const ORG = "seat-asks";
const USER = "u_seat_asks";
const COS = "chief-of-staff";
/** The seat that asks, by the id its folder gives it. */
export const ASKER = "ops.lead";
const CHANNEL = "ops.room";
const ROSTER_PREFIX = "workforce/roster/";

const files = (requested: string): Record<string, string> => ({
  "org/workers/chief-of-staff/WORKER.md": `---
description: The one seat that changes who works here.
flow: agent
model: openai/gpt-5.4-mini
tools: [hire]
---

You are the chief of staff for this organization. Seats and people message you
when they need someone hired. When a seat asks you to hire someone, call \`hire\`
with the seat id it names and \`flow: "agent"\`, then say in one sentence what you
did.
`,
  "teams/ops/workers/lead/WORKER.md": `---
description: Leads ops, and asks the chief of staff when the team needs a hand.
flow: requester
---

Chief of staff: ops needs another pair of hands. Please hire an agent seat with
the seat id "${requested}".
`,
  "teams/ops/channels/room/CHANNEL.md": `---
description: Where ops talks.
members: [ops.lead, chief-of-staff]
---

Ops, and whoever ops asks for help.
`,
});

/** Post the seat's own instructions into its channel, as the seat. */
const requester = defineFlow({
  kind: "requester",
  cardinality: "collection",
  configSchema: workerConfigSchema(),
  actions: {
    start: {
      inputSchema: z.object({}).strict(),
      block: sequencer({ name: "requester-start", inputSchema: z.object({}).strict() })
        .step(
          handler({
            name: "requester-line",
            inputSchema: z.object({}).strict(),
            outputSchema: z.object({ channel: z.string(), body: z.string(), author: z.string() }),
            flowConfigSchema: z.object({ seatId: z.string().min(1), instructions: z.string() }),
            execute: (_input, ctx) => ({
              channel: CHANNEL,
              body: ctx.flow.config.instructions.trim(),
              author: ctx.flow.config.seatId,
            }),
          }),
        )
        .step(
          dispatcher({
            name: "requester-post",
            flowKind: CHANNEL_KIND,
            action: "post",
            inputSchema: z.object({ channel: z.string(), body: z.string(), author: z.string() }),
            session: { id: (line: { channel: string }) => line.channel },
            payload: (line: { body: string; author: string }) => ({ body: line.body, author: line.author }),
          } as never),
        ),
    },
  },
} as never);

/** What the channel handed on, per member. */
export interface Delivery {
  member: string;
  author: string | null;
  body: string;
  delivered: boolean;
}

/** The notify block: hand a post to the chief of staff, record every member. */
function notifyCos(log: Delivery[], dropDelivery: boolean) {
  const decide = handler({
    name: "seat-asks-decide",
    inputSchema: channelNotifyInputSchema,
    outputSchema: channelNotifyInputSchema.extend({ deliver: z.boolean() }),
    execute: (post: ChannelNotifyInput) => {
      const deliver = post.member === COS && !dropDelivery;
      log.push({ member: post.member, author: post.author ?? null, body: post.body, delivered: deliver });
      return { ...post, deliver };
    },
  });
  const toCos = dispatcher({
    name: "seat-asks-to-cos",
    flowKind: COS,
    action: "onChannelPost",
    inputSchema: channelNotifyInputSchema.extend({ deliver: z.boolean() }),
    session: { key: (post: ChannelNotifyInput) => `channel:${post.channelId}` },
    payload: ({ deliver: _deliver, ...post }: ChannelNotifyInput & { deliver: boolean }) => post,
  } as never);
  return sequencer({ name: "seat-asks-notify", inputSchema: channelNotifyInputSchema })
    .step(decide)
    .stepIf((post: { deliver: boolean }) => post.deliver, toCos as never);
}

/** What the leg saw. */
export interface SeatAsksResult {
  requested: string;
  startStatus: string | undefined;
  deliveries: Delivery[];
  rostered: boolean;
  rosterKind: string | undefined;
  hireError?: string;
}

/**
 * Boot the host, have the lead do its job, and wait for the hire.
 *
 * @param requested The held-out seat id, written only into the lead's file.
 * @param dropDelivery The control: the channel hands the lead's post to nobody.
 */
export async function runSeatAsks(requested: string, dropDelivery: boolean, scratch: string): Promise<SeatAsksResult> {
  const tree = mkdtempSync(join(scratch, "seat-asks-"));
  for (const [rel, text] of Object.entries(files(requested))) {
    mkdirSync(join(tree, rel, ".."), { recursive: true });
    writeFileSync(join(tree, rel), text);
  }
  const { workers, errors } = await readWorkforce(tree);
  const { channels, errors: channelErrors } = await readChannelsDirectory(tree);
  if (errors.length > 0 || channelErrors.length > 0) {
    throw new Error(`the fixture tree did not load: ${[...errors, ...channelErrors].map((e) => `${e.path}: ${e.error.message}`).join("; ")}`);
  }

  const log: Delivery[] = [];
  let registrar: { register(seat: never, options: { pin: unknown }): void; unregister(id: string): boolean } | undefined;
  const kinds: NonNullable<HireOptions["kinds"]> = { requester: requester as never };
  const seatHire = createSeatHireCapability({
    kinds,
    register: (seat, pin) => registrar!.register(seat as never, { pin }),
    unregister: (id) => registrar!.unregister(id),
    allowKinds: ["agent"],
  });
  kinds.agent = defineAgentWorkerFlow({ uses: [seatHire] }) as never;
  const seats = hireWorkforce(workers, { kinds });
  const channelFlows = channelInstances(channels, {
    kinds: { [CHANNEL_KIND]: defineChannelFlow({ notify: notifyCos(log, dropDelivery) as never }) as never },
  });

  const stores = inMemoryStores();
  const state = createFlowState({
    flows: {
      ...Object.fromEntries(channelFlows.map((flow) => [flow.kind, flow])),
      ...Object.fromEntries(seats.map((seat) => [seat.id, seat])),
    },
    stores: { default: { primary: stores } },
  } as never);
  const runtime = await state.getRuntime();
  registrar = state as never;

  // The session route's stand-in, binding the host's org as that route would.
  await openChannels(channels, {
    client: {
      createSession: async (create: { flowKind: string; userId: string; sessionId?: string; description?: string; state?: Record<string, unknown> }) => {
        const id = String(create.sessionId);
        const now = Date.now();
        await runtime.stores.session.set(
          id,
          {
            id,
            flowKind: create.flowKind,
            flowId: create.flowKind,
            userId: create.userId,
            orgId: ORG,
            description: create.description,
            state: create.state ?? {},
            lineageId: `lin_${id}`,
            version: 0,
            createdAt: now,
            updatedAt: now,
            journal: [],
          } as never,
          "absent",
        );
        return { id };
      },
      getSession: async (sessionId: string) => {
        const found = (await runtime.stores.session.get(sessionId)) as { flowKind: string; flowId?: string; userId: string; state?: Record<string, unknown> } | undefined;
        return { flowKind: String(found?.flowKind), flowId: found?.flowId, userId: String(found?.userId), state: found?.state };
      },
      deleteSession: async (sessionId: string) => {
        await runtime.stores.session.delete(sessionId);
      },
    } as never,
    userId: USER,
  });

  // The lead does its job. The check hands it nothing: the request is the lead's own.
  const lead = runtime.registry.get(ASKER);
  if (lead === undefined) throw new Error(`no "${ASKER}" seat was registered`);
  let startStatus: string | undefined;
  try {
    const started = (await runAction({
      flow: lead,
      actionName: "start",
      input: {},
      userId: USER,
      orgId: ORG,
      stores: runtime.stores,
      runtimeConfig: { ...runtime.runtimeConfig },
    } as never)) as { requestId?: string; error?: unknown };
    startStatus =
      started.error !== undefined
        ? `failed: ${String((started.error as Error)?.message ?? started.error)}`
        : (await runtime.stores.request.get(started.requestId!))?.status;
  } catch (error) {
    startStatus = `threw: ${error instanceof Error ? error.message : String(error)}`;
  }

  // The hand-offs are detached: wait for the row, up to two minutes.
  let row: { state?: unknown } | undefined;
  for (let waited = 0; waited < 120_000; waited += 500) {
    row = (await runtime.stores.resourceState.get("org", ORG, `${ROSTER_PREFIX}${requested}`)) as typeof row;
    if (row?.state != null) break;
    if (dropDelivery && waited >= 10_000) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return {
    requested,
    startStatus,
    deliveries: log,
    rostered: row?.state != null,
    rosterKind: (row?.state as { flow?: string } | null | undefined)?.flow,
  };
}
