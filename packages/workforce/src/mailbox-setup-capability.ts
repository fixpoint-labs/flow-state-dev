/**
 * `createMailboxSetupCapability` — a coordinator sets up mailboxes, puts
 * workers on them and takes them off, and files tasks, while the app runs.
 *
 * Compose it into a worker kind's `uses` and the kind's catalog gains four
 * tools: `setUpMailbox`, `subscribeWorkers`, `unsubscribeWorkers` and
 * `fileTask`. That is a grant the kind offers, not one a worker holds: a
 * worker names each tool in its `tools:` before the model can call it, the
 * same fence `createSeatHireCapability`'s `hire` sits behind, and an empty
 * `tools:` reaches none of them.
 *
 * ## Who the tools act as
 *
 * The organization is the caller's, from the verified principal, never the
 * tool's input: an `orgId` in the input is accepted and ignored. Opening and
 * changing a mailbox goes through the host's opener (`openMailboxAtRunTime`),
 * which runs the mailbox's internal entries as the app, so the tools never
 * write a mailbox's session or rows themselves.
 *
 * ## Worker names
 *
 * Every worker a tool adds, and `fileTask`'s assignee, is looked up by name
 * with `findWorkerByName` over `workers`, the same live list the wake reads.
 * A name no worker holds, and a name two workers hold, are refused by name
 * and change nothing. `unsubscribeWorkers` looks nothing up: it takes a name
 * off a mailbox as the mailbox holds it, which is how a fired worker, no
 * longer in the list, is taken off.
 *
 * ## Filing
 *
 * `fileTask` files on the mailbox's `tasks` list unless it names another list
 * the mailbox holds. An assignee must also be one of that list's workers
 * (`taskListWorkers`). The task records `filingWorker`: the calling worker's
 * own name, read off its settings, never the input. It is there to report
 * back to that worker, and is not the task's owner.
 *
 * Every refusal is the tool's error, naming the problem, and changes nothing.
 */
import { defineCapability, handler } from "@flow-state-dev/core";
import type { DefinedCapability } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { z } from "zod";
import { seatIdConfigSchema } from "./mailbox-post-capability";
import { RUN_TIME_TASK_LIST } from "./mailbox/mailbox-board";
import type { RunTimeMailboxOpener } from "./mailbox/mailbox-binder";
import type { MailboxWorkerSource } from "./mailbox/wake-member-seats";
import { findWorkerByName, type WorkerLookupCaller } from "./worker-by-name";

/** The capability name a worker file spells under `capabilities:`. */
export const MAILBOX_SETUP_CAPABILITY = "mailbox-setup";

/** Options for {@link createMailboxSetupCapability}. */
export interface MailboxSetupCapabilityOptions {
  /**
   * The host's door to opening and changing mailboxes: `openMailboxAtRunTime`,
   * or an object forwarding to it once the host has built it.
   */
  open: RunTimeMailboxOpener;
  /**
   * The workers a name is looked up among: the same list or getter the wake
   * takes. Pass the host's registry getter, so a worker hired a moment ago
   * can be added and a fired one cannot.
   */
  workers: MailboxWorkerSource;
}

/** Accepted so a body naming an org is not an extra-key refusal, and ignored (BP-031). */
const ignoredOrg = z.unknown().optional();

const workerNames = z.array(z.string().min(1));

const setUpInput = z
  .object({
    team: z.string().min(1).describe("The team the mailbox belongs to: the first half of its id."),
    name: z.string().min(1).describe("Its name in the team: the second half of its id, lowercase."),
    description: z.string().min(1).describe("One line saying what the mailbox is for."),
    charter: z.string().min(1).describe("What the mailbox's members are there to do."),
    members: workerNames.default([]).describe("Its first members, by worker name."),
    worksTaskList: z.boolean().optional().describe("The first members also work the mailbox's `tasks` list."),
    orgId: ignoredOrg
  })
  .strict();

const membershipInput = z
  .object({
    mailboxId: z.string().min(1),
    workers: workerNames.min(1),
    orgId: ignoredOrg
  })
  .strict();

const subscribeInput = membershipInput
  .extend({ worksTaskList: z.boolean().optional().describe("The workers also work the mailbox's task lists.") })
  .strict();

const fileTaskInput = z
  .object({
    mailboxId: z.string().min(1),
    list: z.string().min(1).optional().describe(`The list to file on. Defaults to "${RUN_TIME_TASK_LIST}".`),
    goal: z.string().min(1),
    title: z.string().min(1).optional(),
    context: z.string().optional(),
    assignee: z.string().min(1).optional().describe("The worker the task is for, by name. Must work the list."),
    priority: z.number().optional(),
    labels: z.array(z.string()).optional(),
    orgId: ignoredOrg
  })
  .strict();

const membersOutput = z.object({ mailboxId: z.string(), members: z.array(z.string()) });

