/**
 * The `em` worker kind — one file under `workforce/flows/workers/`, basename =
 * the kind id every coordinating `WORKER.md` names in its `flow:` line.
 *
 * **This kind declares no harness slot, and that is the point.** "The EM seat
 * does no harness work" is a locked DevForce opinion, and it is graded on the
 * kind rather than on behaviour: there is no `task:` entry here and no option
 * through which one could be installed, so the seat cannot run a coding harness
 * — not merely "it happened not to". Search this file for the word harness and
 * the only hits are in this paragraph.
 *
 * What it does have is the feature board — its declaration of the ledger the
 * feature mailbox holds — and the board's `coder` worker is a
 * dispatcher naming another flow and the worker on it. That is D1: the row is
 * handed across flows to the seat a Markdown file declared, rather than to a
 * task entry co-located on this flow.
 *
 * It takes a coordinator's delegated post, so an EM worker can be a delegate:
 * the chief of staff hands it feature work, and it files the feature line the
 * post carries, through the same row writer as its door, or says it filed
 * nothing.
 *
 * Every EM worker runs on this kind's one copy. A session names its worker
 * (`installation.session()`), and a block reads that worker's own settings
 * through the installation, never `ctx.flow.config`.
 *
 * Nothing under `flows/` is read as a convention file — the loader walks
 * `workers/`, `skills/`, `resources/` and `mailboxes/` and ignores the rest
 * (BR-16), which is why the code side of the fence can sit inside the tree.
 */

import { defineFlow, handler, sequencer, SuspensionRejectedError } from "@flow-state-dev/core";
import type { BlockContext, TaskFlowTarget, TaskStateTarget } from "@flow-state-dev/core/types";
import { z } from "zod";
import { harnessTaskId } from "@flow-state-dev/harness-manager/checkout";
import {
  DELEGATED_POST_ENTRY,
  delegatedPostEntry,
  delegatedPostOnFinished,
  delegatedPostSchema,
  type WorkerInstallation,
} from "@flow-state-dev/workforce";

import { PHASE } from "../../../phase.mts";
import {
  ASSIGNEE,
  BOARD_ID,
  coordinatorBoard,
  type FeatureLedger,
  type FeatureRow,
  RESUME_ENTRY,
} from "../../../board.mts";
import {
  ASK_ENTRY,
  defineReadOwnFacts,
  INSPECT_ENTRY,
  seatOf,
  seatSettingsSchema,
} from "../../../seat-config.mts";

/** The kind id the coordinating `WORKER.md` names. **Pinned** — the basename must match. */
export const EM_KIND = "em";

/** The action that turns one feature into one row. */
export const FILE_ENTRY = "file";

/**
 * The action a **mailbox post** reaches — the front door of the third check.
 *
 * Separate from {@link FILE_ENTRY} rather than a widened input on it, because
 * the two have genuinely different inputs: `file` is handed a row, and this is
 * handed a line somebody wrote. Collapsing them would mean either a schema that
 * accepts both shapes and validates neither, or a direct action call wearing a
 * post's clothes — and "the row is filed in answer to a post, not by calling
 * the EM's action directly" is precisely what the mailbox leg is a proof of.
 */
export const POST_ENTRY = "onPost";

/** The action that runs the board. */
export const DRAIN_ENTRY = "drain";

/**
 * The seat's door: the action a person's own line in the EM's session
 * reaches. Every worker flow has exactly one.
 *
 * It reads the line the way a post is read — `<issue-slug>: <what the feature
 * is>` — and files that feature, or says why it filed nothing. Public, unlike
 * {@link POST_ENTRY}: this is the person writing to the EM in its own session,
 * not a mailbox delivery, so no address map stands behind it, and it carries
 * the request's own principal like {@link FILE_ENTRY} does.
 */
export const MESSAGE_ENTRY = "message";

/**
 * What filing one feature takes.
 *
 * `phase` is not an input: this board runs one phase, and letting a caller pick
 * one would let a row be filed that the recipient's manager then refuses after
 * the checkout has been cut.
 */
