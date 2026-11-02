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
import {
  checkedOutBranch,
  occupyWorktree,
  pullRequestHead,
  recordBranchPullRequests,
  releaseLock,
  WORKTREES,
  worktreesCollection,
  type LockLease,
  type PlaceSetup,
  type WorktreeCollection,
  type WorktreeOwner,
  type WorktreeRecording,
} from "@flow-state-dev/workspace";
import { z } from "zod";

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

/**
 * Where a session works: a pointer to its worktree's row in the user's list
 * (`worktreesCollection`), which owns the path, branch, base, commit count,
 * owner and state. Nothing of the worktree is copied here, so the row is the
 * one owner. A record stored before this shape held copies of the path and
 * branch; they are dropped on read (BP-030).
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
    model: (ctx) => (ctx.session.state as HarnessSessionState).model ?? defaultModel,
    cwd: async (ctx) => {
      const state = ctx.session.state as HarnessSessionState;
      const requestId = requestOf(ctx);
      const owner = harnessSessionAttachedTo(state.start);
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
  const steering = harnessSteering();
  // Each running turn's in-use lease on its worktree, by request id; let go when the request ends.
  const inUse = new Map<string, LockLease>();
  // The branch each attached turn started on, by request id: it must end on it.
  const attachedHeads = new Map<string, string | null>();
  const agent = options.agent(
    harnessSessionFeeds(options.kind, options.workspace, options.defaultModel, steering, inUse, attachedHeads),
  );
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
            ctx.emit.status(`The worktree's row was not updated: ${error instanceof Error ? error.message : String(error)}`, {
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
  const turn = sequencer({
    name: "turn",
    description: "One turn of a harness session: the prompt, run by the harness where the session works.",
    inputSchema: z.object({ prompt: z.string().min(1) }),
  })
    .tap(titleFromPrompt)
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
      removeWorktree: { block: removeWorktree, concurrency: "reject" },
    },
    request: { onFinished: branchPullRequests },
    // The user's worktree rows: the host writes them through this flow's
    // workspace, and every session and agent of the user reads them.
    resources: { [WORKTREES]: worktreesCollection },
    // The model may read the rows through core's resource tools, never write
    // them: only the workspace host writes a row.
    resourceVisibility: (_ctx, resource) => (resource.name === WORKTREES ? "read-only" : "visible"),
    session: {
      stateSchema: harnessSessionStateSchema,
      // The page reads the model, the binding and the turns. The model is the
      // creator's to name, once; nothing a caller sends writes the other two.
      client: { expose: ["model", "start", "binding", "turns", "workspace"] },
      serverOwned: ["binding", "turns", "workspace"],
      // Every path that creates a session asks this: a new session runs a
      // named model, and a start it names is one the flow can honour.
      createCheck: ({ state, principal, sessionId }) => {
        if (typeof state.model !== "string" || state.model === "") return { ok: false, message: HARNESS_SESSION_MODEL_REQUIRED };
        const start = harnessSessionStartSchema.safeParse(state.start);
        if (state.start !== undefined && !start.success) {
          return { ok: false, message: HARNESS_SESSION_START_INVALID };
        }
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
