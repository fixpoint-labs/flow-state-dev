/**
 * One session flow for every coding harness mode: a flow kind, and a function
 * that builds the harness block from the feeds this flow owns.
 *
 * Server only. Kitchen Sink decides three things for a run and the harness
 * decides everything else:
 *
 * - **Where it works** (`cwd`): the session's own git worktree of the
 *   repository (`lib/harness-worktree.ts`), from the one reader of the host
 *   setting (`lib/harness-workspace.ts`).
 * - **Which conversation it continues** (`resume`, `onSession`): the one the
 *   harness last confirmed for this session. `onSession` is the only writer of
 *   that id. A failure never clears it, so a conversation the harness won't
 *   continue keeps failing visibly until the person starts a new session,
 *   rather than the session moving on by itself.
 * - **Which model it runs** (`model`): the one the person picked when the
 *   session was born, held in a session field the framework fixes at birth.
 *   The flow refuses to create a session that names none. Kitchen Sink does
 *   not check the id: the harness judges what it runs, and a refusal reaches
 *   the person in the harness's words.
 *
 * A line sent while a turn runs goes to the `steer` action. A run that can
 * take a line into its turn in flight offers that through `onSteerable`;
 * `steer` hands it the line and answers whether it took it. When it didn't,
 * the page sends the line as the next `turn` (`lib/harness-line.ts`).
 *
 * Each turn also gets a record under its request id: what it asked for, what
 * the harness confirmed during it, and how it failed, read through core's
 * neutral `harnessFailureKind` and never a harness's message. The page derives
 * its notice from that record (`lib/harness-turn.ts`).
 *
 * The harness records each pull request its run opens, in core's record. When
 * a turn ends, however it ended, the flow also asks GitHub which pull requests
 * the session's branches have (`@flow-state-dev/workspace`'s
 * `recordBranchPullRequests`), and adds what the turn's tool calls did not
 * show: one opened by a raw API call, say.
 *
 * Nothing here names a harness. A harness that needs more than these feeds has
 * found a gap in its own package. Kitchen Sink writes no item of its own.
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
import { recordBranchPullRequests } from "@flow-state-dev/workspace";
import { withOutcome } from "@flow-state-dev/core/helpers";
import type {
  HarnessCallbackContext,
  HarnessRunHandle,
  HarnessResolver,
  HarnessBlock,
  HarnessSessionHook,
  HarnessSteerHook,
} from "@flow-state-dev/core/types";
import { z } from "zod";

import { goalControl } from "./goal-control";
import { readHarnessWorkspace } from "./harness-workspace";
import { locateSessionWorktree, provisionSessionWorktree, sessionBranch, type SessionPlace } from "./harness-worktree";
import { harnessSessionStateSchema, type HarnessSessionState, type TurnRecord } from "./harness-turn";

/** A harness block: takes the prompt, returns the run's handle. Core's neutral shape. */
export type { HarnessBlock };

/** What the session flow hands a harness block. Spread all but `worktree` into its options. */
export interface HarnessFeeds {
  /** The session's worktree, provisioned on the first turn and handed back after. */
  readonly cwd: HarnessResolver<string>;
  /** The conversation the session is bound to, or `null` on its first turn. */
  readonly resume: HarnessResolver<string | null>;
  /** Records the conversation the harness confirmed. */
  readonly onSession: HarnessSessionHook;
  /**
   * The model this run uses: the session's pick, or the mode's default for a
   * session stored before models could be picked. `undefined` leaves the
   * harness on its own default.
   */
  readonly model: HarnessResolver<string | undefined>;
  /**
   * Where the session's worktree is, for a fence that names it (a sandbox's
   * writable paths). Its real path once `cwd` has provisioned it.
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
  /** The flow kind, one per harness mode (`claude-code-session`). */
  readonly kind: string;
  /** Build the harness block from the feeds. */
  readonly agent: (feeds: HarnessFeeds) => HarnessBlock;
  /**
   * The model a session with none runs on (one stored before models could be
   * picked), and the one the `ignore-model` goal control hands the harness.
   * Unset, the harness runs its own default in both cases.
   */
  readonly defaultModel?: string;
}

