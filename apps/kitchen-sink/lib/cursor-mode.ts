/**
 * Cursor mode: the session flow with the Cursor block, and the mode's own
 * check of whether this host can run it.
 *
 * Server only. The block records Cursor's to-do list in the shared plan record
 * (`recordPlan`) and hands the runtime only an allowlisted environment through
 * the block's `env`. The Cursor package runs that runtime in a child process
 * whose environment is exactly the allowlist. That filters what the run's
 * commands start with; it is not a security boundary.
 *
 * **Kitchen Sink confines no run.** Cursor's own sandbox is off and the run
 * asks for no approval, so it writes, commits and runs commands wherever the
 * server's OS user can — this checkout included, not just the session's
 * worktree. Kitchen Sink is a showcase meant to run on a machine where that is
 * fine. Run the server as a separate OS user, or in a container, when it is
 * not.
 *
 * Cursor loads none of the repository's project settings, trusted or not: its
 * SDK can't load them with their hooks off. When the operator trusts the
 * repository (`lib/harness-trust.ts`), the run is handed the keys they named.
 *
 * Under `KITCHEN_SINK_TEST_MODE=1` the SDK is replaced by the scripted Cursor
 * (`lib/scripted-cursor.ts`), with `env` left unset (the scripted client runs
 * in this process, and the block refuses a custom client beside `env`), and
 * the check passes, unless `KITCHEN_SINK_REAL_HARNESS=1` asks for the real
 * one, which the goal check does so its controls apply to a real run.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { harnessEnv } from "@flow-state-dev/core/harness";
import {
  CURSOR_PASS,
  TESTED_SDK_VERSION,
  checkCursorReadiness,
  cursorAgent,
  listCursorModels,
  readInstalledCursorSdkVersion,
  type CursorAgentOptions,
  type CursorModelSelection,
  type CursorModelVariant,
  type InstalledSdkVersion,
  type ResolveCursorClient,
} from "@flow-state-dev/cursor";

import { goalControl } from "./goal-control";
import { harnessTrust, type RepoLine } from "./harness-trust";
import type { HarnessTrust } from "./harness-workspace";
import type { HarnessSessionFeeds } from "@flow-state-dev/harness-manager";
import type { HarnessBlock, HarnessModelInfo, HarnessReadiness } from "@flow-state-dev/core/harness";
import { kitchenSinkHarnessFlow } from "./harness-session-flow";
import { worktreeRoot } from "./harness-worktree";
import type { ModeAvailability, ModeCheck } from "./harness-gate";
import { fromReadiness } from "./mode-readiness";
import type { ModelChoices } from "./harness-models";
import { flowKindOf, modeById } from "./modes";
import { scriptedCursor } from "./scripted-cursor";

/** Cursor mode's flow kind, from the mode list: the rail lists its sessions by it. */
export const CURSOR_SESSION = flowKindOf(modeById("cursor"));

/**
 * Cursor mode's default model: preselected in New session, and the one a
 * session from before models could be picked runs on. Cursor's SDK refuses a
 * local agent with no model, so there is always one to hand it.
 */
export const CURSOR_DEFAULT_MODEL = "composer-2.5";

/**
 * The environment Cursor's runtime gets, and the one its sign-in is checked
 * over: the Cursor package's own pass-list (what its commands start with, not
 * what they could read: see the header), and the keys a trusting operator named.
 */
export function cursorEnv(
  env: Record<string, string | undefined> = process.env,
  trust: HarnessTrust = harnessTrust(),
): Record<string, string> {
  return harnessEnv({ pass: [...CURSOR_PASS, ...trust.pass], env });
}

/** The header's line for a Cursor session: no project settings, trusted or not. */
export function cursorRepoLine(trust: HarnessTrust = harnessTrust()): RepoLine {
  return {
    conventions: trust.trusted ? "not loaded (Cursor can't load them with their hooks off)" : "not loaded",
    keys: trust.pass,
  };
}

/** Whether this server runs the scripted Cursor instead of the SDK. */
export function cursorIsScripted(env: Record<string, string | undefined> = process.env): boolean {
  return env.KITCHEN_SINK_TEST_MODE === "1" && env.KITCHEN_SINK_REAL_HARNESS !== "1";
}

/** Test seams for the block: a stand-in for the Cursor SDK. */
export interface CursorSeams {
  /** Replaces the SDK (and the scripted one test mode picks). The block then runs in this process, with no `env`. */
  readonly resolveCursorClient?: ResolveCursorClient;
}

