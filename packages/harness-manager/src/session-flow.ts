// FIX-2384; FIX-2398; FIX-2389, FIX-2432.
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
 * A session's first turn waits for its working directory, and with it for any
 * setup command the host runs in a fresh checkout (`@flow-state-dev/workspace`'s
 * `setup`). A host that reports that setup through `provision` gets it on the
 * turn's record, `running` while it runs and then `done` or `failed` with the
 * tail of its output, so the page can say "setting up" and why it failed.
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
 * between the two, file by file or one file's patch, so a page
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
 * through the flow's `harnessUsage` query.
 *
 * **Where a session starts** (`start`) is the person's pick at create, fixed
 * like the model: a ref to cut a new branch from, an existing branch, or a
 * pull request's head branch. The host's workspace honours it on the first
 * provision (`resolveHarnessSessionStart` turns it into a workspace host's
 * request). The session records only the key of its worktree's row
 * (`state.workspace.worktree`); the row holds which branch it got.
 * **`removeWorktree`** removes the session's worktree through the host's one
 * removal path, refused while a turn runs.
 *
 * **Attaching** (`start: { worktreeOf }`) is the one way two sessions share a
 * worktree: the new session works in the owner session's worktree, on its
 * branch, and makes neither. Each turn of either holds the worktree in use, so
 * two harnesses never write to it at once. Only the owner removes it. An
 * attached turn that leaves the worktree on another branch is recorded as
 * failed: the owner's branch is the owner's.
 *
 * With `approveTools`, a tool call the harness hasn't been told it may make
 * stops the turn and waits on the user, as the manager's run waits.
 * The flow hands the harness `onToolApproval`; a held
 * call stops the harness step, the turn waits as `suspendForUser({ kind:
 * "approval" })`, and the answer resumes the conversation the turn confirmed.
 * A yes leaves a grant the re-issued call passes on, once or for the rest of
 * the turn; a no tells the conversation it may not. The pieces are
 * `./tool-approval`'s, the ones the manager composes. A harness whose stop
 * doesn't wait for its process (`stopsOnAbort`) is never stopped for one: its
 * calls are denied, so nothing runs that nobody allowed.
 *
 * **A turn's deadline** (`turnTimeoutMs`, 60 minutes by default): the harness
 * step is stopped once it has run that long, through the same abort a stop
 * uses, so a harness wedged on a hung tool takes its process down with it.
 * The turn ends recorded as `timedOut`, with an error that says so. Time a
 * turn spends waiting on a user's answer about a tool call doesn't count:
 * each harness run the turn resumes gets the whole deadline again.
 *
 * Nothing here names a harness. A harness that needs more than these feeds has
 * found a gap in its own package. The flow writes no item of its own.
 */
import { existsSync } from "node:fs";
import { defineFlow, defineView, handler, sequencer } from "@flow-state-dev/core";
import {
  OBSERVED_PULL_REQUESTS,
  harnessFailureKind,
  harnessSteering,
  observedPullRequestsCollection,
  refuseUnacceptedAttachments,
  type HarnessSteering,
} from "@flow-state-dev/core/harness";
import { taskSpendViewSchema, type TaskSpendView } from "@flow-state-dev/orchestration/tasks";
import { requestSpendView } from "@flow-state-dev/orchestration/internal";
import { withOutcome } from "@flow-state-dev/core/helpers";
import type { BlockContext } from "@flow-state-dev/core/types";
import type {
  HarnessBlock,
  HarnessCallbackContext,
  HarnessResolver,
  HarnessRunHandle,
  HarnessRunInput,
  HarnessSessionHook,
  HarnessSteerHook,
  HarnessUsageHook,
  HarnessUsageReader,
} from "@flow-state-dev/core/harness";
import { readRequestTotalSpend, requestHostOf } from "@flow-state-dev/core/internal";
import {
  checkedOutBranch,
  occupyWorktree,
  pullRequestHead,
  recordBranchPullRequests,
  releaseLock,
  run,
  WORKTREES,
  worktreesCollection,
  type LockLease,
  type PlaceSetup,
  type WorktreeCollection,
  type WorktreeOwner,
  type WorktreeRecording,
} from "@flow-state-dev/workspace";
import { readRunChanges, runChangesSchema } from "./commits";
import { z } from "zod";
import {
  assertCommandCheckOptions,
  commandCheckResultSchema,
  runCommandChecks,
  type CommandCheckOptions,
} from "./command-check";
import { assertPositiveInt } from "./guards";
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
  /**
   * The host's setup command in the session's fresh checkout, when this turn
   * waited on it: `running` while it runs, then `done`, or `failed` with the
   * tail of its output. `null` on a turn that waited on none.
   */
  setup: z
    .object({
      state: z.enum(["running", "done", "failed"]),
      tail: z.string().nullable().default(null),
    })
    .nullable()
    .default(null),
  // BP-030.
  /**
   * The commit the session's checkout was on when the turn first reached it:
   * where the turn's changes start. `null` when the checkout isn't a git
   * repository, and on a turn recorded before this field.
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
  // BP-030.
  /**
   * Whether the turn is waiting now for a user's answer about a tool call
   * (`approveTools`). No other turn of the session runs while it is. `null`
   * on a turn that never waited, and on one recorded before this field.
   */
  waitsOnApproval: z.boolean().nullable().default(null),
  // BP-030.
  /**
   * Whether the turn ended because its harness ran past the flow's deadline
   * (`turnTimeoutMs`) and was stopped. `null` on a turn that didn't, and on
   * one recorded before this field.
   */
  timedOut: z.boolean().nullable().default(null),
});

