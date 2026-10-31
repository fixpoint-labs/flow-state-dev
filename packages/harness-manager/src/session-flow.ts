/**
 * One session flow for any coding harness: a person talks to a harness over
 * many turns of one session, and the session continues one conversation.
 *
 * Server only. The host decides where a session works (`workspace`) and which
 * harness runs (`agent`); the flow decides the rest:
 *
 * - **Which conversation it continues** (`resume`, `onSession`): the one the
 *   harness last confirmed for this session. `onSession` is the only writer of
 *   that id. A failure never clears it, so a conversation the harness won't
 *   continue keeps failing visibly until the person starts a new session,
 *   rather than the session moving on by itself.
 * - **Which model it runs** (`model`): the one the person picked when the
 *   session was born, held in a session field the framework fixes at birth.
 *   The flow refuses to create a session that names none. The flow does not
 *   check the id: the harness judges what it runs, and a refusal reaches the
 *   person in the harness's words.
 *
 * A line sent while a turn runs goes to the `steer` action. A run that can
 * take a line into its turn in flight offers that through `onSteerable`;
 * `steer` hands it the line and answers whether it took it. When it didn't,
 * the page sends the line as the next `turn`.
 *
 * - **Which issue it is for** (`issue`, optional): a tracker key the person
 *   named when the session was born, fixed like the model. The workspace is
 *   handed it on the session's place, so a host can name the branch after it.
 *   With `issueSpec` on, each turn until the harness confirms a conversation
 *   opens with the issue's spec, read from the session's own checkout
 *   (`./issue-spec`). Off, the prompt is the person's words alone.
 *
 * Each turn also gets a record under its request id: what it asked for, what
 * the harness confirmed during it, and how it failed, read through core's
 * neutral `harnessFailureKind` and never a harness's message. A page derives
 * its notice from that record.
 *
 * The harness records each pull request its run opens, in core's record. When
 * a turn ends, however it ended, the flow also asks GitHub which pull requests
 * the session's branch has (`@flow-state-dev/workspace`'s
 * `recordBranchPullRequests`), and adds what the turn's tool calls did not
 * show: one opened by a raw API call, say.
 *
 * Nothing here names a harness. A harness that needs more than these feeds has
 * found a gap in its own package. The flow writes no item of its own.
 */
import { existsSync } from "node:fs";
import {
  OBSERVED_PULL_REQUESTS,
  defineFlow,
  handler,
  harnessFailureKind,
  harnessSteering,
  observedPullRequestsCollection,
  sequencer,
  type HarnessSteering,
} from "@flow-state-dev/core";
import { withOutcome } from "@flow-state-dev/core/helpers";
import type {
  HarnessBlock,
  HarnessCallbackContext,
  HarnessResolver,
  HarnessRunHandle,
  HarnessSessionHook,
  HarnessSteerHook,
} from "@flow-state-dev/core/types";
import { recordBranchPullRequests } from "@flow-state-dev/workspace";
import { z } from "zod";

import { isTrackerIssue, issueSpecOptions, readIssueSpecSection, TRACKER_ISSUE_REFUSED, type IssueSpecOption } from "./issue-spec";

/** What one turn asked for and what came of it, recorded under its request id. */
export const harnessTurnRecordSchema = z.object({
  /** The conversation the turn asked to continue: the confirmed id when it started. `null` on a first turn. */
  asked: z.string().nullable().default(null),
  /** The conversation the harness confirmed during this turn, if it confirmed one. */
  confirmed: z.string().nullable().default(null),
  /** The harness's classification of the turn's failure (`harnessFailureKind`), if it failed. */
  failure: z.string().nullable().default(null),
  /** Whether the turn ended because it was stopped. */
  stopped: z.boolean().nullable().default(null),
  /** The turn's error, as the harness worded it. */
  error: z.string().nullable().default(null),
  /** When the turn started, in epoch millis. Orders turns for trimming. */
  at: z.number().nullable().default(null),
  /** Lines sent while the turn ran that the harness took into it (`steer`), oldest first. */
  steered: z.array(z.string()).nullable().default(null),
});

/** One turn's record. */
export type HarnessTurnRecord = z.infer<typeof harnessTurnRecordSchema>;

