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
 * Each turn's record also keeps the commit the session's checkout was on when
 * the turn first reached it (`base`) and the one it was on when the turn
 * ended (`head`). The `changes` read answers what the turn's commits changed
 * between the two, file by file or one file's patch (FIX-2384), so a page
 * shows each turn's own changes, never a later turn's.
 *
 * With `verify`, a turn the harness finished also runs the host's checks in
 * the session's working directory (`commandCheck`'s runner) and records them
 * on the turn. A red check is reported, never a failed turn: the person is
 * there, and the next turn is theirs.
 *
 * When the harness step ends, however it ended, the flow also records what
 * the turn spent on its record, inside the turn so it lands before the
 * request publishes its end: the request's own spend, as every harness reports it into the
 * request (`reportHarnessSpend`), folded by orchestration's `requestSpendView`
 * so a turn reads like a task. And a subscription window a harness hears
 * about during a run (`onUsage`) lands in the person's usage record, read
 * through the flow's `harnessUsage` query (FIX-2398).
 *
 * With `approveTools`, a tool call the harness hasn't been told it may make
 * stops the turn and waits on the user, as the manager's run waits
 * (FIX-2389, FIX-2432). The flow hands the harness `onToolApproval`; a held
 * call stops the harness step, the turn waits as `suspendForUser({ kind:
 * "approval" })`, and the answer resumes the conversation the turn confirmed.
 * A yes leaves a grant the re-issued call passes on, once or for the rest of
 * the turn; a no tells the conversation it may not. The pieces are
 * `./tool-approval`'s, the ones the manager composes. A harness whose stop
 * doesn't wait for its process (`stopsOnAbort`) is never stopped for one: its
 * calls are denied, so nothing runs that nobody allowed.
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
import { requestSpendView, taskSpendViewSchema, type TaskSpendView } from "@flow-state-dev/orchestration/tasks";
import { withOutcome } from "@flow-state-dev/core/helpers";
import type {
  BlockContext,
  HarnessBlock,
  HarnessCallbackContext,
  HarnessResolver,
  HarnessRunHandle,
  HarnessSessionHook,
  HarnessSteerHook,
  HarnessUsageHook,
  HarnessUsageReader,
} from "@flow-state-dev/core/types";
import { readRequestSpend, type HarnessRunSpend } from "@flow-state-dev/core/types";
import { recordBranchPullRequests, run } from "@flow-state-dev/workspace";
import { readRunChanges, runChangesSchema } from "./commits";
import { z } from "zod";
import {
  assertCommandCheckOptions,
  commandCheckResultSchema,
  runCommandChecks,
  type CommandCheckOptions,
} from "./command-check";
import { harnessUsageAction, recordHarnessUsage } from "./harness-usage";
import {
  MAX_APPROVAL_STEPS,
  grantMatches,
  heldToolCallOf,
  heldToolCallSchema,
  heldToolDecision,
  toolApprovalOutcome,
  toolApprovalStop,
  toolGrantSchema,
  type HarnessToolApprovalHook,
  type HeldToolCall,
} from "./tool-approval";

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
  /**
   * The commit the session's checkout was on when the turn first reached it:
   * where the turn's changes start. `null` when the checkout isn't a git
   * repository, and on a turn recorded before this field (BP-030).
   */
  base: z.string().nullable().default(null),
  /** The commit the checkout was on when the turn ended: where its changes end. `null` while it runs. */
  head: z.string().nullable().default(null),
  /** The checks `verify` ran when the turn ended, in order; `null` when none ran. */
  checks: z.array(commandCheckResultSchema).nullable().default(null),
  /**
   * What the turn spent, as a task's spend reads (`taskSpendView`): the model,
   * tokens, and the vendor's charge when it reported one. Written when the
   * turn ends, however it ended; `null` before that, and on a turn that spent
   * nothing.
   */
  spend: taskSpendViewSchema.nullable().default(null),
  /** When the turn ended, in epoch millis: its duration is `endedAt - at`. */
  endedAt: z.number().nullable().default(null),
  /**
   * The harness runs `spend` counts, as each last reported. Kept so a turn
   * continued in a later run of its request (after an interruption) counts
   * the runs before it too: a continued request's ledger holds only its own.
   */
  spentRuns: z
    .array(
      z.object({
        runId: z.string().optional(),
        harness: z.string(),
        model: z.string().nullable().optional(),
        inputTokens: z.number().nullable(),
        outputTokens: z.number().nullable(),
        costUsd: z.number().nullable(),
        billing: z.enum(["api-key", "subscription"]).nullable(),
      }),
    )
    .nullable()
    .default(null),
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
  /**
   * Records a subscription window the harness heard about during the run in
   * the person's usage record, read through the flow's `harnessUsage` query.
   * A harness whose vendor sends none never calls it.
   */
  readonly onUsage: HarnessUsageHook;
  /**
   * Called by a harness that asks about each tool call before it runs, with
   * the call; it answers allow, deny or held. Handed only when the flow is
   * built with `approveTools`; absent otherwise. A held call stops the turn,
   * waits on the user, and the conversation resumes with the answer.
   * Shaped as `@flow-state-dev/claude-code`'s `onToolApproval`, so a harness
   * that spreads the feeds passes it on. A harness that can't ask per call
   * ignores it.
   */
  readonly onToolApproval?: HarnessToolApprovalHook;
}