export const fileInputSchema = z.object({
  /** The row's identity, and the leaf of every path derived from it. */
  issue: z.string().min(1),
  /** What the row is, in a sentence. */
  goal: z.string().min(1),
  /**
   * How many attempts the row gets.
   *
   * Stated, because the substrate is single-attempt without it: a reported
   * failure would then cost an attempt and deliver nothing, and BR-14's "back
   * to pending, then errored once the budget is spent" would have no budget to
   * spend.
   */
  maxAttempts: z.number().int().min(1).default(2),
});

/** What the asking door is handed: the feature it asks about. */
export const askInputSchema = z.object({
  /** The row's identity, as {@link fileInputSchema} takes it. */
  issue: z.string().min(1),
  /** What the row is, in a sentence. Named in the ask so a person knows what they approve. */
  goal: z.string().min(1),
});

/**
 * What one mailbox delivery carries — exactly the fields the notify block's
 * dispatcher builds, and nothing a poster could widen.
 */
export const postInputSchema = z
  .object({
    /** The mailbox the line was posted on. */
    mailboxId: z.string().min(1),
    /** The declared member this delivery was addressed to. */
    member: z.string().min(1),
    /** The line somebody wrote. */
    body: z.string().min(1),
  })
  .strict();

/**
 * The shape a post has to be in for the EM to file from it:
 * `<issue-slug>: <what the feature is>`.
 *
 * Deterministic parsing, not a model. The EM's opinion under test is *that it
 * names no harness* and *that a post is what starts the work* — neither is a
 * judgement, and a model here would double the lab's model surface for a claim
 * that is structural. A line that does not match files nothing and says so,
 * which is the shape BR-9's "the board does not start itself" lives in. A
 * link (`https://…`) is not a feature line, though its scheme reads as a slug.
 */
const POST_SHAPE = /^\s*([a-z0-9][a-z0-9-]*)\s*:(?!\/\/)\s*(\S.*)$/;

/**
 * Request state: the body of the post a coordinator handed the EM, noted
 * before the delegated-post entry runs. The entry hands its turn the post
 * under a `<from>, through <coordinator>: ` heading; the body is read from
 * here instead, so nothing in the heading can be taken for a feature line.
 */
const HANDED_ON_STATE = "emHandedOn";

const handedOnStateSchema = z.object({ [HANDED_ON_STATE]: z.string().optional() });

export interface EmWorkerFlowOptions {
  /** The installation whose workers run on this kind. */
  installation: WorkerInstallation;
  /**
   * The `coder` worker's id — whose session a claimed row runs in.
   *
   * Passed in rather than named here because the host derives it from the tree:
   * no file, and no seat, is named in this lab's code.
   */
  coderWorker: string;
  /** The flow the coder worker runs on. */
  coderFlow: string;
  /** The file-declared documents, as `resourcesFromDocs` built them. */
  resources: Record<string, unknown>;
  /**
   * The ledger the board files onto — the feature mailbox's, which the host
   * resolves off the tree. Passed in rather than built here, so the mailbox,
   * this board and the coder's manager hold one declaration.
   */
  ledger: FeatureLedger;
  /**
   * Which worker a row's assignee names, for every name the board does not
   * route itself: the Workforce lookup's `flowKind` and `state`, which the
   * host builds over the installation.
   */
  findWorker?: { flowKind: TaskFlowTarget; state: TaskStateTarget };
  /**
   * **Control only.** The asking door files its row *before* it suspends, so
   * a row exists while the ask is still pending. The red state of "nothing is
   * filed until a person approves"; never set outside a goal control.
   */
  fileBeforeAsking?: boolean;
}

/**
 * Build the coordinator kind.
 *
 * @param options The installation, the coder worker, the documents and the ledger.
 * @returns The flow factory `hireWorkforce` registers one copy of, which every EM worker runs on.
 */