/**
 * A harness session's state. `model` is the person's pick, set when the
 * session is created and never after. The other two are written only by the
 * session flow's own resolvers, never by a caller (`serverOwned`).
 */
export const harnessSessionStateSchema = z.object({
  /**
   * The model every turn of this session runs, by the id the harness takes.
   * Set at create and fixed for the session's life (`.readonly()`: the
   * framework refuses any write that would change it). Absent only on a
   * session stored before models could be picked, which runs on the flow's
   * `defaultModel`.
   */
  model: z.string().min(1).optional().readonly(),
  /**
   * The tracker issue this session works on (`FIX-2165`), named at create and
   * fixed for the session's life, like `model`. Absent for a session that
   * names none, and on every session stored before issues could be named.
   */
  issue: z.string().min(1).optional().readonly(),
  /** The conversation this session is bound to. Written only by `onSession`. */
  binding: z
    .object({ confirmed: z.string().nullable().default(null) })
    .nullable()
    .default(null),
  /** Each recent turn's record, by request id. */
  turns: z.record(harnessTurnRecordSchema).nullable().default(null),
});

/** A harness session's state, as a page reads it from `clientData.session`. */
export type HarnessSessionState = z.infer<typeof harnessSessionStateSchema>;

/** Who a session belongs to, as the framework names it. Never read from the request body. */
export interface HarnessSessionPlace {
  /** The session's flow kind. */
  readonly flowKind: string;
  /** The authenticated tenant, when the host has one. */
  readonly tenantId?: string;
  readonly sessionId: string;
  /**
   * The issue the session was born with, when it names one. A host that
   * names branches leads the session's branch with it, so the branch says
   * what it is for and a tracker can link it.
   */
  readonly issue?: string;
}

/** Where the host's sessions work. Each call is one session's, keyed on its place. */
export interface HarnessSessionWorkspace {
  /** The session's working directory, made on its first turn and handed back after. */
  provision(place: HarnessSessionPlace): Promise<string>;
  /** Where the session's working directory is, without making it. */
  locate(place: HarnessSessionPlace): string;
  /** The branch whose pull requests the turn-end check reads, or `null` to skip the check. */
  branch(place: HarnessSessionPlace): string | null;
}

/** What the session flow hands a harness block. Spread all but `worktree` into its options. */
export interface HarnessSessionFeeds {
  /** The session's working directory, provisioned on the first turn and handed back after. */
  readonly cwd: HarnessResolver<string>;
  /** The conversation the session is bound to, or `null` on its first turn. */
  readonly resume: HarnessResolver<string | null>;
  /** Records the conversation the harness confirmed. */
  readonly onSession: HarnessSessionHook;
  /**
   * The model this run uses: the session's pick, or the flow's default for a
   * session stored before models could be picked. `undefined` leaves the
   * harness on its own default.
   */
  readonly model: HarnessResolver<string | undefined>;
  /**
   * Where the session's working directory is, for a fence that names it (a
   * sandbox's writable paths). Its real path once `cwd` has provisioned it.
   */
  readonly worktree: HarnessResolver<string>;
  /**
   * Holds the steer a running turn's harness offers, for the `steer` action.
   * A harness that can't take a line in flight never calls it.
   */
  readonly onSteerable: HarnessSteerHook;
}

/** Options for {@link harnessSessionFlow}. */
export interface HarnessSessionFlowOptions {
  /** The flow kind, one per harness (`claude-code-session`). */
  readonly kind: string;
  /** Where sessions work. */
  readonly workspace: HarnessSessionWorkspace;
  /** Build the harness block from the feeds. */
  readonly agent: (feeds: HarnessSessionFeeds) => HarnessBlock;
  /**
   * The model a session with none runs on (one stored before models could be
   * picked). Unset, the harness runs its own default.
   */
  readonly defaultModel?: string;
  /**
   * Open each turn of a session that names an issue with the issue's spec,
   * until the harness confirms a conversation (`./issue-spec`). Off by
   * default: a turn's prompt is the person's words alone.
   */
  readonly issueSpec?: IssueSpecOption;
}

