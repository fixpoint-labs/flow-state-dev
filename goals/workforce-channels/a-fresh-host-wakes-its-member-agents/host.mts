/**
 * A fresh app with a channel of agents, as a new app would write it.
 *
 * Everything here comes from the published packages and the team's files: no
 * kitchen-sink code, and no dispatcher or router of the app's own. The wake is
 * one call, `wakeMemberSeats(seats)`, in the built-in channel kind's notify
 * slot. The goal check reads this file's source to hold it to that.
 *
 * The app has one kind of its own, `note`, whose seats take notes when asked
 * and declare no `onChannelPost`, so a post runs nothing on them. Every other
 * seat is the built-in `agent` kind, answered by a scripted model so the check
 * needs no key.
 *
 * `adaptNotify` is the goal check's seam for its controls, and nothing else:
 * given the wake this app builds, it returns the block the channel runs, or
 * `undefined` for no notify block at all. An app passes nothing.
 */
import { createSessionClient } from "@flow-state-dev/client";
import { defineFlow, handler, type BlockDefinition } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, type FlowState } from "@flow-state-dev/engine";
import { createMockModelResolver, mockGenerator } from "@flow-state-dev/testing";
import {
  channelInstances,
  defineChannelFlow,
  hireWorkforce,
  openChannels,
  wakeMemberSeats,
  workerConfigSchema,
  type ChannelManifest
} from "@flow-state-dev/workforce";
import { readChannelsDirectory, readWorkforce } from "@flow-state-dev/workforce/loader";

/** The user the channels are opened under, and who posts to them. */
export const CHANNEL_OWNER = "u_fresh_host";

/** What an agent seat answers with, whatever it heard. */
export const REPLY_MARKER = "[reply:fresh-host]";

/** This app's own kind: takes a note when asked directly, and hears no posts. */
const note = defineFlow({
  kind: "note",
  cardinality: "collection",
  configSchema: workerConfigSchema(),
  actions: { take: { block: handler({ name: "note-take", execute: () => ({}) }) } }
} as never);

/** The app, booted: its router, what it hired, and a way to shut it down. */
export interface FreshHost {
  state: FlowState;
  router: Awaited<ReturnType<FlowState["getRouter"]>>;
  seats: FlowInstance[];
  channels: ChannelManifest[];
}

/**
 * Read the team's files, hire its seats, build its channels with the wake in
 * the notify slot, and open them.
 *
 * @param tree The workforce root to read.
 * @param adaptNotify The goal check's control seam. An app passes nothing.
 */
export async function startFreshHost(
  tree: string,
  adaptNotify?: (wake: BlockDefinition<any, any>) => BlockDefinition<any, any> | undefined
): Promise<FreshHost> {
  const { workers, errors } = await readWorkforce(tree);
  const { channels, errors: channelErrors } = await readChannelsDirectory(tree);
  if (errors.length > 0 || channelErrors.length > 0) {
    throw new Error(`the tree did not load: ${[...errors, ...channelErrors].map((e) => e.path).join(", ")}`);
  }

  // Hire first: the wake reaches these seats, never a channel's stored members.
  const seats = hireWorkforce(workers, { kinds: { note: note as never } });
  const wake = wakeMemberSeats(seats);
  const notify = adaptNotify === undefined ? wake : adaptNotify(wake);
  const channelFlows = channelInstances(channels, {
    kinds: { channel: notify === undefined ? defineChannelFlow() : defineChannelFlow({ notify }) }
  });

  const state = createFlowState({
    flows: {
      ...Object.fromEntries(channelFlows.map((flow) => [flow.kind, flow])),
      ...Object.fromEntries(seats.map((seat) => [seat.id, seat]))
    },
    stores: { default: { primary: inMemoryStores() } },
    modelResolver: createMockModelResolver({
      generators: {
        "agent-answer": mockGenerator({
          name: "agent-answer",
          script: [{ when: () => true, then: { text: `${REPLY_MARKER} noted.` } }]
        })
      },
      policy: "allow"
    })
  } as never);
  const router = await state.getRouter();

  // The session client over the app's own router: the app is the server.
  const sessions = createSessionClient({
    fetcher: async (input, init) => {
      const url = new URL(String(input), "http://fresh-host.local");
      const path = url.pathname
        .replace(/^\/api\/flows\/?/, "")
        .split("/")
        .filter((segment) => segment.length > 0)
        .map(decodeURIComponent);
      const method = (init?.method ?? "GET").toUpperCase() as "GET" | "POST" | "PATCH" | "DELETE";
      return await router[method](new Request(url, init), { params: { path } });
    }
  });
  await openChannels(channels, { client: sessions, userId: CHANNEL_OWNER });

  return { state, router, seats, channels };
}