/** One turn's record. */
export type HarnessTurnRecord = z.infer<typeof harnessTurnRecordSchema>;

/**
 * Where a session starts, picked at create: exactly one of
 * - `base`: cut a new branch from this ref (`origin/main` is fetched first),
 * - `branch`: work on this existing branch, as it stands,
 * - `pullRequest`: work on this pull request's head branch,
 * - `worktreeOf`: work in this other session's worktree, on its branch, making
 *   neither (attaching). The session is the same user's and tenant's, of the
 *   same flow.
 */
export const harnessSessionStartSchema = z.union([
  z.object({ base: z.string().min(1) }).strict(),
  z.object({ branch: z.string().min(1) }).strict(),
  z.object({ pullRequest: z.number().int().positive() }).strict(),
  z.object({ worktreeOf: z.string().min(1) }).strict(),
]);

/** Where a session starts. */
export type HarnessSessionStart = z.infer<typeof harnessSessionStartSchema>;

// BP-030.
/**
 * Where a session works: a pointer to its worktree's row in the user's list
 * (`worktreesCollection`), which owns the path, branch, base, commit count,
 * owner and state. Nothing of the worktree is copied here, so the row is the
 * one owner. A record stored before this shape held copies of the path and
 * branch; they are dropped on read.
 */
export const harnessSessionWorkspaceRecordSchema = z.object({
  /**
   * The key of the worktree's row. `null` when the workspace wrote no row
   * (one with no `worktrees` support, or a record from before rows existed).
   */
  worktree: z.string().nullable().default(null),
});

/** Where a session works. */
export type HarnessSessionWorkspaceRecord = z.infer<typeof harnessSessionWorkspaceRecordSchema>;

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
   * The tracker issue this session works on (`ENG-142`), named at create and
   * fixed for the session's life, like `model`. Absent for a session that
   * names none, and on every session stored before issues could be named.
   */
  issue: z.string().min(1).optional().readonly(),
  /**
   * Where the session starts. Set at create and fixed, like `model`. Absent:
   * wherever the host starts a session by default, as every session stored
   * before it could be picked does.
   */
  start: harnessSessionStartSchema.optional().readonly(),
  /** Where the session works, once it has. Written only by the flow. */
  workspace: harnessSessionWorkspaceRecordSchema.nullable().default(null),
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

/** What `HarnessSessionWorkspace.provision` is told beside the place. One object, so later fields join it. */
export interface HarnessSessionProvisionRequest {
  /** The session's start, when it picked one. Honoured when the workspace is made; a later provision hands it back. */
  readonly start?: HarnessSessionStart;
  /** The user's worktree rows, to hand the host's provision (`PlaceRequest.worktrees`), so it writes the row. */
  readonly worktrees?: WorktreeRecording;
  /** Call when the host's setup command starts (`PlaceRequest.onSetup`). Records it on the turn. */
  readonly onSetup?: () => Promise<void>;
}

/** What `HarnessSessionWorkspace.provision` made, when it says more than the path. One object, so later fields join it. */
export interface HarnessSessionProvisioned {
  /** The working directory. */
  readonly path: string;
  /** The key of the worktree's row, when the host wrote one (`WorkspacePlace.worktree`). */
  readonly worktree?: string;
  /** What the host's setup command came to, when this provision ran it (`WorkspacePlace.setup`). */
  readonly setup?: PlaceSetup;
}

/** Where the host's sessions work. Each call is one session's, keyed on its place. */
export interface HarnessSessionWorkspace {
  /**
   * The session's working directory, made on its first turn and handed back
   * after: the path, or `{ path, worktree?, setup? }`. Pass `request.onSetup`
   * to the host and return its `setup`, to put the host's setup command on the
   * turn's record; a bare path records none.
   */
  provision(place: HarnessSessionPlace, request?: HarnessSessionProvisionRequest): Promise<string | HarnessSessionProvisioned>;
  /** Where the session's working directory is, without making it. */
  locate(place: HarnessSessionPlace): string;
  /**
   * The branch whose pull requests the turn-end check reads, or `null` to
   * skip the check. A branch `provision` named is read first.
   */
  branch(place: HarnessSessionPlace): string | null;
  /**
   * Remove the session's worktree, and with `deleteBranch` its branch, through
   * the host's one removal path (`WorkspaceHost.remove`). Optional: without
   * it, `removeWorktree` is refused.
   */
  remove?(
    place: HarnessSessionPlace,
    options: { deleteBranch: boolean; force: boolean; worktrees?: WorktreeCollection },
  ): Promise<{ branchDeleted: boolean }>;
  /**
   * Record that `session` works in `owner`'s worktree (`WorkspaceHost.attach`),
   * returning the row's key, or `null` when it has none. Optional: without it,
   * an attached session records no row key.
   */
  attach?(owner: HarnessSessionPlace, request: { worktrees: WorktreeCollection; by: WorktreeOwner }): Promise<string | null>;
  /**
   * Read the worktree at a turn's end and write its branch and commit count to
   * its row (`WorkspaceHost.recordCheckout`). Optional: without it, the row
   * keeps what provision wrote.
   */
  recordCheckout?(place: HarnessSessionPlace, request: { worktrees: WorktreeCollection; by?: WorktreeOwner }): Promise<unknown>;
}