/** The caller's organization and member, from the verified principal. */
function callerOf(ctx: BlockContext): WorkerLookupCaller {
  const orgId = ctx.org?.identity.orgId ?? ctx.org?.identity.id;
  if (typeof orgId !== "string" || orgId.length === 0) {
    throw new Error("This request resolves no organization, and mailboxes are the organization's. Nothing was changed.");
  }
  const userId = ctx.user?.identity.userId ?? ctx.user?.identity.id ?? ctx.session.identity.userId;
  return { orgId, ...(typeof userId === "string" ? { userId } : {}) };
}

/**
 * Build the mailbox-setup capability.
 *
 * @param options `open`, the host's opener; `workers`, the live list names are
 *   looked up among. Org is never an option: it comes from the caller.
 * @returns A capability named `mailbox-setup` contributing catalog
 *   `setUpMailbox`, `subscribeWorkers`, `unsubscribeWorkers` and `fileTask`.
 */
export function createMailboxSetupCapability(options: MailboxSetupCapabilityOptions): DefinedCapability {
  const { open, workers } = options;

  /** Each name, checked to be one worker the caller may reach; refused by name otherwise. */
  const lookedUp = (names: readonly string[], caller: WorkerLookupCaller, what: string): string[] => {
    const listed = typeof workers === "function" ? workers() : workers;
    for (const name of names) {
      if (findWorkerByName(listed, name, caller) === undefined) {
        throw new Error(
          `${what} "${name}" is not a worker in this organization, declared or hired. Nothing was changed. ` +
            "Use a name `discover` lists, or hire the worker first."
        );
      }
    }
    return [...names];
  };

  const setUpMailbox = handler({
    name: "setUpMailbox",
    description:
      "Set up a new mailbox `<team>.<name>` with a description, a charter and members. It gets one task list, " +
      "`tasks`. With `worksTaskList`, the members also work that list.",
    inputSchema: setUpInput,
    outputSchema: z.object({ mailboxId: z.string(), taskList: z.string() }),
    execute: async (input: z.infer<typeof setUpInput>, ctx) => {
      const caller = callerOf(ctx as unknown as BlockContext);
      return await open.setUp({
        orgId: caller.orgId,
        team: input.team,
        name: input.name,
        description: input.description,
        charter: input.charter,
        members: lookedUp(input.members, caller, "Member"),
        ...(input.worksTaskList === true ? { worksTaskList: true } : {})
      });
    }
  });

  const subscribeWorkers = handler({
    name: "subscribeWorkers",
    description:
      "Put workers on a mailbox, a file's included. The next post wakes them. With `worksTaskList`, they also " +
      "work its task lists.",
    inputSchema: subscribeInput,
    outputSchema: membersOutput,
    execute: async (input: z.infer<typeof subscribeInput>, ctx) => {
      const caller = callerOf(ctx as unknown as BlockContext);
      const changed = await open.subscribe({
        orgId: caller.orgId,
        mailboxId: input.mailboxId,
        workers: lookedUp(input.workers, caller, "Worker"),
        ...(input.worksTaskList === true ? { worksTaskList: true } : {})
      });
      return { mailboxId: input.mailboxId, members: changed.members };
    }
  });

  const unsubscribeWorkers = handler({
    name: "unsubscribeWorkers",
    description:
      "Take workers off a mailbox and off its task lists. Posts stop waking them; their open tasks stay. " +
      "Names are taken as the mailbox lists them, so a fired worker can be taken off too.",
    inputSchema: membershipInput,
    outputSchema: membersOutput,
    execute: async (input: z.infer<typeof membershipInput>, ctx) => {
      const caller = callerOf(ctx as unknown as BlockContext);
      const changed = await open.unsubscribe({ orgId: caller.orgId, mailboxId: input.mailboxId, workers: input.workers });
      return { mailboxId: input.mailboxId, members: changed.members };
    }
  });

  const fileTask = handler({
    name: "fileTask",
    description:
      `File a task on a mailbox's task list (\`${RUN_TIME_TASK_LIST}\` unless you name another it holds). ` +
      "An assignee must be a worker who works that list.",
    inputSchema: fileTaskInput,
    outputSchema: z.object({ mailboxId: z.string(), list: z.string(), taskId: z.string() }),
    flowConfigSchema: seatIdConfigSchema,
    execute: async (input: z.infer<typeof fileTaskInput>, ctx) => {
      const caller = callerOf(ctx as unknown as BlockContext);
      const { orgId: _ignored, list, assignee, ...task } = input;
      return await open.fileTask({
        ...task,
        orgId: caller.orgId,
        list: list ?? RUN_TIME_TASK_LIST,
        ...(assignee === undefined ? {} : { assignee: lookedUp([assignee], caller, "Assignee")[0]! }),
        filingWorker: ctx.flow.config.seatId
      });
    }
  });

  return defineCapability({
    name: MAILBOX_SETUP_CAPABILITY,
    presets: {
      tools: { tools: [setUpMailbox, subscribeWorkers, unsubscribeWorkers, fileTask] },
      default: ["tools"]
    }
  });
}
