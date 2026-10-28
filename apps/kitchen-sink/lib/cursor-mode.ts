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
 * Under `KITCHEN_SINK_TEST_MODE=1` the SDK is replaced by the scripted Cursor
 * (`lib/scripted-cursor.ts`), with `env` left unset (the scripted client runs
 * in this process, and the block refuses a custom client beside `env`), and
 * the check passes, unless `KITCHEN_SINK_REAL_HARNESS=1` asks for the real
 * one, which the goal check does so its controls apply to a real run.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { harnessEnv } from "@flow-state-dev/core";
import {
  TESTED_SDK_VERSION,
  cursorAgent,
  cursorSignIn,
  readInstalledCursorSdkVersion,
  type CursorAgentOptions,
  type CursorModelSelection,
  type CursorSignIn,
  type InstalledSdkVersion,
  type ResolveCursorClient,
} from "@flow-state-dev/cursor";

import { goalControl } from "./goal-control";
import { harnessSessionFlow, type HarnessBlock, type HarnessFeeds } from "./harness-session-flow";
import { worktreeRoot } from "./harness-worktree";
import type { ModeAvailability, ModeCheck } from "./harness-gate";
import type { HarnessModel, ModelChoices } from "./harness-models";
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
 * The only variables of the server's environment Cursor's runtime is handed
 * (what its commands start with, not what they could read: see the header).
 * `PATH` (its shell finds commands through it), `HOME` (Cursor keeps its
 * agents and its stored login there, so a resumed agent is found only with the
 * same `HOME`), `USER`, `SHELL` and `TMPDIR` (its shell), `CURSOR_API_KEY`, and
 * the proxy and CA settings a proxied network needs. Add a name here, never a
 * spread of `process.env`.
 */
export const CURSOR_PASS = [
  "PATH",
  "HOME",
  "USER",
  "SHELL",
  "TMPDIR",
  "CURSOR_API_KEY",
  "HTTPS_PROXY",
  "https_proxy",
  "HTTP_PROXY",
  "http_proxy",
  "ALL_PROXY",
  "all_proxy",
  "NO_PROXY",
  "no_proxy",
  "NODE_EXTRA_CA_CERTS",
] as const;

/** The environment Cursor's runtime gets, and the one its sign-in is checked over. */
export function cursorEnv(env: Record<string, string | undefined> = process.env): Record<string, string> {
  return harnessEnv({ pass: CURSOR_PASS, env });
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
export function cursorBlockOptions(feeds: HarnessFeeds, seams: CursorSeams = {}): CursorAgentOptions {
  const resolveCursorClient = seams.resolveCursorClient ?? (cursorIsScripted() ? scriptedCursor() : undefined);
  return {
    cwd: feeds.cwd,
    resume: feeds.resume,
    onSession: feeds.onSession,
    onSteerable: feeds.onSteerable,
    model: async (ctx) => cursorModelSelection(await feeds.model(ctx)),
    // Declares no plan record, so goal leg **p** can be seen to fail.
    recordPlan: goalControl() !== "no-record",
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
export function cursorBlock(feeds: HarnessFeeds, seams: CursorSeams = {}): HarnessBlock {
  return cursorAgent(cursorBlockOptions(feeds, seams)) as unknown as HarnessBlock;
}

/** Cursor mode's session flow. `seams` is for tests. */
export function cursorSessionFlow(seams: CursorSeams = {}) {
  return harnessSessionFlow({
    kind: CURSOR_SESSION,
    agent: (feeds) => cursorBlock(feeds, seams),
    defaultModel: CURSOR_DEFAULT_MODEL,
  });
}

/** The efforts Grok 4.7 is offered at, as Cursor names them (`reasoning_effort`). */
const GROK_EFFORTS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra High" },
] as const;

/** A Grok 4.7 entry's id in the picker: the model, then the effort. Stored on the session as the pick. */
const grokPickerId = (effort: string) => `grok-4.7:${effort}`;

/**
 * The models Cursor mode offers in New session. Kept by hand: each is a
 * model Cursor's catalog lists, which is a different set for each account
 * and moves faster than this list does. A model with settings runs on
 * Cursor's own defaults for them, except Grok 4.7, whose effort is part of
 * the pick. Availability still depends on the signed-in account; when Cursor
 * ships or retires a model, edit this list.
 */
const CURSOR_MODELS: readonly HarnessModel[] = [
  ...GROK_EFFORTS.map(({ value, label }) => ({ id: grokPickerId(value), label: `Grok 4.7 · ${label}` })),
  { id: CURSOR_DEFAULT_MODEL, label: "Composer 2.5" },
  { id: "gemini-4-argon", label: "Gemini 4 Argon" },
  { id: "muse-wonder-1.0", label: "Muse Wonder" },
  { id: "kimi-k3", label: "Kimi K3" },
  { id: "glm-5p3", label: "GLM 5.3" },
  { id: "glm-5p3-flash", label: "GLM 5.3 Flash" },
  { id: "default", label: "Auto (Cursor picks)" },
];

/**
 * What Cursor is handed for a pick: the model and its settings for a Grok 4.7
 * entry, and the pick itself otherwise (an id Cursor takes as it is, or one
 * Kitchen Sink doesn't know, which Cursor judges).
 */
export function cursorModelSelection(picked: string | undefined): string | CursorModelSelection | undefined {
  const grok = GROK_EFFORTS.find(({ value }) => grokPickerId(value) === picked);
  return grok === undefined ? picked : { id: "grok-4.7", params: [{ id: "reasoning_effort", value: grok.value }] };
}

/** What Cursor mode's New session offers: the list above, Composer 2.5 preselected. */
export async function cursorModelChoices(): Promise<ModelChoices> {
  return { models: CURSOR_MODELS, defaultId: CURSOR_DEFAULT_MODEL, reason: null, fallbackId: CURSOR_DEFAULT_MODEL };
}

/** What the mode's check asks of the host. Each a seam for tests. */
export interface CursorHostChecks {
  /** Which `@cursor/sdk` is installed beside the Cursor package. */
  readonly sdk: () => InstalledSdkVersion;
  /** Make the worktree root, or throw why it can't be made. */
  readonly makeRoot: (repository: string) => void;
  /** Why a process with exactly `env` can't start here, or `null` when it can. */
  readonly childStarts: (env: Record<string, string>) => string | null;
  /** Cursor's sign-in over the run's own environment: its key, or the SDK's stored login. No run. */
  readonly signIn: (env: Record<string, string>) => Promise<CursorSignIn>;
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
  signIn: cursorSignIn,
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
    const signedIn = await checks.signIn(env);
    if (signedIn.status === "none") {
      return {
        available: false,
        reason: `Cursor is not signed in on this host (${signedIn.reason}). Set CURSOR_API_KEY, or log in with the Cursor SDK, then restart.`,
      };
    }
    return { available: true };
  };
}
