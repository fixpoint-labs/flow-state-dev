/**
 * One session flow for every coding harness mode: a flow kind, and a function
 * that builds the harness block from the feeds this flow owns.
 *
 * Server only. Kitchen Sink decides two things for a run and the harness
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
 *
 * Each turn also gets a record under its request id: what it asked for, what
 * the harness confirmed during it, and how it failed, read through core's
 * neutral `harnessFailureKind` and never a harness's message. The page derives
 * its notice from that record (`lib/harness-turn.ts`).
 *
 * Nothing here names a harness. A harness that needs more than these feeds has
 * found a gap in its own package. Kitchen Sink writes no item of its own.
 */
import { defineFlow, handler, harnessFailureKind, sequencer, type harnessRunInputSchema } from "@flow-state-dev/core";
import { withOutcome } from "@flow-state-dev/core/helpers";
import type {
  BlockDefinition,
  HarnessCallbackContext,
  HarnessResolver,
  HarnessRunHandle,
  HarnessSessionHook,
} from "@flow-state-dev/core/types";
import { z } from "zod";

import { goalControl } from "./goal-control";
import { readHarnessWorkspace } from "./harness-workspace";
import { locateSessionWorktree, provisionSessionWorktree, type SessionPlace } from "./harness-worktree";
import { harnessSessionStateSchema, type HarnessSessionState, type TurnRecord } from "./harness-turn";

/** A harness block: takes the prompt, returns the run's handle. */
export type HarnessBlock = BlockDefinition<
  typeof harnessRunInputSchema,
  z.ZodType<HarnessRunHandle, z.ZodTypeDef, unknown>
>;

/** What the session flow hands a harness block. Spread the first three into its options. */
export interface HarnessFeeds {
  /** The session's worktree, provisioned on the first turn and handed back after. */
  readonly cwd: HarnessResolver<string>;
  /** The conversation the session is bound to, or `null` on its first turn. */
  readonly resume: HarnessResolver<string | null>;
  /** Records the conversation the harness confirmed. */
  readonly onSession: HarnessSessionHook;
  /**
   * Where the session's worktree is, for a fence that names it (a sandbox's
   * writable paths). Its real path once `cwd` has provisioned it.
   */
  readonly worktree: HarnessResolver<string>;
}

/** Options for {@link harnessSessionFlow}. */
export interface HarnessSessionFlowOptions {
  /** The flow kind, one per harness mode (`claude-code-session`). */
  readonly kind: string;
  /** Build the harness block from the feeds. */
  readonly agent: (feeds: HarnessFeeds) => HarnessBlock;
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

const BLANK_TURN: TurnRecord = { asked: null, confirmed: null, failure: null, stopped: null, error: null, at: null };

/** `state` with the turn `requestId` changed by `change`, keeping only the latest {@link KEPT_TURNS}. */
function withTurn(state: HarnessSessionState, requestId: string, change: (turn: TurnRecord) => TurnRecord): HarnessSessionState {
  const turns = { ...(state.turns ?? {}) };
  turns[requestId] = change(turns[requestId] ?? { ...BLANK_TURN, at: Date.now() });
  const kept = Object.entries(turns)
    .sort(([, a], [, b]) => (b.at ?? 0) - (a.at ?? 0))
    .slice(0, KEPT_TURNS);
  return { ...state, turns: Object.fromEntries(kept) };
}

/** Change the session's state atomically. */
async function changeState(
  ctx: HarnessCallbackContext,
  change: (state: HarnessSessionState) => HarnessSessionState,
): Promise<void> {
  await ctx.session.atomicState((state) => change(state as HarnessSessionState));
}

/** The feeds for one flow kind. */
export function harnessFeeds(kind: string): HarnessFeeds {
  return {
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
 * One action, `turn`, taking the prompt. A turn sent while another runs waits
 * for it (`concurrency: "queue"`), then continues the same conversation.
 */
export function harnessSessionFlow(options: HarnessSessionFlowOptions) {
  const agent = options.agent(harnessFeeds(options.kind));
  // A failure is recorded on the turn, classified by the harness, so the page
  // can tell a refused conversation from any other error and from a stop. The
  // turn still fails with the harness's own error, rethrown here, and the
  // binding is left as it was.
  const recordFailure = handler({
    name: "record-turn-failure",
    execute: async (error: Error, ctx): Promise<unknown> => {
      const requestId = ctx.request.identity.id;
      await changeState(ctx as unknown as HarnessCallbackContext, (state) =>
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
  const turn = sequencer({
    name: "turn",
    description: "One turn of a harness session: the prompt, run by the harness in the session's worktree.",
    inputSchema: z.object({ prompt: z.string().min(1) }),
  }).step(agent.rescue([{ block: recordFailure }]));

  return defineFlow({
    kind: options.kind,
    requireUser: true,
    actions: {
      turn: {
        block: turn,
        userMessage: (input: { prompt: string }) => input.prompt,
        concurrency: "queue",
      },
    },
    session: {
      stateSchema: harnessSessionStateSchema,
      // The page reads the binding and the turns; nothing a caller sends writes them.
      client: { expose: ["binding", "turns"] },
      serverOwned: ["binding", "turns"],
    },
  })();
}