/**
 * The Cursor block's options, built from the session flow's feeds. Kitchen
 * Sink passes options and nothing else: the plan record, the child process and
 * the classification of a refused agent are the Cursor package's.
 */
export function cursorBlockOptions(feeds: HarnessSessionFeeds, seams: CursorSeams = {}): CursorAgentOptions {
  const resolveCursorClient = seams.resolveCursorClient ?? (cursorIsScripted() ? scriptedCursor() : undefined);
  return {
    cwd: feeds.cwd,
    resume: feeds.resume,
    onSession: feeds.onSession,
    onSteerable: feeds.onSteerable,
    model: async (ctx) => cursorModelSelection(await feeds.model(ctx)),
    // Declares no plan record, so goal leg **p** can be seen to fail.
    recordPlan: goalControl() !== "no-record",
    // Records no pull request in the turn, so goal leg **r1** can be seen to fail.
    recordPullRequests: goalControl() !== "no-pr-record",
    agent: {
      mode: "agent",
      // Cursor's sandbox is off: Kitchen Sink confines no run. See the header.
      local: { sandboxOptions: { enabled: false } },
    },
    // A stand-in client runs in this process, so it takes no `env`; the real
    // runtime always gets the allowlist, in its own process.
    ...(resolveCursorClient !== undefined ? { resolveCursorClient } : { env: cursorEnv() }),
    name: "cursor",
  };
}

/**
 * The Cursor block, built from the session flow's feeds.
 *
 * Cursor's handle is core's plus its own fields, and a block's hooks take its
 * output as a parameter, so the extended block isn't assignable to core's
 * neutral `HarnessBlock` (core's own note on that type). Claude Code mode casts
 * the same way.
 */
export function cursorBlock(feeds: HarnessSessionFeeds, seams: CursorSeams = {}): HarnessBlock {
  return cursorAgent(cursorBlockOptions(feeds, seams)) as unknown as HarnessBlock;
}

/** Cursor mode's session flow. `seams` is for tests. */
export function cursorSessionFlow(seams: CursorSeams = {}) {
  return kitchenSinkHarnessFlow({
    kind: CURSOR_SESSION,
    agent: (feeds) => cursorBlock(feeds, seams),
    defaultModel: CURSOR_DEFAULT_MODEL,
  });
}

/** The model the scripted Cursor offers. It runs no model; the id only travels. */
const SCRIPTED_CURSOR_MODEL = { id: CURSOR_DEFAULT_MODEL, label: "Scripted Cursor", isDefault: true };

/**
 * A picker entry's id for one way Cursor runs a model: the model, then the
 * variant's settings (`grok-4.7?reasoning_effort=high`). Stored on the session
 * as the pick; {@link cursorModelSelection} reads it back.
 */
function variantPickerId(model: string, params: CursorModelVariant["params"]): string {
  if (params.length === 0) return model;
  return `${model}?${new URLSearchParams(params.map(({ id, value }) => [id, value])).toString()}`;
}

/**
 * What Cursor is handed for a pick: the model and its settings for a variant's
 * entry, and the pick itself otherwise (an id Cursor takes as it is, or one
 * Kitchen Sink doesn't know, which Cursor judges).
 */
export function cursorModelSelection(picked: string | undefined): string | CursorModelSelection | undefined {
  const at = picked?.indexOf("?") ?? -1;
  if (picked === undefined || at < 0) return picked;
  const params = [...new URLSearchParams(picked.slice(at + 1))].map(([id, value]) => ({ id, value }));
  return { id: picked.slice(0, at), params };
}

/**
 * Cursor's list as New session's entries: a model Cursor runs one way is one
 * entry, and a model it runs several ways (Grok 4.7's efforts) is one entry
 * per way, since the way is part of the pick.
 */
function pickerEntries(found: Extract<Awaited<ReturnType<typeof listCursorModels>>, { status: "models" }>): HarnessModelInfo[] {
  return found.models.flatMap(({ variants, ...model }) =>
    variants.length < 2
      ? [model]
      : variants.map((variant) => ({
          id: variantPickerId(model.id, variant.params),
          label: `${model.label} · ${variant.label}`,
          ...(variant.description === undefined ? {} : { description: variant.description }),
          isDefault: false,
        })),
  );
}

/**
 * What Cursor mode's New session offers: Cursor's own list for the account a
 * run signs in as (the Cursor package's `listCursorModels`), Composer 2.5
 * preselected when the account has it. Cursor's catalog marks no default
 * model, and its SDK refuses a local agent with none, so a session with no
 * saved model runs Composer 2.5. When the list can't be read, nothing is
 * offered and New session can't start; the next load asks again. `list` is a
 * seam for tests.
 */