/** What the `changes` read takes: the turn, by its request id, and optionally one file. */
export const harnessTurnChangesInputSchema = z.object({
  /** The turn's request id, as its record is keyed in `state.turns`. */
  turn: z.string().min(1),
  /** A file the turn changed, by its path in the repository: answer its patch instead of the diff. */
  path: z.string().min(1).optional(),
});

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
   * Checks to run when a turn the harness finished ends, in the session's
   * working directory, recorded on the turn's `checks`. A red check does not
   * fail the turn. Unset, nothing runs.
   */
  readonly verify?: CommandCheckOptions<HarnessSessionVerifyContext>;
  /**
   * One reader per harness for the flow's `harnessUsage` query, keyed by the
   * harness's name, run only when a caller asks it to refresh. Unset, the
   * query reads only what runs recorded.
   */
  readonly usageReaders?: Readonly<Record<string, HarnessUsageReader>>;
  /**
   * A user approves each tool call the harness hasn't been told it may make
   * (FIX-2432): the turn waits on them, and their answer resumes its
   * conversation. Off by default, and with it off no feed is handed. Needs
   * durable execution: a turn on a host without it is refused.
   */
  readonly approveTools?: boolean;
}

/** What a `verify` resolver is handed: whose session, and where it works. */
export interface HarnessSessionVerifyContext {
  readonly place: HarnessSessionPlace;
  readonly cwd: string;
}

/** How many turn records a session keeps. A notice reads only the latest. */
const KEPT_TURNS = 20;

/** The turn's record key: the framework's request id, never anything the caller sent. */
function requestOf(ctx: HarnessCallbackContext): string {
  return ctx.request.identity.id;
}

