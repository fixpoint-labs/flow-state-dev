/**
 * Kitchen Sink's wiring of `@flow-state-dev/harness-manager`'s harness
 * session flow, which every coding harness mode uses.
 *
 * Server only. Kitchen Sink supplies two things and the package does the rest:
 *
 * - **Where a session works**: its own git worktree of the repository
 *   (`lib/harness-worktree.ts`), from the one reader of the host setting
 *   (`lib/harness-workspace.ts`).
 * - **Its goal controls** (`lib/goal-control.ts`): each swaps one feed for a
 *   broken stand-in, so a goal leg can be seen to fail. Read only in a
 *   test-mode build.
 *
 * Nothing here names a harness. A mode supplies only its block.
 */
import {
  harnessSessionFeeds,
  harnessSessionFlow,
  type HarnessSessionFeeds,
  type HarnessSessionWorkspace,
} from "@flow-state-dev/harness-manager";
import type { HarnessBlock } from "@flow-state-dev/core/types";

import { goalControl } from "./goal-control";
import { readHarnessWorkspace } from "./harness-workspace";
import { locateSessionWorktree, provisionSessionWorktree, sessionBranch } from "./harness-worktree";

/** The repository harness sessions work on. The flow is registered only while there is one. */
function repository(): string {
  const workspace = readHarnessWorkspace();
  if (!workspace.ok) throw new Error(workspace.reason);
  return workspace.repository;
}

/** Each session's own worktree of the repository, on its own branch. */
const workspace: HarnessSessionWorkspace = {
  provision: async (place) => (await provisionSessionWorktree(repository(), place)).path,
  locate: (place) => locateSessionWorktree(repository(), place),
  // No branch leaves the turn-end check out, so goal leg **b** can be seen to fail.
  branch: (place) => (goalControl() === "no-backstop" || !readHarnessWorkspace().ok ? null : sessionBranch(place)),
};

/** `feeds` with the goal control in force applied. */
function withGoalControls(feeds: HarnessSessionFeeds, defaultModel: string | undefined): HarnessSessionFeeds {
  return {
    ...feeds,
    // Never holds an offer under the control, so goal legs **k** and **w** can be seen to fail.
    onSteerable: (steer, ctx) => feeds.onSteerable(goalControl() === "no-live-steer" ? null : steer, ctx),
    // Hands the harness the mode's default whatever was picked, so the goal's
    // "the harness ran the picked model" leg can be seen to fail.
    model: (ctx) => (goalControl() === "ignore-model" ? defaultModel : feeds.model(ctx)),
    // Hands the run the repository itself, so goal leg **w** can be seen to fail.
    cwd: (ctx) => (goalControl() === "main-checkout" ? repository() : feeds.cwd(ctx)),
    worktree: (ctx) => (goalControl() === "main-checkout" ? repository() : feeds.worktree(ctx)),
    // Hands back nothing, so goal legs **c** and **s** can be seen to fail.
    resume: async (ctx) => {
      const asked = await feeds.resume(ctx);
      return goalControl() === "no-resume" ? null : asked;
    },
  };
}

/** The feeds a mode's block gets, for a test that reads the block's options. */
export function kitchenSinkHarnessFeeds(kind: string, defaultModel?: string): HarnessSessionFeeds {
  return withGoalControls(harnessSessionFeeds(kind, workspace, defaultModel), defaultModel);
}

/** Options for {@link kitchenSinkHarnessFlow}. */
export interface KitchenSinkHarnessFlowOptions {
  /** The flow kind, one per harness mode (`claude-code-session`). */
  readonly kind: string;
  /** Build the harness block from the feeds. */
  readonly agent: (feeds: HarnessSessionFeeds) => HarnessBlock;
  /**
   * The model a session with none runs on, and the one the `ignore-model`
   * goal control hands the harness. Unset, the harness runs its own default.
   */
  readonly defaultModel?: string;
}

/** A harness mode's session flow. */
export function kitchenSinkHarnessFlow(options: KitchenSinkHarnessFlowOptions) {
  return harnessSessionFlow({
    kind: options.kind,
    workspace,
    ...(options.defaultModel === undefined ? {} : { defaultModel: options.defaultModel }),
    agent: (feeds) => options.agent(withGoalControls(feeds, options.defaultModel)),
  });
}