/** How many turn records a session keeps. A notice reads only the latest. */
const KEPT_TURNS = 20;

/** The turn's record key: the framework's request id, never anything the caller sent. */
function requestOf(ctx: HarnessCallbackContext): string {
  return ctx.request.identity.id;
}

/** The session's place: its flow kind, tenant, id and issue, as the framework and its create named them. */
function placeOf(kind: string, ctx: HarnessCallbackContext): HarnessSessionPlace {
  const identity = ctx.session.identity;
  const issue = (ctx.session.state as HarnessSessionState | undefined)?.issue;
  return {
    flowKind: kind,
    sessionId: identity.id,
    ...(identity.tenantId !== undefined ? { tenantId: identity.tenantId } : {}),
    ...(issue !== undefined ? { issue } : {}),
  };
}

const BLANK_TURN: HarnessTurnRecord = {
  asked: null,
  confirmed: null,
  failure: null,
  stopped: null,
  error: null,
  at: null,
  steered: null,
};

/** `state` with the turn `requestId` changed by `change`, keeping only the latest {@link KEPT_TURNS}. */
function withTurn(
  state: HarnessSessionState,
  requestId: string,
  change: (turn: HarnessTurnRecord) => HarnessTurnRecord,
): HarnessSessionState {
  const turns = { ...(state.turns ?? {}) };
  turns[requestId] = change(turns[requestId] ?? { ...BLANK_TURN, at: Date.now() });
  const kept = Object.entries(turns)
    .sort(([, a], [, b]) => (b.at ?? 0) - (a.at ?? 0))
    .slice(0, KEPT_TURNS);
  return { ...state, turns: Object.fromEntries(kept) };
}

/**
 * The error a turn records when the harness returned a run it reports as
 * failed and gave no words for it. Core's handle carries no failure text, so a
 * harness's own words come from its handle's `failureMessage` when it has one
 * (Codex and Cursor do); this is the fallback when it hasn't.
 */
export const HARNESS_SESSION_FAILED_OUTCOME = "The harness reported the run as failed.";

/** The harness's own words for a failed run: its handle's `failureMessage`, when it has one. */
function failureWordsOf(handle: HarnessRunHandle): string {
  const words = (handle as { failureMessage?: unknown }).failureMessage;
  return typeof words === "string" && words.trim() !== "" ? words : HARNESS_SESSION_FAILED_OUTCOME;
}

/** Change the session's state atomically. */
async function changeState(
  ctx: HarnessCallbackContext,
  change: (state: HarnessSessionState) => HarnessSessionState,
): Promise<void> {
  await ctx.session.atomicState((state) => change(state as HarnessSessionState));
}

/** How long a session's title may be before it is cut. */
const TITLE_LENGTH = 60;

/** A session's title from its first prompt: its first line, whitespace collapsed, cut with an ellipsis. */
export function harnessSessionTitle(prompt: string): string {
  const line = (prompt.split("\n").find((l) => l.trim() !== "") ?? "").replace(/\s+/g, " ").trim();
  return line.length <= TITLE_LENGTH ? line : `${line.slice(0, TITLE_LENGTH - 1).trimEnd()}…`;
}

/** The message a create without a model is refused with. */
export const HARNESS_SESSION_MODEL_REQUIRED = "A new session must name the model it runs (`state.model`).";

/** The message a create naming a malformed issue is refused with. */
export const HARNESS_SESSION_ISSUE_REFUSED = `A session's \`state.issue\` is refused. ${TRACKER_ISSUE_REFUSED}`;

/**
 * The feeds for one flow kind.
 *
 * @param kind The flow kind.
 * @param workspace Where its sessions work.
 * @param defaultModel What {@link HarnessSessionFlowOptions.defaultModel} says.
 * @param steering The flow's steering, which holds a running turn's offer for its `steer` action.
 */