/** The user's worktree rows off a block's context, when the flow has them. */
function worktreesOf(ctx: { resources?: unknown }): WorktreeCollection | undefined {
  const collection = (ctx.resources as Record<string, unknown> | undefined)?.[WORKTREES] as WorktreeCollection | undefined;
  return typeof collection?.upsert === "function" ? collection : undefined;
}

/** The session a start attaches to, when it attaches (`{ worktreeOf }`). */
export function harnessSessionAttachedTo(start: HarnessSessionStart | undefined): string | null {
  return start !== undefined && "worktreeOf" in start ? start.worktreeOf : null;
}

/** What a workspace host's provision needs from a session's start (`PlaceRequest` and `RepoRunSource`). */
export interface ResolvedHarnessSessionStart {
  /** Cut the session's branch from this ref (`RepoRunSource.baseRef`). */
  readonly baseRef?: string;
  /** Work on this existing branch instead of cutting the session's own (`PlaceRequest.branch` with `existing`). */
  readonly branch?: string;
}

/**
 * Turn a session's start into what a workspace host's provision takes. A pull
 * request is asked of GitHub (`pullRequestHead`), in `options.cwd`, a checkout
 * of its repository, and refused when it comes from a fork. No start: `{}`,
 * the host's default. An attaching start provisions nothing (the session flow
 * locates the owner's worktree instead), so it is refused here.
 */