export function defineEmWorkerFlow(options: EmWorkerFlowOptions) {
  const { installation } = options;
  const readOwnFacts = defineReadOwnFacts(seatOf(installation, EM_KIND));
  const board = coordinatorBoard({
    ledger: options.ledger,
    coderWorker: options.coderWorker,
    coderFlow: options.coderFlow,
    ...(options.findWorker === undefined ? {} : { findWorker: options.findWorker }),
  });

  /**
   * Put one row on the board, idempotently.
   *
   * Shared by the three doors below rather than written three times: what a
   * row IS does not depend on whether a caller handed it over, somebody posted
   * a line, or a person approved an ask, and two copies of this is how one
   * door comes to file a subtly different row than another.
   */
  const addRow = async (
    tasks: any,
    input: { issue: string; goal: string; maxAttempts: number },
  ): Promise<{ taskId: string; existed: boolean }> => {
    // **The row id is the issue-phase, not a fresh mint, and not the issue.**
    // The manager derives the checkout, the branch and the run record from the
    // row's typed payload and refuses a row whose id does not match that
    // derivation — because a second row under a different id would run the
    // same work in the same tree. The refusal is the framework's, and it
    // arrives on the recipient after the hand-off, so getting this right here
    // is what keeps the row from erroring on arrival.
    const taskId = harnessTaskId(input.issue, PHASE);
    const existing = await tasks.getTask(taskId);
    if (existing !== undefined) return { taskId, existed: true };

    const row: FeatureRow = {
      id: taskId,
      goal: input.goal,
      // The TYPED payload, never `metadata`: the checkout path and the branch
      // are derived from these two fields, and `metadata` is patchable.
      input: { issue: input.issue, phase: PHASE },
    };
    await tasks.addTask({ ...row, assignee: ASSIGNEE, maxAttempts: input.maxAttempts });
    return { taskId, existed: false };
  };

  const fileRow = handler({
    name: "devforce-em-file-row",
    inputSchema: fileInputSchema,
    outputSchema: z.object({ taskId: z.string(), existed: z.boolean() }),
    uses: [board.capability],
    execute: async (input: z.infer<typeof fileInputSchema>, ctx: BlockContext) =>
      await addRow((ctx as { cap: Record<string, any> }).cap[BOARD_ID], input),
  });

  /**
   * File in answer to a line somebody posted on the feature mailbox.
   *
   * The `member` the delivery names is **not** read as an authority to file:
   * this action is only reachable by a dispatch the notify block addressed to
   * this seat, so the authority is the address map, which is the app's and not
   * caller-controllable (BP-031). The field is carried for the record.
   */
  const lineFiledSchema = z.object({
    filed: z.boolean(),
    taskId: z.string().nullable(),
    /** Why nothing was filed. Absent when a row was. */
    reason: z.string().optional(),
  });

  /**
   * Read one line as `<issue-slug>: <what the feature is>` and file it.
   * Shared by the post entry and the door, so a line files the same row
   * whichever way it arrived.
   */
  const fileFromLine = async (line: string, ctx: BlockContext): Promise<z.infer<typeof lineFiledSchema>> => {
    const match = POST_SHAPE.exec(line);
    if (match === null) {
      return {
        filed: false,
        taskId: null,
        reason:
          `the line does not name a feature; this seat files from ` +
          `"<issue-slug>: <what the feature is>"`,
      };
    }
    const filed = await addRow((ctx as { cap: Record<string, any> }).cap[BOARD_ID], {
      issue: match[1]!,
      goal: match[2]!.trim(),
      maxAttempts: fileInputSchema.shape.maxAttempts.parse(undefined),
    });
    return { filed: !filed.existed, taskId: filed.taskId };
  };

  const fileFromPost = handler({
    name: "devforce-em-file-from-post",
    inputSchema: postInputSchema,
    outputSchema: lineFiledSchema,
    uses: [board.capability],
    execute: async (input: z.infer<typeof postInputSchema>, ctx: BlockContext) => await fileFromLine(input.body, ctx),
  });

  /** What the EM says about a line it read: what it filed, or why nothing. */
  const saidOf = (result: z.infer<typeof lineFiledSchema>): string =>
    result.reason !== undefined
      ? `Nothing filed: ${result.reason}.`
      : result.filed
        ? `Filed ${result.taskId} on the board.`
        : `${result.taskId} is already on the board.`;

  /**
   * The door: a person's line, read and answered in the EM's own session.
   * Files nothing it can't read, and says so; never runs the board, which
   * stays the drain's, as it is for a post.
   */
  const fileFromMessage = handler({
    name: "devforce-em-file-from-message",
    inputSchema: z.object({ message: z.string() }),
    outputSchema: lineFiledSchema,
    uses: [board.capability],
    execute: async (input: { message: string }, ctx: BlockContext) => {
      const result = await fileFromLine(input.message, ctx);
      ctx.emit.message(saidOf(result));
      return result;
    },
  });

  /** Note the handed-on post's body ({@link HANDED_ON_STATE}) before the delegated-post entry runs. */
  const noteHandedOn = handler({
    name: "devforce-em-note-handed-on",
    inputSchema: delegatedPostSchema,
    outputSchema: z.object({}),
    requestStateSchema: handedOnStateSchema,
    execute: async (post: z.infer<typeof delegatedPostSchema>, ctx) => {
      await ctx.request.patchState({ [HANDED_ON_STATE]: post.body });
      return {};
    },
  });

  /**
   * A post a coordinator hands the EM (the chief of staff's `handOff`): the
   * first of its lines that reads, whole, as the door's feature line
   * ({@link POST_SHAPE}) is filed through the same row writer as the door,
   * and what the EM says about it is the answer, which lands in the
   * coordinator's conversation under the EM's name. A post with no such line
   * files nothing and says so. Like the door, it never runs the board.
   */
  const fileFromHandedOn = handler({
    name: "devforce-em-file-handed-on",
    inputSchema: z.object({ message: z.string() }),
    outputSchema: z.string(),
    requestStateSchema: handedOnStateSchema,
    uses: [board.capability],
    execute: async (_input: { message: string }, ctx) => {
      const body = ctx.request.state[HANDED_ON_STATE] ?? "";
      const line = body.split("\n").find((candidate) => POST_SHAPE.test(candidate));
      return saidOf(await fileFromLine(line ?? "", ctx as BlockContext));
    },
  });

  /** The delegated-post entry, with the post's body noted first for {@link fileFromHandedOn}. */
  const handedOn = delegatedPostEntry(fileFromHandedOn);
  const handedOnEntry = {
    ...handedOn,
    block: sequencer({ name: "devforce-em-handed-on", inputSchema: delegatedPostSchema })
      .tap(noteHandedOn)
      .step(handedOn.block),
  };

  // ---- the asking door --------------------------------------------------
  //
  // prepare → gate → on approve: file, then drain → on reject: say so.
  // The shape of `apps/kitchen-sink/flows/chat-agent/approval-gate.ts`, with
  // real work behind the approval: the row `addRow` files and the board run
  // that hands it to the coder seat. Handlers and the stock suspension only;
  // no model is on this path.

  const askDecisionSchema = askInputSchema.extend({ approved: z.boolean() });
  const defaultAttempts = (): number => fileInputSchema.shape.maxAttempts.parse(undefined);

  /**
   * Before the gate. Replayed from the durable log on resume, not re-run.
   *
   * Passes the feature through, except under the `fileBeforeAsking` control,
   * which files here so a check can watch a row exist before anyone approved.
   */
  const prepareAsk = handler({
    name: "devforce-em-prepare-ask",
    inputSchema: askInputSchema,
    outputSchema: askInputSchema,
    uses: [board.capability],
    execute: async (input: z.infer<typeof askInputSchema>, ctx: BlockContext) => {
      if (options.fileBeforeAsking === true) {
        await addRow((ctx as { cap: Record<string, any> }).cap[BOARD_ID], {
          ...input,
          maxAttempts: defaultAttempts(),
        });
      }
      return { issue: input.issue, goal: input.goal };
    },
  });

  /**
   * The stock `human_approval` suspension, naming the feature.
   *
   * Approve makes `ctx.suspend` return; reject makes it throw
   * `SuspensionRejectedError`. Either way the gate returns a decision the
   * branches below read.
   */
  const askGate = handler({
    name: "devforce-em-ask-gate",
    inputSchema: askInputSchema,
    outputSchema: askDecisionSchema,
    execute: async (input: z.infer<typeof askInputSchema>, ctx: BlockContext) => {
      try {
        await ctx.suspend!({
          reason: "human_approval",
          message: `File ${input.issue}: ${input.goal} and start the coder seat on it?`,
          allow: ["approve", "reject"],
        });
        return { ...input, approved: true };
      } catch (error) {
        if (error instanceof SuspensionRejectedError) return { ...input, approved: false };
        throw error;
      }
    },
  });

  /** On approve: file the row through the one row writer, and say what happened. */
  const fileApproved = handler({
    name: "devforce-em-file-approved",
    inputSchema: askDecisionSchema,
    uses: [board.capability],
    execute: async (input: z.infer<typeof askDecisionSchema>, ctx: BlockContext) => {
      const filed = await addRow((ctx as { cap: Record<string, any> }).cap[BOARD_ID], {
        issue: input.issue,
        goal: input.goal,
        maxAttempts: defaultAttempts(),
      });
      ctx.emit.message(
        filed.existed
          ? `Approved, but ${filed.taskId} already existed; nothing new was filed.`
          : `Approved. Filed ${filed.taskId} and handed it to the board.`,
      );
    },
  });

  /** On reject: file nothing, and say so. */
  const refuseAsked = handler({
    name: "devforce-em-ask-denied",
    inputSchema: askDecisionSchema,
    execute: async (input: z.infer<typeof askDecisionSchema>, ctx: BlockContext) => {
      ctx.emit.message(`Nothing filed for ${input.issue}: the ask was denied.`);
    },
  });

  const askToFile = sequencer({ name: "devforce-em-ask-to-file", inputSchema: askInputSchema })
    .step(prepareAsk)
    .step(askGate)
    .tapIf((decision) => decision.approved, fileApproved)
    // The board runs inside the approved branch of the same request, so
    // Approve starts the coder's run without a second call. The resume route
    // has already answered by the time this runs.
    .tapIf((decision) => decision.approved, () => ({}), board.drain)
    .tapIf((decision) => !decision.approved, refuseAsked);

  return defineFlow({
    kind: EM_KIND,
    // Registered once, at its kind; every EM worker's session runs on it.
    cardinality: "collection",
    configSchema: seatSettingsSchema(),
    session: installation.session(),
    resources: { ...options.resources, ...installation.resources },
    // The built-in agent flow's completion hook: a handed-on post whose run is
    // cancelled before it answers tells its coordinator, so a round with
    // answers to send on doesn't wait for its deadline.
    request: { onFinished: delegatedPostOnFinished },
    actions: {
      [FILE_ENTRY]: { block: fileRow, description: "File one feature as a row on the board." },
      [DRAIN_ENTRY]: { block: board.drain, description: "Run the board until it is idle." },
      // A third action rather than a flag on `file`, for the reason the post
      // door is one: `file` is the direct door the first check drives, and a
      // flag that made it wait would change what that check proves. Durable,
      // because the answer arrives in a later request through the engine's
      // resume route, and the request has to be there to continue.
      [ASK_ENTRY]: {
        block: askToFile,
        durable: true,
        description: "Ask a person before filing one feature; on approval, file it and run the board.",
      },
      [INSPECT_ENTRY]: {
        block: readOwnFacts,
        description: "Read what this seat can see of its own configuration. Writes nothing.",
      },
      [MESSAGE_ENTRY]: {
        block: fileFromMessage,
        inputSchema: z.object({ message: z.string() }),
        userMessage: (input: { message: string }) => input.message,
        description: "A person's line: `<issue-slug>: <what the feature is>` files that feature.",
      },
    },
    internal: {
      actions: {
        // **`internal`, not `actions`, and this is the framework's rule rather
        // than a preference.** A mailbox's fan-out reaches a seat through an
        // `internal` dispatch, which resolves `flow.internal.actions[action]`
        // and never falls through to the public map — so a public declaration
        // here is refused `no-entry` by name and the post files nothing.
        //
        // It is also where this belongs. The authority to turn a line into a
        // row is the notify block's address map, which is the app's; a caller
        // that could reach this action directly would be filing rows without
        // ever posting, which is the thing the mailbox leg exists to prove is
        // not how work starts.
        [POST_ENTRY]: { block: fileFromPost, inputSchema: postInputSchema },
        // The coder seat's message door re-runs the board here after it stops
        // a run for a person's message, in the session that claimed the row:
        // the hand-off then lands in the run's own session again.
        [RESUME_ENTRY]: { block: board.drain },
        // A coordinator's delegated post (FIX-1791): what makes an EM worker a
        // delegate that takes posts. Internal like the post door: only a
        // coordinator's delivery, with its token, reaches it.
        [DELEGATED_POST_ENTRY]: handedOnEntry,
      },
    },
  } as never);
}