export function harnessSessionFeeds(
  kind: string,
  workspace: HarnessSessionWorkspace,
  defaultModel?: string,
  steering: HarnessSteering = harnessSteering(),
): HarnessSessionFeeds {
  return {
    onSteerable: (steer, ctx) => steering.onSteerable(steer, ctx),
    model: (ctx) => (ctx.session.state as HarnessSessionState).model ?? defaultModel,
    cwd: (ctx) => workspace.provision(placeOf(kind, ctx)),
    worktree: (ctx) => workspace.locate(placeOf(kind, ctx)),
    resume: async (ctx) => {
      const requestId = requestOf(ctx);
      return (
        (await withOutcome(
          (mutator: (state: HarnessSessionState) => HarnessSessionState) =>
            ctx.session.atomicState((state) => mutator(state as HarnessSessionState)),
          (state) => {
            const asked = state.binding?.confirmed ?? null;
            return { state: withTurn(state, requestId, (turn) => ({ ...turn, asked })), result: asked };
          },
        )) ?? null
      );
    },
    onSession: async (id, ctx) => {
      const requestId = requestOf(ctx);
      await changeState(ctx, (state) => ({
        ...withTurn(state, requestId, (turn) => ({ ...turn, confirmed: id })),
        binding: { confirmed: id },
      }));
    },
  };
}

/**
 * Build a harness's session flow.
 *
 * `turn` takes the prompt. A turn sent while another runs waits for it, for
 * as long as that one takes (`concurrency: "defer"`, which has no time limit,
 * where a `queue` wait gives up after 30 s), then continues the same
 * conversation. `steer` takes a line for the turn running now:
 * `{ taken: true }` when the harness took it into that turn, else
 * `{ taken: false }` and nothing was sent. `live` says whether the running
 * turn offered to take one at all.
 *
 * @example
 *   harnessSessionFlow({
 *     kind: "claude-code-session",
 *     workspace,
 *     agent: (feeds) => claudeCodeAgent({ ...feeds, permissionMode: "bypassPermissions" }),
 *   });
 */