export async function resolveHarnessSessionStart(
  start: HarnessSessionStart | undefined,
  options: { readonly cwd: string; readonly gh?: string },
): Promise<ResolvedHarnessSessionStart> {
  if (start === undefined) return {};
  if ("base" in start) return { baseRef: start.base };
  if ("branch" in start) return { branch: start.branch };
  if ("worktreeOf" in start) throw new Error(HARNESS_SESSION_ATTACH_NOT_PROVISIONED);
  const head = await pullRequestHead({ cwd: options.cwd, number: start.pullRequest, ...(options.gh !== undefined ? { gh: options.gh } : {}) });
  return { branch: head.branch };
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
  // FIX-2432.
  /**
   * A user approves each tool call the harness hasn't been told it may make:
   * the turn waits on them, and their answer resumes its
   * conversation. Off by default, and with it off no feed is handed. Needs
   * durable execution: a turn on a host without it is refused.
   */
  readonly approveTools?: boolean;
  /**
   * Open each turn of a session that names an issue with the issue's spec,
   * until the harness confirms a conversation (`./issue-spec`). Off by
   * default: a turn's prompt is the person's words alone.
   */
  readonly issueSpec?: IssueSpecOption;
  // FIX-2680.
  /**
   * How long the harness may run in one turn, in ms, before it is stopped and
   * the turn ends timed out. Time a turn waits on a user's answer about a
   * tool call (`approveTools`) doesn't count: each run it resumes gets the
   * whole of it. Default 60 minutes.
   */
  readonly turnTimeoutMs?: number;
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

/**
 * Where the session works: its own place, or the place of the session it
 * attached to. The owner's place takes this session's flow kind and tenant,
 * never the caller's word, so a session of another tenant is never found.
 */
function workPlaceOf(kind: string, ctx: HarnessCallbackContext): HarnessSessionPlace {
  const own = placeOf(kind, ctx);
  const owner = harnessSessionAttachedTo((ctx.session.state as HarnessSessionState).start);
  return owner === null ? own : { ...own, sessionId: owner };
}

const BLANK_TURN: HarnessTurnRecord = {
  asked: null,
  confirmed: null,
  failure: null,
  stopped: null,
  error: null,
  at: null,
  steered: null,
  setup: null,
  base: null,
  head: null,
  checks: null,
  spend: null,
  endedAt: null,
  waitsOnApproval: null,
  timedOut: null,
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

/** The message a create with a malformed start is refused with. */
export const HARNESS_SESSION_START_INVALID =
"A session's start (`state.start`) is exactly one of { base: <ref> }, { branch: <name> }, { pullRequest: <number> } or { worktreeOf: <session id> }.";

/** The message an attaching session is refused with when the worktree it names isn't there. */
export const HARNESS_SESSION_ATTACH_MISSING =
  "The session this one attaches to (`start.worktreeOf`) has no worktree here: it is not this tenant's, was never provisioned, or was removed.";

/** The message an attaching session is refused with when the worktree isn't in its user's own list. */
export const HARNESS_SESSION_ATTACH_NOT_YOURS =
  "The worktree this session attaches to (`start.worktreeOf`) is not in your list of worktrees: only your own sessions' worktrees can be attached to, on a host that keeps that list.";

/** The message an attaching start is refused with when something asks a workspace to provision it. */
export const HARNESS_SESSION_ATTACH_NOT_PROVISIONED =
  "An attaching start (`{ worktreeOf }`) provisions nothing: the session works in the owner's worktree.";

/** The message `removeWorktree` is refused with on a session that doesn't own its worktree. */
export const HARNESS_SESSION_REMOVE_NOT_OWNER =
  "This session works in another session's worktree (`start.worktreeOf`); only that session removes it.";

/** The error an attached turn records when it left the shared worktree on another branch. */
export const HARNESS_SESSION_ATTACHED_BRANCH_CHANGED =
  "This session is attached to another session's worktree and may not change its branch.";

/** The message `removeWorktree` is refused with on a host that removes nothing. */
export const HARNESS_SESSION_REMOVE_UNSUPPORTED = "This host's workspace does not remove worktrees.";

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
 * @param inUse Where a turn's hold on its worktree (`occupyWorktree`) is kept
 *   until the turn ends, by request. Only {@link harnessSessionFlow}, which lets
 *   go of each when its turn finishes, passes one; feeds built without it take
 *   no hold, since nothing would let go of it.
 * @param attachedHeads The branch each attached turn started on, by request, for the flow's turn-end check.
 */
export function harnessSessionFeeds(
  kind: string,
  workspace: HarnessSessionWorkspace,
  defaultModel?: string,
  steering: HarnessSteering = harnessSteering(),
  inUse?: Map<string, LockLease>,
  attachedHeads: Map<string, string | null> = new Map(),
): HarnessSessionFeeds {
  return {
    onSteerable: (steer, ctx) => steering.onSteerable(steer, ctx),
    // The person running the turn is the principal, so the window lands in their row.
    onUsage: async (report, ctx) => {
      await recordHarnessUsage(ctx, report);
    },
    model: (ctx) => (ctx.session.state as HarnessSessionState).model ?? defaultModel,
    cwd: async (ctx) => {
      const state = ctx.session.state as HarnessSessionState;
      const requestId = requestOf(ctx);
      const owner = harnessSessionAttachedTo(state.start);
      // Where this turn's changes start: the first time the turn reaches its checkout.
      const recordTurnBase = async (path: string): Promise<void> => {
        if ((ctx.session.state as HarnessSessionState).turns?.[requestId]?.base != null) return;
        const base = await headCommit(path);
        if (base === null) return;
        await changeState(ctx, (current) =>
          withTurn(current, requestId, (turn) => (turn.base == null ? { ...turn, base } : turn)),
        );
      };
      if (owner !== null) {
        // Attached: the owner's worktree as it stands, never made or cut here.
        const path = workspace.locate(workPlaceOf(kind, ctx));
        if (!existsSync(path)) throw new Error(HARNESS_SESSION_ATTACH_MISSING);
        // The owner's place names no user, so whose worktree it is comes from
        // the user's own list: attaching succeeds only on a row in it. A host
        // that keeps no rows can't say, and is refused.
        const worktrees = worktreesOf(ctx);
        const worktree =
          worktrees === undefined || workspace.attach === undefined
            ? null
            : await workspace.attach(workPlaceOf(kind, ctx), { worktrees, by: { kind: "session", id: ctx.session.identity.id } });
        if (worktree === null) throw new Error(HARNESS_SESSION_ATTACH_NOT_YOURS);
        if (inUse !== undefined && !inUse.has(requestId)) inUse.set(requestId, await occupyWorktree(path, { owner: requestId, signal: ctx.signal }));
        // Read once the owner's turn has let go, so it is the branch this turn starts on.
        const branch = await checkedOutBranch(path);
        if (!attachedHeads.has(requestId)) attachedHeads.set(requestId, branch);
        if (state.workspace == null || state.workspace.worktree !== worktree) {
          await changeState(ctx, (current) => ({ ...current, workspace: { worktree } }));
        }
        await recordTurnBase(path);
        return path;
      }
      // Held in use before provisioning, which can move the checkout back to
      // this session's branch, and until the turn ends, so neither an attached
      // session's running turn nor the host's `remove` has it moved under them.
      const located = workspace.locate(workPlaceOf(kind, ctx));
      if (inUse !== undefined && !inUse.has(requestId)) inUse.set(requestId, await occupyWorktree(located, { owner: requestId, signal: ctx.signal }));
      const worktrees = worktreesOf(ctx);
      const title = ctx.session.metadata.title;
      const recordSetup = (setup: HarnessTurnRecord["setup"]) =>
        changeState(ctx, (current) => withTurn(current, requestId, (turn) => ({ ...turn, setup })));
      const provisioned = await workspace.provision(placeOf(kind, ctx), {
        onSetup: () => recordSetup({ state: "running", tail: null }),
        ...(state.start !== undefined ? { start: state.start } : {}),
        ...(worktrees !== undefined
          ? {
              worktrees: {
                collection: worktrees,
                owner: { kind: "session" as const, id: ctx.session.identity.id },
                ...(typeof title === "string" && title.trim() !== "" ? { label: title } : {}),
              },
            }
          : {}),
      });
      const made: HarnessSessionProvisioned = typeof provisioned === "string" ? { path: provisioned } : provisioned;
      if (made.setup !== undefined) {
        await recordSetup(
          made.setup.status === "done" ? { state: "done", tail: null } : { state: "failed", tail: made.setup.tail },
        );
      }
      // Recorded on the first provision, and again once a row is first
      // written; any other hand-back changes nothing.
      const worktree = made.worktree ?? state.workspace?.worktree ?? null;
      if (state.workspace == null || state.workspace.worktree !== worktree) {
        await changeState(ctx, (current) => ({ ...current, workspace: { worktree } }));
      }
      await recordTurnBase(made.path);
      return made.path;
    },
    worktree: (ctx) => workspace.locate(workPlaceOf(kind, ctx)),
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
  // Each running turn's in-use lease on its worktree, by request id; let go when the request ends.
  const inUse = new Map<string, LockLease>();
  // The branch each attached turn started on, by request id: it must end on it.
  const attachedHeads = new Map<string, string | null>();
  const approveTools = options.approveTools === true;
  const deadlines = turnDeadlines(
    assertPositiveInt("harnessSessionFlow's turnTimeoutMs", options.turnTimeoutMs ?? DEFAULT_TURN_TIMEOUT_MS),
  );
  const feeds = harnessSessionFeeds(options.kind, options.workspace, options.defaultModel, steering, inUse, attachedHeads);
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
  // binding is left as it was. A harness stopped at the turn's deadline is
  // recorded as timed out, not stopped, and the turn fails saying so, with
  // the harness's error as its cause.
  const recordTurnFailure = async (error: Error, ctx: BlockContext): Promise<never> => {
    const requestId = ctx.request.identity.id;
    const timedOut = deadlines.takeFired(requestId);
    const ended = timedOut ? new Error(turnTimedOutMessage(deadlines.timeoutMs), { cause: error }) : error;
    await changeState(ctx as unknown as HarnessCallbackContext, (state) =>
      withTurn(state, requestId, (record) => ({
        ...record,
        failure: harnessFailureKind(error),
        stopped: timedOut ? false : ctx.signal.aborted,
        error: ended.message,
        ...(timedOut ? { timedOut: true } : {}),
        ...turnEndOf(ctx, requestId),
      })),
    );
    // A stopped or failed turn still records where its changes end. Never in
    // place of the harness's error: a head that can't be written is left unset.
    await writeTurnHead(ctx as unknown as HarnessCallbackContext).catch(() => undefined);
    throw ended;
  };
  const recordFailure = handler({
    name: "record-turn-failure",
    execute: async (error: Error, ctx): Promise<unknown> => recordTurnFailure(error, ctx),
  });
  // A harness can also report a run it saw end in failure as a result, not a
  // throw. That turn is recorded as failed too, so the page shows its error
  // rather than a continued conversation. The binding is left as it was, so
  // the next turn still continues the same conversation.
  const recordFailedOutcome = handler({
    name: "record-failed-outcome",
    execute: async (handle: HarnessRunHandle, ctx): Promise<void> => {
      const requestId = ctx.request.identity.id;
      // A harness that answered past its deadline rather than failing ended on its own.
      deadlines.takeFired(requestId);
      if (handle.outcome !== "failed") return;
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
      const harnessCtx = ctx as unknown as HarnessCallbackContext;
      const requestId = requestOf(harnessCtx);
      const state = harnessCtx.session.state as HarnessSessionState;
      const place = workPlaceOf(options.kind, harnessCtx);
      // Everything below runs while the turn still holds the worktree, the
      // pull-request check included, so the next turn there (the owner's or an
      // attached session's) can't move the checkout or open a pull request
      // this turn would take for its own.
      try {
        // An attached turn ends on the branch it started on: checked before the
        // worktree is let go, so the owner's next turn can't have moved it yet.
        if (attachedHeads.has(requestId)) {
          const started = attachedHeads.get(requestId) ?? null;
          attachedHeads.delete(requestId);
          const ended = await checkedOutBranch(options.workspace.locate(place));
          if (ended !== started) {
            const error = `${HARNESS_SESSION_ATTACHED_BRANCH_CHANGED} It started on ${started ?? "a detached HEAD"} and ended on ${ended ?? "a detached HEAD"}.`;
            await changeState(harnessCtx, (current) => withTurn(current, requestId, (record) => ({ ...record, error })));
            ctx.emit.status(error, { transient: false });
          }
        }
        // The row's branch and count, read while the turn still holds the
        // worktree, so the owner's next turn can't have moved it yet. A failed
        // read is a note, never a failed turn.
        const worktrees = worktreesOf(ctx);
        if (inUse.has(requestId) && worktrees !== undefined && options.workspace.recordCheckout !== undefined) {
          try {
            await options.workspace.recordCheckout(place, { worktrees, by: { kind: "session", id: harnessCtx.session.identity.id } });
          } catch (error) {
            ctx.emit.status(`The worktree's resource was not updated: ${error instanceof Error ? error.message : String(error)}`, {
              transient: false,
            });
          }
        }
        // A turn that never held the worktree reads nothing there: refused (not
        // this user's to attach to), cancelled while it waited, or one that never
        // asked for a working directory.
        if (!inUse.has(requestId)) return;
        // A turn has a record under its request; a `steer` request has none.
        const turnRecord = state.turns?.[requestId];
        if (turnRecord === undefined) return;
        // The branch the row last read, else the host's name for it.
        const key = (harnessCtx.session.state as HarnessSessionState).workspace?.worktree ?? null;
        const row = key !== null && worktrees !== undefined ? await worktrees.getOptional(key) : undefined;
        const branch = row?.state.branch ?? options.workspace.branch(place);
        if (branch === null) return;
        const cwd = options.workspace.locate(place);
        if (!existsSync(cwd)) return;
        // Only what was opened since the turn began: a branch the agent switched to may hold older pull requests.
        const result = await recordBranchPullRequests(ctx, {
          cwd,
          branches: [branch],
          openedSince: turnRecord.at ?? undefined,
          ...(key !== null && worktrees !== undefined
            ? {
                worktree: {
                  collection: worktrees,
                  key,
                  // The pull request the session started on predates every turn; the row lists it anyway.
                  ...(state.start !== undefined && "pullRequest" in state.start ? { startedOn: state.start.pullRequest } : {}),
                },
              }
            : {}),
        });
        if (result.status === "unavailable") {
          ctx.emit.status(`Pull requests on the session's branch were not checked: ${result.reason}`, { transient: false });
        }
      } finally {
        // The turn is done with its worktree, however it ended.
        const lease = inUse.get(requestId);
        if (lease !== undefined) {
          inUse.delete(requestId);
          releaseLock(lease);
        }
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
    const cwd = options.workspace.locate(workPlaceOf(options.kind, ctx));
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
  // the request's spend is the whole turn. Written inside the turn,
  // not at `onFinished`, so it lands before the request publishes its end and
  // a page that refreshes on that end reads it. A turn that threw records it
  // in `recordFailure`'s write instead. A failed write is a note, never a
  // failed turn.
  const turnSpend = handler({
    name: "turn-spend",
    execute: async (_handle: HarnessRunHandle, ctx): Promise<void> => {
      const requestId = ctx.request.identity.id;
      try {
        await changeState(ctx, (state) => withTurn(state, requestId, (record) => ({ ...record, ...turnEndOf(ctx, requestId) })));
      } catch (error) {
        ctx.emit.status(`What the turn spent was not recorded: ${(error as Error).message}`, { transient: false });
      }
    },
  });
  // Only effects no page reads on the turn's end: anything a page shows then is written inside the turn.
  // A turn whose record never ended: stopped while it waited on an approval,
  // which the engine ends before any of the turn's own steps run again. Its
  // record ends here, stopped, with what its runs spent and where its changes
  // end. Every other turn ended its record inside the turn.
  const endUnendedTurn = handler({
    name: "end-unended-turn",
    execute: async (_input: unknown, ctx): Promise<void> => {
      const harnessCtx = ctx as unknown as HarnessCallbackContext;
      const requestId = requestOf(harnessCtx);
      const record = (harnessCtx.session.state as HarnessSessionState).turns?.[requestId];
      // Only a turn that can wait on an approval reaches its end unended this way.
      if (!approveTools || record === undefined || record.endedAt != null) return;
      await changeState(harnessCtx, (state) =>
        withTurn(state, requestId, (turn) => ({ ...turn, stopped: true, waitsOnApproval: null, ...turnEndOf(ctx, requestId) })),
      );
      await writeTurnHead(harnessCtx).catch(() => undefined);
    },
  });
  const turnEnd = sequencer({ name: "turn-end", inputSchema: z.unknown() }).tap(endUnendedTurn).tap(branchPullRequests);
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
      const cwd = options.workspace.locate(workPlaceOf(options.kind, harnessCtx));
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
      const place = workPlaceOf(options.kind, harnessCtx);
      const cwd = options.workspace.locate(place);
      if (!existsSync(cwd)) return;
      const checks = await runCommandChecks(verify, cwd, { place, cwd }, ctx.signal);
      if (checks.length === 0) return;
      const requestId = ctx.request.identity.id;
      await changeState(ctx, (state) => withTurn(state, requestId, (record) => ({ ...record, checks })));
    },
  });
  // The session's worktree, removed through the host's one removal path. A
  // turn holds the session while it runs, so this is refused then (`reject`).
  const removeWorktree = handler({
    name: "remove-worktree",
    inputSchema: z.object({ deleteBranch: z.boolean().default(false), force: z.boolean().default(false) }),
    execute: async (input, ctx): Promise<{ removed: true; branchDeleted: boolean }> => {
      const harnessCtx = ctx as unknown as HarnessCallbackContext;
      const state = harnessCtx.session.state as HarnessSessionState;
      // An attached session never owns its worktree; only the owner removes it.
      if (harnessSessionAttachedTo(state.start) !== null) {
        throw new Error(HARNESS_SESSION_REMOVE_NOT_OWNER);
      }
      if (options.workspace.remove === undefined) {
        throw new Error(HARNESS_SESSION_REMOVE_UNSUPPORTED);
      }
      const worktrees = worktreesOf(ctx);
      const { branchDeleted } = await options.workspace.remove(placeOf(options.kind, harnessCtx), {
        deleteBranch: input.deleteBranch,
        force: input.force,
        ...(worktrees !== undefined ? { worktrees } : {}),
      });
      // The row says it was removed (the host marks it); the session's pointer stays.
      return { removed: true, branchDeleted };
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
  // The brief provisions the checkout, so a failure there is the turn's
  // failure too, recorded the way the harness's own is.
  const brief = withIssueSpec?.rescue([{ block: recordFailure }]);
  // FIX-2519. The person's files, handed to the harness beside the prompt, in
  // reference form: the harness reads their bytes itself. A harness that
  // declares what it takes refuses any other type itself, by name, before its
  // run starts; one that declares nothing is never handed a file. Either
  // refusal is the turn's failure, recorded the way the harness's own is.
  const turnFiles = handler({
    name: "turn-files",
    inputSchema: z.object({ prompt: z.string().min(1) }),
    execute: async (input, ctx): Promise<HarnessRunInput> => {
      const attachments = ctx.request.attachments;
      if (attachments.length === 0) return { prompt: input.prompt };
      if (agent.accepts === undefined) refuseUnacceptedAttachments("This session's harness", undefined, attachments);
      return { prompt: input.prompt, attachments: [...attachments] };
    },
  }).rescue([{ block: recordFailure }]);
  // The harness step, with its approval loop when `approveTools` is on; the
  // turn's records come after it either way.
  const opened = sequencer({
    name: "turn",
    description: "One turn of a harness session: the prompt, run by the harness where the session works.",
    inputSchema: z.object({ prompt: z.string().min(1) }),
  }).tap(titleFromPrompt);
  const harnessTurn = approveTools
    ? approvals.turn({ agent, titleFromPrompt, recordTurnFailure, brief, turnFiles, deadlines })
    : (brief === undefined ? opened : opened.step(brief))
        .step(turnFiles)
        .step(agent.rescue([{ block: recordFailure }]), {
          abortSignal: (ctx) => deadlines.arm(ctx),
          onSettled: (ctx) => deadlines.clear(ctx),
        });
  const turn = harnessTurn
    .tap(recordFailedOutcome)
    .tap(turnSpend)
    .tap(recordTurnHead)
    .tap(verifyTurn);

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
      removeWorktree: { block: removeWorktree, concurrency: "reject" },
    },
    views: { changes: defineView({ scope: "session", block: changes, description: "What one turn's commits changed: its files and lines, or one file's patch." }) },
    request: { onFinished: turnEnd },
    // The user's worktree rows: the host writes them through this flow's
    // workspace, and every session and agent of the user reads them.
    resources: { [WORKTREES]: worktreesCollection },
    // The model may read the rows through core's resource tools, never write
    // them: only the workspace host writes a row.
    resourceVisibility: (_ctx, resource) => (resource.name === WORKTREES ? "read-only" : "visible"),
    session: {
      stateSchema: harnessSessionStateSchema,
      // The page reads the model, the issue, the start, the binding, the
      // turns and the workspace. The model, issue and start are the creator's
      // to name, once; nothing a caller sends writes the rest.
      client: { expose: ["model", "issue", "start", "binding", "turns", "workspace"] },
      serverOwned: ["binding", "turns", "workspace"],
      // Every path that creates a session asks this: a new session runs a
      // named model, a start it names is one the flow can honour, and an
      // issue it names is a tracker key (it becomes a path segment and a
      // branch name).
      createCheck: ({ state, principal, sessionId }) => {
        if (typeof state.model !== "string" || state.model === "") return { ok: false, message: HARNESS_SESSION_MODEL_REQUIRED };
        const start = harnessSessionStartSchema.safeParse(state.start);
        if (state.start !== undefined && !start.success) {
          return { ok: false, message: HARNESS_SESSION_START_INVALID };
        }
        if (state.issue !== undefined && !isTrackerIssue(state.issue)) return { ok: false, message: HARNESS_SESSION_ISSUE_REFUSED };
        // An attaching session names a worktree that is there now, in this tenant.
        const owner = harnessSessionAttachedTo(start.success ? start.data : undefined);
        if (owner !== null) {
          const ownerPlace: HarnessSessionPlace = {
            flowKind: options.kind,
            sessionId: owner,
            ...(principal.tenantId !== undefined ? { tenantId: principal.tenantId } : {}),
          };
          if (owner === sessionId || !existsSync(options.workspace.locate(ownerPlace))) {
            return { ok: false, message: HARNESS_SESSION_ATTACH_MISSING, status: 404 };
          }
        }
        return { ok: true };
      },
    },
  })();
}

/**
 * What a turn's record gets when its harness step ends: what it spent, and
 * when. The spend is the request's whole count, not what is left to hand on:
 * a turn suspended, interrupted or continued spent what its earlier runs did
 * too, and a replayed write reads the same number again.
 */
function turnEndOf(ctx: object, requestId: string): { spend: TaskSpendView | null; endedAt: number } {
  const total = readRequestTotalSpend(ctx);
  const spend = total === undefined ? null : requestSpendView(total, requestId);
  return { spend, endedAt: Date.now() };
}


/** The default bound on one harness run of a turn. */
const DEFAULT_TURN_TIMEOUT_MS = 60 * 60_000;

/** The error a turn whose harness ran past its deadline ends with. */
function turnTimedOutMessage(timeoutMs: number): string {
  return `[harness-session] the turn's harness timed out after ${timeoutMs}ms and was stopped.`;
}

// FIX-2680.
/**
 * Each running harness step's deadline, by request: an abort the step runs
 * under (composed with any other stop it has), whose timer is cleared when the
 * step settles, and a note of each request whose deadline fired, read once by
 * the turn's failure record.
 */
function turnDeadlines(timeoutMs: number) {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const fired = new Set<string>();
  return {
    timeoutMs,
    /** The step's deadline signal: aborts `timeoutMs` from now unless the step settles first. */
    arm(ctx: BlockContext): AbortSignal {
      const requestId = ctx.request.identity.id;
      const controller = new AbortController();
      clearTimeout(timers.get(requestId));
      const timer = setTimeout(() => {
        fired.add(requestId);
        controller.abort(new Error(turnTimedOutMessage(timeoutMs)));
      }, timeoutMs);
      // A deadline never holds a host's process open on its own.
      timer.unref?.();
      timers.set(requestId, timer);
      return controller.signal;
    },
    /** The step settled: its deadline goes. */
    clear(ctx: BlockContext): void {
      const requestId = ctx.request.identity.id;
      clearTimeout(timers.get(requestId));
      timers.delete(requestId);
    },
    /** Whether the request's deadline fired, forgetting it: asked once per turn end. */
    takeFired(requestId: string): boolean {
      return fired.delete(requestId);
    },
  };
}
type TurnDeadlines = ReturnType<typeof turnDeadlines>;

// FIX-2432.
/**
 * A turn's tool approvals, on the turn's sequencer state so a
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

/**
 * The message a turn is refused with while another turn of its session waits
 * on a tool approval. The wait gives back the session's turn slot, and a turn
 * run then would work in the checkout and conversation the waiting one resumes.
 */
export const HARNESS_SESSION_TURN_WAITS_ON_APPROVAL =
  "Another turn of this session is waiting for an answer about a tool call. Answer or stop that turn, then send this one.";

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
      const call = heldToolCallOf(request, workspace.locate(workPlaceOf(kind, ctx)));
      const { grants } = turnApprovalsOf(ctx);
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
      brief,
      turnFiles,
      deadlines,
    }: {
      agent: HarnessBlock;
      titleFromPrompt: ReturnType<typeof handler>;
      recordTurnFailure: (error: Error, ctx: BlockContext) => Promise<never>;
      /** The issue-spec brief, run once ahead of the harness step (never on a loop back). */
      brief?: ReturnType<ReturnType<typeof handler>["rescue"]>;
      /** The person's files onto the run's input, once ahead of the harness step: a loop back continues a conversation that has them. */
      turnFiles: ReturnType<ReturnType<typeof handler>["rescue"]>;
      /** Each harness step's deadline, composed with its approval stop. */
      deadlines: TurnDeadlines;
    }) {
      // Refused before the harness runs: a held call waits as a durable stop.
      const requireDurable = handler({
        name: `${kind}-approvals-need-durable`,
        execute: async (_input: unknown, ctx) => {
          if (requestHostOf(ctx)?.resumeWait === undefined) {
            throw new Error(HARNESS_SESSION_APPROVALS_NEED_DURABLE);
          }
        },
      });
      // Refused while another turn waits on an approval: the wait gives back
      // the session's turn slot, so `concurrency: "defer"` no longer holds this
      // one back, and it would run in the checkout and conversation that turn resumes.
      const oneTurnAtATime = handler({
        name: `${kind}-one-turn-at-a-time`,
        execute: async (_input: unknown, ctx) => {
          const requestId = ctx.request.identity.id;
          const turns = (ctx.session.state as HarnessSessionState).turns ?? {};
          const waiting = Object.entries(turns).some(
            ([id, turn]) => id !== requestId && turn.waitsOnApproval === true && turn.endedAt == null,
          );
          if (waiting) throw new Error(HARNESS_SESSION_TURN_WAITS_ON_APPROVAL);
        },
      });
      // The harness step, with its own stop: a step stopped for an approval
      // ends with a marker, not an error, so the turn goes on to the wait.
      // Any other failure is the turn's, recorded as without approvals. The
      // turn's deadline runs beside the stop, never in place of it.
      const harnessStep = sequencer({
        name: `${kind}-harness-step`,
        inputSchema: z.object({ prompt: z.string() }).passthrough(),
      })
        .step(agent, {
          abortSignal: (ctx) => {
            const controller = new AbortController();
            stops.set(ctx.request.identity.id, controller);
            return AbortSignal.any([controller.signal, deadlines.arm(ctx)]);
          },
          onSettled: (ctx) => {
            stops.delete(ctx.request.identity.id);
            deadlines.clear(ctx);
          },
        })
        .rescue([
          {
            block: handler({
              name: `${kind}-stopped-for-approval`,
              inputSchema: z.unknown(),
              outputSchema: z.unknown(),
              execute: async (error: unknown, ctx) => {
                if (heldCalls.has(ctx.request.identity.id)) {
                  // Stopped for the call: the step's deadline, had it fired too, is moot.
                  deadlines.takeFired(ctx.request.identity.id);
                  return STOPPED_FOR_APPROVAL;
                }
                return recordTurnFailure(error as Error, ctx);
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
          const approvals = turnApprovalsOf(ctx);
          const grants = approvals.grants.filter((_, at) => spent?.has(at) !== true);
          if (held === undefined && grants.length === approvals.grants.length) return value;
          if (held !== undefined) {
            // On the turn's record, so a turn sent while this one waits is refused.
            await changeState(ctx as unknown as HarnessCallbackContext, (state) =>
              withTurn(state, requestId, (record) => ({ ...record, waitsOnApproval: true })),
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
          const approvals = turnApprovalsOf(ctx);
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
              ctx,
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
              ctx,
            );
          }
          const asked = await ctx.suspendForUser(toolApprovalStop(call));
          // Answered (or cancelled), the turn holds the session's turn slot again.
          await changeState(ctx as unknown as HarnessCallbackContext, (state) =>
            withTurn(state, ctx.request.identity.id, (record) => ({ ...record, waitsOnApproval: null })),
          );
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
      const opened = sequencer({
        name: "turn",
        description: "One turn of a harness session: the prompt, run by the harness where the session works.",
        inputSchema: z.object({ prompt: z.string().min(1) }),
        stateSchema: turnApprovalsSchema,
      })
        .tap(requireDurable)
        .tap(oneTurnAtATime)
        .tap(titleFromPrompt);
      return (brief === undefined ? opened : opened.step(brief))
        .step(turnFiles)
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
