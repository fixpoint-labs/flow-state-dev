/**
 * A fresh app with a mailbox of agents, as a new app would write it.
 *
 * Everything here comes from the published packages and the team's files: no
 * kitchen-sink code, and no dispatcher or router of the app's own. The wake is
 * one call, `wakeMemberSeats(copies, { installation })`, in the built-in
 * mailbox kind's notify slot. The goal check reads this file's source to hold
 * it to that.
 *
 * The app has one worker flow of its own, `note`, whose workers take notes
 * when asked and declare no `onMailboxPost`, so a post runs nothing on them.
 * Every other worker runs on the built-in `agent`, answered by a scripted
 * model so the check needs no key. Each flow is registered once; a woken
 * worker's conversation is a session on its flow, naming it.
 *
 * `adaptNotify` is the goal check's seam for its controls, and nothing else:
 * given the wake this app builds, it returns the block the mailbox runs, or
 * `undefined` for no notify block at all. An app passes nothing.
 */
import { createSessionClient } from "@flow-state-dev/client";
import { defineFlow, handler, type BlockDefinition } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, type FlowState } from "@flow-state-dev/engine";
import { createMockModelResolver, mockGenerator } from "@flow-state-dev/testing";
import {
  mailboxInstances,
  createWorkerInstallation,
  defineMailboxFlow,
  hireWorkforce,
  openMailboxes,
  wakeMemberSeats,
  workerConfigSchema,
  type MailboxManifest,
  type WorkerInstallation
} from "@flow-state-dev/workforce";
import { readMailboxesDirectory, readWorkforce } from "@flow-state-dev/workforce/loader";

/**
 * `{ message: string }`, built off the contract's own `instructions` string so
 * this host imports nothing outside `@flow-state-dev/*`.
 */
const messageInput = workerConfigSchema().pick({}).extend({ message: workerConfigSchema().shape.instructions.unwrap() });

/** Every worker flow has one door: this fixture's answers by saying what it heard. */
const workerDoor = {
  message: {
    inputSchema: messageInput,
    userMessage: (input: { message: string }) => input.message,
    block: handler({
      name: "fixture-door",
      inputSchema: messageInput,
      execute: (input, ctx) => {
        ctx.emit.message(`Heard: ${input.message}`);
        return {};
      },
    }),
  },
};

/** The user the mailboxes are opened under, and who posts to them. */
export const MAILBOX_OWNER = "u_fresh_host";

/** What an agent seat answers with, whatever it heard. */
export const REPLY_MARKER = "[reply:fresh-host]";

/** This app's own worker flow: takes a note when asked directly, and hears no posts. */
const defineNote = (installation: WorkerInstallation) =>
  defineFlow({
    kind: "note",
    cardinality: "collection",
    configSchema: workerConfigSchema(),
    session: installation.session(),
    resources: { ...installation.resources },
    actions: { ...workerDoor, take: { block: handler({ name: "note-take", execute: () => ({}) }) } }
  } as never);

/** The app, booted: its router, what it hired, and a way to shut it down. */
export interface FreshHost {
  state: FlowState;
  router: Awaited<ReturnType<FlowState["getRouter"]>>;
  seats: FlowInstance[];
  mailboxes: MailboxManifest[];
  /** The built mailbox kind, so a check can post on the internal seat entry. */
  mailbox: FlowInstance;
}

/**
 * Read the team's files, hire its seats, build its mailboxes with the wake in
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
  const { mailboxes, errors: mailboxErrors } = await readMailboxesDirectory(tree);
  if (errors.length > 0 || mailboxErrors.length > 0) {
    throw new Error(`the tree did not load: ${[...errors, ...mailboxErrors].map((e) => e.path).join(", ")}`);
  }

  // The flows first: the wake reaches the workers on these copies, never a
  // mailbox's stored members.
  let flows: Record<string, unknown> = {};
  const installation = createWorkerInstallation({ standardWorkers: workers, workerFlows: () => flows as never });
  flows = { note: defineNote(installation) };
  const seats = hireWorkforce(installation);
  const wake = wakeMemberSeats(seats, { installation });
  const notify = adaptNotify === undefined ? wake : adaptNotify(wake);
  const mailboxFlows = mailboxInstances(mailboxes, {
    kinds: { mailbox: notify === undefined ? defineMailboxFlow() : defineMailboxFlow({ notify }) }
  });

  const state = createFlowState({
    flows: {
      ...Object.fromEntries(mailboxFlows.map((flow) => [flow.kind, flow])),
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
  await openMailboxes(mailboxes, { client: sessions, userId: MAILBOX_OWNER });

  return { state, router, seats, mailboxes, mailbox: mailboxFlows[0]! };
}