export function harnessSessionFlow(options: HarnessSessionFlowOptions) {
  const steering = harnessSteering();
  const feeds = harnessSessionFeeds(options.kind, options.workspace, options.defaultModel, steering);
  const agent = options.agent(feeds);
  // Core's steer action, allowed beside a running turn: it runs no harness, it
  // hands the running one a line. Recorded on the turn that took it.
  const steer = steering.action({
    onTaken: (ctx, turnRequestId, text) =>
      changeState(ctx, (state) =>
        withTurn(state, turnRequestId, (record) => ({ ...record, steered: [...(record.steered ?? []), text] })),
      ),
  });
  // A failure is recorded on the turn, classified by the harness, so the page
  // can tell a refused conversation from any other error and from a stop. The
  // turn still fails with the harness's own error, rethrown here, and the
  // binding is left as it was.
  const recordFailure = handler({
    name: "record-turn-failure",
    execute: async (error: Error, ctx): Promise<unknown> => {
      const requestId = ctx.request.identity.id;
      await changeState(ctx, (state) =>
        withTurn(state, requestId, (record) => ({
          ...record,
          failure: harnessFailureKind(error),
          stopped: ctx.signal.aborted,
          error: error.message,
        })),
      );
      throw error;
    },
  });
  // A harness can also report a run it saw end in failure as a result, not a
  // throw. That turn is recorded as failed too, so the page shows its error
  // rather than a continued conversation. The binding is left as it was, so
  // the next turn still continues the same conversation.
  const recordFailedOutcome = handler({
    name: "record-failed-outcome",
    execute: async (handle: HarnessRunHandle, ctx): Promise<void> => {
      if (handle.outcome !== "failed") return;
      const requestId = ctx.request.identity.id;
      await changeState(ctx, (state) =>
        withTurn(state, requestId, (record) => ({
          ...record,
          failure: null,
          stopped: ctx.signal.aborted,
          error: failureWordsOf(handle),
        })),
      );
    },
  });
  // A rail lists sessions by title, so a session is titled by its first
  // prompt before the harness runs. Later turns leave the title alone. A title
  // is cosmetic: failing to write one never fails the turn.
  const titleFromPrompt = handler({
    name: "title-from-prompt",
    inputSchema: z.object({ prompt: z.string().min(1) }),
    execute: async (input, ctx): Promise<void> => {
      if (ctx.session.metadata.title != null && ctx.session.metadata.title.trim() !== "") return;
      const title = harnessSessionTitle(input.prompt);
      if (title === "") return;
      try {
        await ctx.session.setMetadata({ title });
      } catch {
        // Retried on the next turn, which finds the session still untitled.
      }
    },
  });
  // When a turn ends, however it ended: the pull requests on the session's
  // branch, added where the record lacks them. Its own timeout, not the turn's
  // abort signal, so a stopped turn is checked too. A missing or signed-out
  // `gh` is a note, never a failed turn.
  const branchPullRequests = handler({
    name: "branch-pull-requests",
    resources: { [OBSERVED_PULL_REQUESTS]: observedPullRequestsCollection },
    execute: async (_input: unknown, ctx): Promise<void> => {
      // A turn has a record under its request; a `steer` request has none.
      const harnessCtx = ctx as unknown as HarnessCallbackContext;
      const turnRecord = (harnessCtx.session.state as HarnessSessionState).turns?.[requestOf(harnessCtx)];
      if (turnRecord === undefined) return;
      const place = placeOf(options.kind, harnessCtx);
      const branch = options.workspace.branch(place);
      if (branch === null) return;
      const cwd = options.workspace.locate(place);
      if (!existsSync(cwd)) return;
      // Only what was opened since the turn began: a branch the agent switched to may hold older pull requests.
      const result = await recordBranchPullRequests(ctx, { cwd, branches: [branch], openedSince: turnRecord.at ?? undefined });
      if (result.status === "unavailable") {
        ctx.emit.status(`Pull requests on the session's branch were not checked: ${result.reason}`, { transient: false });
      }
    },
  });
  // With `issueSpec` on, a session that names an issue opens each turn with
  // its spec until the harness confirms a conversation, which then has it.
  // Read from the session's own checkout, provisioned here the way the
  // harness's `cwd` feed does (it hands the same directory back).
  const specOptions = issueSpecOptions(options.issueSpec);
  const withIssueSpec =
    specOptions === undefined
      ? undefined
      : handler({
          name: "issue-spec-brief",
          inputSchema: z.object({ prompt: z.string().min(1) }),
          execute: async (input, ctx): Promise<{ prompt: string }> => {
            const harnessCtx = ctx as unknown as HarnessCallbackContext;
            const state = harnessCtx.session.state as HarnessSessionState;
            if (state.issue === undefined || state.binding?.confirmed != null) return { prompt: input.prompt };
            const cwd = await feeds.cwd(harnessCtx);
            const section = await readIssueSpecSection(cwd, state.issue, specOptions);
            return { prompt: `${section}\n\n## The request\n\n${input.prompt}` };
          },
        });
  const opened = sequencer({
    name: "turn",
    description: "One turn of a harness session: the prompt, run by the harness where the session works.",
    inputSchema: z.object({ prompt: z.string().min(1) }),
  }).tap(titleFromPrompt);
  const turn = (withIssueSpec === undefined ? opened : opened.step(withIssueSpec))
    .step(agent.rescue([{ block: recordFailure }]))
    .tap(recordFailedOutcome);

  return defineFlow({
    kind: options.kind,
    requireUser: true,
    actions: {
      turn: {
        block: turn,
        userMessage: (input: { prompt: string }) => input.prompt,
        concurrency: "defer",
      },
      steer,
    },
    request: { onFinished: branchPullRequests },
    session: {
      stateSchema: harnessSessionStateSchema,
      // The page reads the model, the issue, the binding and the turns. The
      // model and issue are the creator's to name, once; nothing a caller
      // sends writes the other two.
      client: { expose: ["model", "issue", "binding", "turns"] },
      serverOwned: ["binding", "turns"],
      // Every path that creates a session asks this: a new session runs a named model.
      // An issue is optional, and when named it must be a tracker key: it
      // becomes a path segment and a branch name.
      createCheck: ({ state }) =>
        typeof state.model !== "string" || state.model === ""
          ? { ok: false, message: HARNESS_SESSION_MODEL_REQUIRED }
          : state.issue !== undefined && !isTrackerIssue(state.issue)
            ? { ok: false, message: HARNESS_SESSION_ISSUE_REFUSED }
            : { ok: true },
    },
  })();
}