/** How many turn records a session keeps. The notice reads only the latest. */
const KEPT_TURNS = 20;

/** The turn's record key: the framework's request id, never anything the caller sent. */
function requestOf(ctx: HarnessCallbackContext): string {
  return ctx.request.identity.id;
}

/** The session's place: its flow kind, tenant and id, as the framework names them. */
function placeOf(kind: string, ctx: HarnessCallbackContext): SessionPlace {
  const identity = ctx.session.identity;
  return {
    flowKind: kind,
    sessionId: identity.id,
    ...(identity.tenantId !== undefined ? { tenantId: identity.tenantId } : {}),
  };
}

/** The repository harness sessions work on. The flow is registered only while there is one. */
function repository(): string {
  const workspace = readHarnessWorkspace();
  if (!workspace.ok) throw new Error(workspace.reason);
  return workspace.repository;
}

const BLANK_TURN: TurnRecord = {
  asked: null,
  confirmed: null,
  failure: null,
  stopped: null,
  error: null,
  at: null,
  steered: null,
};

/** `state` with the turn `requestId` changed by `change`, keeping only the latest {@link KEPT_TURNS}. */
function withTurn(state: HarnessSessionState, requestId: string, change: (turn: TurnRecord) => TurnRecord): HarnessSessionState {
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
export const FAILED_OUTCOME_ERROR = "The harness reported the run as failed.";

/** The harness's own words for a failed run: its handle's `failureMessage`, when it has one. */
function failureWordsOf(handle: HarnessRunHandle): string {
  const words = (handle as { failureMessage?: unknown }).failureMessage;
  return typeof words === "string" && words.trim() !== "" ? words : FAILED_OUTCOME_ERROR;
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
export function titleOf(prompt: string): string {
  const line = (prompt.split("\n").find((l) => l.trim() !== "") ?? "").replace(/\s+/g, " ").trim();
  return line.length <= TITLE_LENGTH ? line : `${line.slice(0, TITLE_LENGTH - 1).trimEnd()}…`;
}

/** The message a create without a model is refused with. */
export const MODEL_REQUIRED = "A new session must name the model it runs (`state.model`).";

/**
 * The feeds for one flow kind.
 *
 * @param kind The flow kind.
 * @param defaultModel What {@link HarnessSessionFlowOptions.defaultModel} says.
 * @param steering The flow's steering, which holds a running turn's offer for its `steer` action.
 */
export function harnessFeeds(kind: string, defaultModel?: string, steering: HarnessSteering = harnessSteering()): HarnessFeeds {
  return {
    // Never holds an offer under the control, so goal legs **k** and **w** can be seen to fail.
    onSteerable: (steer, ctx) => steering.onSteerable(goalControl() === "no-live-steer" ? null : steer, ctx),
    model: (ctx) => {
      // Hands the harness the mode's default whatever was picked, so the goal's
      // "the harness ran the picked model" leg can be seen to fail.
      if (goalControl() === "ignore-model") return defaultModel;
      return (ctx.session.state as HarnessSessionState).model ?? defaultModel;
    },
    cwd: async (ctx) => {
      const repo = repository();
      // Hands the run the repository itself, so goal leg **w** can be seen to fail.
      if (goalControl() === "main-checkout") return repo;
      return (await provisionSessionWorktree(repo, placeOf(kind, ctx))).path;
    },
    worktree: (ctx) => {
      const repo = repository();
      if (goalControl() === "main-checkout") return repo;
      return locateSessionWorktree(repo, placeOf(kind, ctx));
    },
    resume: async (ctx) => {
      const requestId = requestOf(ctx);
      // Hands back nothing, so goal legs **c** and **s** can be seen to fail.
      const cut = goalControl() === "no-resume";
      return (
        (await withOutcome(
          (mutator: (state: HarnessSessionState) => HarnessSessionState) =>
            ctx.session.atomicState((state) => mutator(state as HarnessSessionState)),
          (state) => {
            const asked = cut ? null : (state.binding?.confirmed ?? null);
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
 * Build a harness mode's session flow.
 *
 * `turn` takes the prompt. A turn sent while another runs waits for it
 * (`concurrency: "queue"`), then continues the same conversation. `steer`
 * takes a line for the turn running now: `{ taken: true }` when the harness
 * took it into that turn, else `{ taken: false }` and nothing was sent. `live`
 * says whether the running turn offered to take one at all.
 */
export function harnessSessionFlow(options: HarnessSessionFlowOptions) {
  const steering = harnessSteering();
  const agent = options.agent(harnessFeeds(options.kind, options.defaultModel, steering));
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
  // The rail lists sessions by title, so a session is titled by its first
  // prompt before the harness runs. Later turns leave the title alone. A title
  // is cosmetic: failing to write one never fails the turn.
  const titleFromPrompt = handler({
    name: "title-from-prompt",
    inputSchema: z.object({ prompt: z.string().min(1) }),
    execute: async (input, ctx): Promise<void> => {
      if (ctx.session.metadata.title != null && ctx.session.metadata.title.trim() !== "") return;
      const title = titleOf(input.prompt);
      if (title === "") return;
      try {
        await ctx.session.setMetadata({ title });
      } catch {
        // Retried on the next turn, which finds the session still untitled.
      }
    },
  });
  // When a turn ends, however it ended: the pull requests on the session's
  // branches, added where the record lacks them. The current branch of the
  // worktree and the one Kitchen Sink made, since an agent may have moved. Its
  // own timeout, not the turn's abort signal, so a stopped turn is checked too.
  // A missing or signed-out `gh` is a note, never a failed turn.
  const branchPullRequests = handler({
    name: "branch-pull-requests",
    resources: { [OBSERVED_PULL_REQUESTS]: observedPullRequestsCollection },
    execute: async (_input: unknown, ctx): Promise<void> => {
      // Leaves the turn-end check out, so goal leg **b** can be seen to fail.
      if (goalControl() === "no-backstop") return;
      // A turn has a record under its request; a `steer` request has none.
      const harnessCtx = ctx as unknown as HarnessCallbackContext;
      const turnRecord = (harnessCtx.session.state as HarnessSessionState).turns?.[requestOf(harnessCtx)];
      if (turnRecord === undefined) return;
      const workspace = readHarnessWorkspace();
      if (!workspace.ok) return;
      const place = placeOf(options.kind, harnessCtx);
      const cwd = locateSessionWorktree(workspace.repository, place);
      if (!existsSync(cwd)) return;
      // Only what was opened since the turn began: a branch the agent switched to may hold older pull requests.
      const result = await recordBranchPullRequests(ctx, { cwd, branches: [sessionBranch(place)], openedSince: turnRecord.at ?? undefined });
      if (result.status === "unavailable") {
        ctx.emit.status(`Pull requests on the session's branch were not checked: ${result.reason}`, { transient: false });
      }
    },
  });
  const turn = sequencer({
    name: "turn",
    description: "One turn of a harness session: the prompt, run by the harness in the session's worktree.",
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
        concurrency: "queue",
      },
      steer,
    },
    request: { onFinished: branchPullRequests },
    session: {
      stateSchema: harnessSessionStateSchema,
      // The page reads the model, the binding and the turns. The model is the
      // creator's to name, once; nothing a caller sends writes the other two.
      client: { expose: ["model", "binding", "turns"] },
      serverOwned: ["binding", "turns"],
      // Every path that creates a session asks this: a new session runs a named model.
      createCheck: ({ state }) =>
        typeof state.model === "string" && state.model !== "" ? { ok: true } : { ok: false, message: MODEL_REQUIRED },
    },
  })();
}