/** The session's place: its flow kind, tenant and id, as the framework names them. */
function placeOf(kind: string, ctx: HarnessCallbackContext): HarnessSessionPlace {
  const identity = ctx.session.identity;
  return {
    flowKind: kind,
    sessionId: identity.id,
    ...(identity.tenantId !== undefined ? { tenantId: identity.tenantId } : {}),
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
  base: null,
  head: null,
  checks: null,
  spend: null,
  endedAt: null,
  spentRuns: null,
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

/** The commit `cwd`'s checkout is on, or `null` when git can't read one there. */
async function headCommit(cwd: string): Promise<string | null> {
  try {
    return (await run("git", ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"], { cwd, timeoutMs: 10_000 })).stdout.trim() || null;
  } catch {
    return null;
  }
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
    // The person running the turn is the principal, so the window lands in their row.
    onUsage: async (report, ctx) => {
      await recordHarnessUsage(ctx, report);
    },
    model: (ctx) => (ctx.session.state as HarnessSessionState).model ?? defaultModel,
    cwd: async (ctx) => {
      const cwd = await workspace.provision(placeOf(kind, ctx));
      // Where this turn's changes start: the first time the turn reaches its checkout.
      const requestId = requestOf(ctx);
      if ((ctx.session.state as HarnessSessionState).turns?.[requestId]?.base == null) {
        const base = await headCommit(cwd);
        if (base !== null) {
          await changeState(ctx, (state) =>
            withTurn(state, requestId, (turn) => (turn.base == null ? { ...turn, base } : turn)),
          );
        }
      }
      return cwd;
    },
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
  if (options.verify !== undefined) assertCommandCheckOptions(options.verify as CommandCheckOptions<unknown>, "harnessSessionFlow's verify");
  const steering = harnessSteering();
  const approveTools = options.approveTools === true;
  const feeds = harnessSessionFeeds(options.kind, options.workspace, options.defaultModel, steering);
  // The approval feed, its stop and the calls it held, kept per request.
  // `stopsOnAbort` is read off the block once it's built, before any turn runs.
  const approvals = sessionApprovals(options.kind, options.workspace);
  const agent = options.agent(approveTools ? { ...feeds, onToolApproval: approvals.ask } : feeds);
  approvals.stopsOnAbort = agent.stopsOnAbort === true;
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
  const recordTurnFailure = async (error: Error, ctx: BlockContext): Promise<never> => {
    const requestId = ctx.request.identity.id;
    await changeState(ctx as unknown as HarnessCallbackContext, (state) =>
      withTurn(state, requestId, (record) => ({
        ...record,
        failure: harnessFailureKind(error),
        stopped: ctx.signal.aborted,
        error: error.message,
        ...turnEndOf(ctx, requestId, record),
      })),
    );
    // A stopped or failed turn still records where its changes end. Never in
    // place of the harness's error: a head that can't be written is left unset.
    await writeTurnHead(ctx as unknown as HarnessCallbackContext).catch(() => undefined);
    throw error;
  };
  const recordFailure = handler({
    name: "record-turn-failure",
    execute: async (error: Error, ctx): Promise<unknown> => recordTurnFailure(error, ctx as unknown as BlockContext),
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
  // The commit the turn's checkout is on, where its changes end. Written
  // inside the turn, as it succeeds (a step after the harness) or as it throws
  // (`recordFailure`): a page refreshes on the turn's terminal status, which
  // the engine emits before `request.onFinished` runs. A checkout git can't
  // read leaves it unset, and the read then ends at the checkout's HEAD.
  async function writeTurnHead(ctx: HarnessCallbackContext): Promise<void> {
    const requestId = requestOf(ctx);
    // A turn that never reached a git checkout has no base, so nothing for an end to bound.
    if ((ctx.session.state as HarnessSessionState).turns?.[requestId]?.base == null) return;
    const cwd = options.workspace.locate(placeOf(options.kind, ctx));
    if (!existsSync(cwd)) return;
    const head = await headCommit(cwd);
    if (head === null) return;
    await changeState(ctx, (state) => withTurn(state, requestId, (record) => ({ ...record, head })));
  }
  const recordTurnHead = handler({
    name: "record-turn-head",
    execute: async (_input: unknown, ctx): Promise<void> => writeTurnHead(ctx as unknown as HarnessCallbackContext),
  });
  // When the harness step returns: what the turn spent, on its record. The
  // harness reported its run into the request before its block returned, so
  // the request's pending spend is the whole turn. Written inside the turn,
  // not at `onFinished`, so it lands before the request publishes its end and
  // a page that refreshes on that end reads it. A turn that threw records it
  // in `recordFailure`'s write instead. A failed write is a note, never a
  // failed turn.
  const turnSpend = handler({
    name: "turn-spend",
    execute: async (_handle: HarnessRunHandle, ctx): Promise<void> => {
      const requestId = ctx.request.identity.id;
      try {
        await changeState(ctx, (state) => withTurn(state, requestId, (record) => ({ ...record, ...turnEndOf(ctx, requestId, record) })));
      } catch (error) {
        ctx.emit.status(`What the turn spent was not recorded: ${(error as Error).message}`, { transient: false });
      }
    },
  });
  // Only effects no page reads on the turn's end: anything a page shows then is written inside the turn.
  const turnEnd = sequencer({ name: "turn-end", inputSchema: z.unknown() }).tap(branchPullRequests);
  // What one turn's commits changed, between the commits its record keeps. A
  // read: answered in the response and stored nowhere, so an opened patch
  // never lands in the session's log.
  const changes = handler({
    name: "turn-changes",
    inputSchema: harnessTurnChangesInputSchema,
    outputSchema: runChangesSchema,
    execute: async (input, ctx) => {
      const harnessCtx = ctx as unknown as HarnessCallbackContext;
      const record = (harnessCtx.session.state as HarnessSessionState).turns?.[input.turn];
      if (record === undefined) throw new Error(`This session keeps no turn "${input.turn}".`);
      const cwd = options.workspace.locate(placeOf(options.kind, harnessCtx));
      // A turn that never reached a git checkout has no base: an unverified, empty answer.
      // `== null`: a turn recorded before these fields has neither, and reads unverified (BP-030).
      const base = record.base ?? null;
      // With a base commit the read uses it alone; the ref only has to be non-null (`resolveBases`).
      return readRunChanges(existsSync(cwd) ? cwd : "", base === null ? null : "HEAD", base, {
        // From the commit the turn started on, exactly: a turn that amended the last one's commit is still only its own work.
        exactBase: true,
        ...(record.head != null ? { head: record.head } : {}),
        ...(input.path !== undefined ? { path: input.path } : {}),
      });
    },
  });
  // When a turn the harness finished ends: the host's checks, on the turn's
  // record. Reported, not a failure: a red check leaves the turn as it ended.
  const verifyTurn = handler({
    name: "verify-turn",
    execute: async (handle: HarnessRunHandle, ctx): Promise<void> => {
      const verify = options.verify;
      if (verify === undefined || handle.outcome !== "finished" || ctx.signal.aborted) return;
      const harnessCtx = ctx as unknown as HarnessCallbackContext;
      const place = placeOf(options.kind, harnessCtx);
      const cwd = options.workspace.locate(place);
      if (!existsSync(cwd)) return;
      const checks = await runCommandChecks(verify, cwd, { place, cwd }, ctx.signal);
      if (checks.length === 0) return;
      const requestId = ctx.request.identity.id;
      await changeState(ctx, (state) => withTurn(state, requestId, (record) => ({ ...record, checks })));
    },
  });
  // The harness step, with its approval loop when `approveTools` is on; the
  // turn's records come after it either way.
  const harnessTurn = approveTools
    ? approvals.turn({ agent, titleFromPrompt, recordTurnFailure })
    : sequencer({
        name: "turn",
        description: "One turn of a harness session: the prompt, run by the harness where the session works.",
        inputSchema: z.object({ prompt: z.string().min(1) }),
      })
        .tap(titleFromPrompt)
        .step(agent.rescue([{ block: recordFailure }]));
  const turn = harnessTurn.tap(recordFailedOutcome).tap(turnSpend).tap(recordTurnHead).tap(verifyTurn);

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
      // What each harness's subscription has used, as `onUsage` recorded it.
      harnessUsage: harnessUsageAction({ readers: options.usageReaders ?? {} }),
    },
    reads: { changes: { block: changes, description: "What one turn's commits changed: its files and lines, or one file's patch." } },
    request: { onFinished: turnEnd },
    session: {
      stateSchema: harnessSessionStateSchema,
      // The page reads the model, the binding and the turns. The model is the
      // creator's to name, once; nothing a caller sends writes the other two.
      client: { expose: ["model", "binding", "turns"] },
      serverOwned: ["binding", "turns"],
      // Every path that creates a session asks this: a new session runs a named model.
      createCheck: ({ state }) =>
        typeof state.model === "string" && state.model !== ""
          ? { ok: true }
          : { ok: false, message: HARNESS_SESSION_MODEL_REQUIRED },
    },
  })();
}

/**
 * What a turn's record gets when its harness step ends: what it spent, and
 * when. The runs are this run of the request's, as its ledger reports them,
 * plus any an earlier run of the same request recorded that this one's
 * ledger doesn't hold (a turn continued after an interruption: its ledger
 * holds only its own runs). A run with an id is one run however often it is
 * written, so a second write in the same run of the request counts it once. Model
 * calls are the ledger's: a continued request's ledger carries the earlier
 * ones.
 */
function turnEndOf(
  ctx: object,
  requestId: string,
  record: { spentRuns?: readonly HarnessRunSpend[] | null },
): { spend: TaskSpendView | null; spentRuns: HarnessRunSpend[] | null; endedAt: number } {
  const pending = readRequestSpend(ctx);
  const now = pending?.harnessRuns ?? [];
  // A run with an id is the same run wherever it is written, including one a
  // continuation recovered from the log after this turn's earlier write (the
  // engine names a run reported without an id, so that one has one too). One
  // still without an id came from a seam that named none: a settled run of its
  // own (the `HarnessRunSpend` contract), so an earlier one is always kept.
  const earlier = (record.spentRuns ?? []).filter((run) => run.runId === undefined || !now.some((other) => other.runId === run.runId));
  const harnessRuns = [...earlier, ...now];
  const spend = pending === undefined && harnessRuns.length === 0 ? null : requestSpendView({ byModel: pending?.byModel ?? {}, harnessRuns }, requestId);
  return { spend, spentRuns: harnessRuns.length === 0 ? null : harnessRuns, endedAt: Date.now() };
}


/**
 * A turn's tool approvals (FIX-2432), on the turn's sequencer state so a
 * resume after a restart reads them: the call the turn waits on, the grants
 * the user's answers left, and how many answers resumed it. A turn is one
 * request, so its grants end with it.
 */
const turnApprovalsSchema = z.object({
  approvals: z
    .object({
      pending: heldToolCallSchema.nullable().default(null),
      grants: z.array(toolGrantSchema).default([]),
      steps: z.number().int().default(0),
    })
    .nullable()
    .default(null),
});
type TurnApprovals = NonNullable<z.infer<typeof turnApprovalsSchema>["approvals"]>;

/** What a harness step stopped for an approval hands on, in place of a handle. */
const STOPPED_FOR_APPROVAL = "harness-session:stopped-for-approval";

/** The message a turn with approvals on is refused with on a host without durable execution. */
export const HARNESS_SESSION_APPROVALS_NEED_DURABLE =
  "This session asks a user before the harness's tool calls (`approveTools`), and a call waits for them " +
  "as a durable stop. Run it on a host with durable execution on, or turn `approveTools` off.";

/** The turn's approvals, as its sequencer state holds them. */
function turnApprovalsOf(ctx: { sequencer?: { state?: unknown } | undefined }): TurnApprovals {
  const state = ctx.sequencer?.state as z.infer<typeof turnApprovalsSchema> | undefined;
  return state?.approvals ?? { pending: null, grants: [], steps: 0 };
}

/**
 * The approval wait for one session flow kind: the feed, and the turn that
 * composes it. The per-request maps hold only what a running step needs; what
 * a wait needs is on the turn's state.
 */
function sessionApprovals(kind: string, workspace: HarnessSessionWorkspace) {
  /** Each running harness step's stop, by request. */
  const stops = new Map<string, AbortController>();
  /** The call each step was stopped on, until the held-call step moves it onto the turn's state. */
  const heldCalls = new Map<string, HeldToolCall>();
  /** The `once` grants a step spent, by their index in the turn's grants. */
  const spentGrants = new Map<string, Set<number>>();

  const self = {
    /** Whether the harness's stop waits for its process; set once the block is built. */
    stopsOnAbort: false,

    /**
     * The `onToolApproval` feed. A call a grant of this turn covers runs (a
     * `once` grant is spent on it); any other is held and the harness step is
     * stopped for it. A harness whose stop doesn't wait for its process is
     * never stopped for one: its call is denied, so nothing runs unallowed.
     */
    ask: ((request, ctx) => {
      const requestId = ctx.request.identity.id;
      const call = heldToolCallOf(request, workspace.locate(placeOf(kind, ctx)));
      const { grants } = turnApprovalsOf(ctx as never);
      const spent = spentGrants.get(requestId) ?? new Set<number>();
      const granted = grants.findIndex((grant, at) => !spent.has(at) && grantMatches(grant, call));
      if (granted >= 0) {
        if (grants[granted]!.scope === "once") {
          spent.add(granted);
          spentGrants.set(requestId, spent);
        }
        return { decision: "allow" };
      }
      const stop = stops.get(requestId);
      if (!self.stopsOnAbort || stop === undefined) {
        return {
          decision: "deny",
          message:
            `${call.toolName} needs a user's approval, and this turn can't be stopped to wait for one ` +
            `(its harness's stop doesn't wait for its process). Go on without it.`,
        };
      }
      // The first held call of a step is the one asked about; a call made while the stop lands waits behind it.
      if (!heldCalls.has(requestId)) {
        heldCalls.set(requestId, call);
        stop.abort(new Error("[harness-session] stopped for a tool approval"));
      }
      return heldToolDecision(call);
    }) satisfies HarnessToolApprovalHook,

    /**
     * The turn, with approvals: the harness step, then the wait for a call it
     * was stopped on, then back to the harness step with the answer, until a
     * step ends with no call held.
     */
    turn({
      agent,
      titleFromPrompt,
      recordTurnFailure,
    }: {
      agent: HarnessBlock;
      titleFromPrompt: ReturnType<typeof handler>;
      recordTurnFailure: (error: Error, ctx: BlockContext) => Promise<never>;
    }) {
      // Refused before the harness runs: a held call waits as a durable stop.
      const requireDurable = handler({
        name: `${kind}-approvals-need-durable`,
        execute: async (_input: unknown, ctx) => {
          if ((ctx as { requestHost?: { resumeWait?: unknown } }).requestHost?.resumeWait === undefined) {
            throw new Error(HARNESS_SESSION_APPROVALS_NEED_DURABLE);
          }
        },
      });
      // The harness step, with its own stop: a step stopped for an approval
      // ends with a marker, not an error, so the turn goes on to the wait.
      // Any other failure is the turn's, recorded as without approvals.
      const harnessStep = sequencer({
        name: `${kind}-harness-step`,
        inputSchema: z.object({ prompt: z.string() }).passthrough(),
      })
        .step(agent, {
          abortSignal: (ctx) => {
            const controller = new AbortController();
            stops.set(ctx.request.identity.id, controller);
            return controller.signal;
          },
          onSettled: (ctx) => {
            stops.delete(ctx.request.identity.id);
          },
        })
        .rescue([
          {
            block: handler({
              name: `${kind}-stopped-for-approval`,
              inputSchema: z.unknown(),
              outputSchema: z.unknown(),
              execute: async (error: unknown, ctx) => {
                if (heldCalls.has(ctx.request.identity.id)) return STOPPED_FOR_APPROVAL;
                return recordTurnFailure(error as Error, ctx as unknown as BlockContext);
              },
            }),
          },
        ]);
      // Its own step, before the wait: a resume runs the waiting step's code
      // again from the state its earlier steps left, so the held call must be
      // on that state before the step that waits starts.
      const heldCallStep = handler({
        name: `${kind}-tool-held`,
        inputSchema: z.unknown(),
        outputSchema: z.unknown(),
        sequencerStateSchema: turnApprovalsSchema,
        execute: async (value: unknown, ctx) => {
          const requestId = ctx.request.identity.id;
          const held = heldCalls.get(requestId);
          const spent = spentGrants.get(requestId);
          heldCalls.delete(requestId);
          spentGrants.delete(requestId);
          const approvals = turnApprovalsOf(ctx as never);
          const grants = approvals.grants.filter((_, at) => spent?.has(at) !== true);
          if (held === undefined && grants.length === approvals.grants.length) return value;
          if (held !== undefined) {
            // The stopped run reported its spend into this run of the request,
            // and a resume starts a ledger that no longer holds it: on the turn
            // now, so the turn's end counts it with the runs after.
            await changeState(ctx as unknown as HarnessCallbackContext, (state) =>
              withTurn(state, requestId, (record) => ({ ...record, spentRuns: turnEndOf(ctx, requestId, record).spentRuns })),
            );
          }
          await ctx.sequencer!.patchState({ approvals: { ...approvals, grants, pending: held ?? null } });
          return value;
        },
      });
      // The wait, and what its answer means: a yes leaves a grant and a no
      // tells the conversation; either resumes the conversation the turn
      // confirmed. A cancel ends the turn.
      const approvalStep = handler({
        name: `${kind}-tool-approval`,
        inputSchema: z.unknown(),
        outputSchema: z.unknown(),
        sequencerStateSchema: turnApprovalsSchema,
        execute: async (value: unknown, ctx) => {
          const approvals = turnApprovalsOf(ctx as never);
          const call = approvals.pending;
          if (call === null) return value;
          const steps = approvals.steps + 1;
          if (steps > MAX_APPROVAL_STEPS) {
            // The turn fails on its record, as a harness failure does.
            return recordTurnFailure(
              new Error(
                `[harness-session] the turn has already been resumed for ${MAX_APPROVAL_STEPS} tool approvals, ` +
                  `the most one turn takes; it asked again for ${call.toolName}${call.touches === null ? "" : ` (${call.touches})`}.`,
              ),
              ctx as unknown as BlockContext,
            );
          }
          const confirmed = (ctx.session.state as HarnessSessionState).binding?.confirmed ?? null;
          if (confirmed === null) {
            // The turn fails on its record, as a harness failure does.
            return recordTurnFailure(
              new Error(
                `[harness-session] the turn asked to use ${call.toolName}, and its harness confirmed no ` +
                  `conversation to continue after an answer.`,
              ),
              ctx as unknown as BlockContext,
            );
          }
          const asked = await ctx.suspendForUser(toolApprovalStop(call));
          if (asked.cancelled) {
            await ctx.sequencer!.patchState({ approvals: { ...approvals, pending: null, steps } });
            return value;
          }
          const outcome = toolApprovalOutcome(asked, call);
          await ctx.sequencer!.patchState({
            approvals: {
              pending: null,
              steps,
              grants: outcome.grant === null ? approvals.grants : [...approvals.grants, outcome.grant],
            },
          });
          return { prompt: outcome.prompt, again: true };
        },
      });
      return sequencer({
        name: "turn",
        description: "One turn of a harness session: the prompt, run by the harness where the session works.",
        inputSchema: z.object({ prompt: z.string().min(1) }),
        stateSchema: turnApprovalsSchema,
      })
        .tap(requireDurable)
        .tap(titleFromPrompt)
        .step(harnessStep)
        .step(heldCallStep)
        .step(approvalStep)
        .loopBack(harnessStep.name, {
          when: (value) => (value as { again?: unknown } | null)?.again === true,
          maxIterations: MAX_APPROVAL_STEPS + 1,
        });
    },
  };
  return self;
}