export async function cursorModelChoices(
  list: (env: Record<string, string>) => ReturnType<typeof listCursorModels> = (env) => listCursorModels({ env }),
): Promise<ModelChoices> {
  if (cursorIsScripted()) {
    return { models: [SCRIPTED_CURSOR_MODEL], defaultId: SCRIPTED_CURSOR_MODEL.id, reason: null, fallbackId: CURSOR_DEFAULT_MODEL };
  }
  const found = await list(cursorEnv());
  if (found.status === "failed") {
    return {
      models: [],
      defaultId: null,
      reason: `Cursor's model list can't be read (${found.reason}), so a new session can't name its model. Reload to try again.`,
      fallbackId: CURSOR_DEFAULT_MODEL,
    };
  }
  const models = pickerEntries(found);
  const preselected = models.find((model) => model.id === CURSOR_DEFAULT_MODEL) ?? models[0]!;
  return { models, defaultId: preselected.id, reason: null, fallbackId: CURSOR_DEFAULT_MODEL };
}

/** What the mode's check asks of the host. Each a seam for tests. */
export interface CursorHostChecks {
  /** Which `@cursor/sdk` is installed beside the Cursor package. */
  readonly sdk: () => InstalledSdkVersion;
  /** Make the worktree root, or throw why it can't be made. */
  readonly makeRoot: (repository: string) => void;
  /** Why a process with exactly `env` can't start here, or `null` when it can. */
  readonly childStarts: (env: Record<string, string>) => string | null;
  /** Whether Cursor can run over the run's own environment (its key or the SDK's stored login), from the Cursor package. No run. */
  readonly readiness: (env: Record<string, string>) => Promise<HarnessReadiness>;
}

/**
 * Start a Node process with exactly `env`, the way the Cursor package starts
 * the runtime's process, and see it exit cleanly.
 */
function childStarts(env: Record<string, string>): string | null {
  // Next types `NODE_ENV` as always set; this process deliberately gets only `env`.
  const started = spawnSync(process.execPath, ["-e", ""], { env: { ...env } as NodeJS.ProcessEnv, stdio: "ignore", timeout: 15_000 });
  if (started.error !== undefined) return started.error.message;
  if (started.status !== 0) return started.signal !== null ? `it was ended by ${started.signal}` : `it exited with code ${String(started.status)}`;
  return null;
}

/** The host's own answers. */
export const HOST_CHECKS: CursorHostChecks = {
  sdk: readInstalledCursorSdkVersion,
  makeRoot: (repository) => {
    mkdirSync(worktreeRoot(repository), { recursive: true });
  },
  childStarts,
  readiness: checkCursorReadiness,
};

/**
 * Cursor mode's own check, for the gate's mode-check slot: the pinned Cursor
 * SDK is installed, the worktree root can be made, a process with only the
 * run's environment can start (the Cursor package runs the runtime in one),
 * and Cursor is signed in over that environment. The first that fails is the
 * reason. Nothing is asked about a sandbox: Kitchen Sink runs Cursor with its
 * sandbox off (see the header).
 */
export function cursorModeCheck(checks: CursorHostChecks = HOST_CHECKS): ModeCheck {
  return async ({ repository }): Promise<ModeAvailability> => {
    if (cursorIsScripted()) return { available: true };
    const sdk = checks.sdk();
    if (sdk.kind === "absent") {
      return { available: false, reason: `The Cursor SDK is not installed. Install @cursor/sdk ${TESTED_SDK_VERSION}, then restart.` };
    }
    if (sdk.kind === "unreadable") {
      return { available: false, reason: `The Cursor SDK's version can't be read (${sdk.reason}). Cursor mode needs exactly ${TESTED_SDK_VERSION}.` };
    }
    if (sdk.version !== TESTED_SDK_VERSION) {
      return { available: false, reason: `The Cursor SDK installed is ${sdk.version}. Cursor mode needs exactly ${TESTED_SDK_VERSION}.` };
    }
    try {
      checks.makeRoot(repository);
    } catch (error) {
      return {
        available: false,
        reason: `The folder for session worktrees can't be made: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    const env = cursorEnv();
    const child = checks.childStarts(env);
    if (child !== null) {
      return { available: false, reason: `Cursor's runtime process can't be started with the run's environment: ${child}` };
    }
    return fromReadiness(await checks.readiness(env));
  };
}
