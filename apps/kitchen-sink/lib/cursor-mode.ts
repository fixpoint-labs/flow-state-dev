/**
 * Cursor mode: the session flow with the Cursor block, and the mode's own
 * check of whether this host can run it.
 *
 * Server only. The block records Cursor's to-do list in the shared plan record
 * (`recordPlan`), runs Cursor's local runtime with its sandbox on, so the run
 * writes only in the session's worktree (Cursor's sandbox keeps a worktree's
 * `.git` pointer and the repository's hooks and config out of reach), and
 * hands the runtime only an allowlisted environment through the block's `env`.
 * The Cursor package runs that runtime in a child process whose environment is
 * exactly the allowlist. That filters what the run's commands start with; it
 * is not a security boundary. The child runs as the server's OS user, and on
 * Linux a command can still read the server's environment from `/proc`. Run
 * the server as a separate OS user or in a container when that matters.
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
  probeCursorSandbox,
  readInstalledCursorSdkVersion,
  type CursorSandboxSupport,
  type CursorAgentOptions,
  type InstalledSdkVersion,
  type ResolveCursorClient,
} from "@flow-state-dev/cursor";

import { goalControl } from "./goal-control";
import { harnessUnsandboxed, unsandboxedHint, unsandboxedNote } from "./harness-sandbox";
import { harnessSessionFlow, type HarnessBlock, type HarnessFeeds } from "./harness-session-flow";
import { worktreeRoot } from "./harness-worktree";
import type { ModeAvailability, ModeCheck } from "./harness-gate";
import type { HarnessModel, ModelChoices } from "./harness-models";
import { flowKindOf, modeById } from "./modes";
import { scriptedCursor } from "./scripted-cursor";

/** Cursor mode's flow kind, from the mode list: the rail lists its sessions by it. */
export const CURSOR_SESSION = flowKindOf(modeById("cursor"));

/**
 * Cursor mode's default model: preselected in New session, the one a session
 * from before models could be picked runs on, and the only one offered when
 * Cursor's model list can't be read. Cursor's SDK refuses a local agent with
 * no model, so there is always one to hand it.
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
    model: feeds.model,
    // Declares no plan record, so goal leg **p** can be seen to fail.
    recordPlan: goalControl() !== "no-record",
    agent: {
      mode: "agent",
      // Writes confined to the run's `cwd`, the session's worktree. Cursor fails
      // the run when its sandbox can't start, rather than running without it.
      // `KITCHEN_SINK_HARNESS_UNSANDBOXED=1` turns it off (`lib/harness-sandbox.ts`):
      // the run then writes wherever the server's OS user can.
      local: { sandboxOptions: { enabled: !harnessUnsandboxed() } },
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

/** Cursor's own model list, read over the run's sign-in. A seam for tests. */
export type CursorModelList = (env: Record<string, string>) => Promise<readonly HarnessModel[]>;

/** The SDK's catalog call: the models the signed-in account can run, by Cursor's ids and names. */
const listCursorModels: CursorModelList = async (env) => {
  // Loaded only here, so a host without the SDK never loads it.
  const { Cursor } = (await import("@cursor/sdk")) as unknown as {
    Cursor: { models: { list(options?: { apiKey?: string }): Promise<Array<{ id: string; displayName?: string }>> } };
  };
  const key = env.CURSOR_API_KEY ?? "";
  const items = await Cursor.models.list(key === "" ? undefined : { apiKey: key });
  return items.map((item) => ({ id: item.id, label: item.displayName || item.id }));
};

/**
 * What Cursor mode's New session offers: Cursor's own list, with the mode's
 * default preselected (and put first when Cursor doesn't list it). When the
 * list can't be read, the default alone, with the reason. Under the scripted
 * Cursor, the default alone and no reason.
 */
export async function cursorModelChoices(list: CursorModelList = listCursorModels): Promise<ModelChoices> {
  const fallback: HarnessModel = { id: CURSOR_DEFAULT_MODEL, label: CURSOR_DEFAULT_MODEL };
  const base = { defaultId: CURSOR_DEFAULT_MODEL, fallbackId: CURSOR_DEFAULT_MODEL };
  if (cursorIsScripted()) return { ...base, models: [fallback], reason: null };
  try {
    const models = await list(cursorEnv());
    const listed = models.some((model) => model.id === CURSOR_DEFAULT_MODEL);
    return { ...base, models: listed ? models : [fallback, ...models], reason: null };
  } catch (error) {
    return {
      ...base,
      models: [fallback],
      reason: `Cursor's model list can't be read (${error instanceof Error ? error.message : String(error)}), so only Cursor mode's default is offered.`,
    };
  }
}

/** How this host signs Cursor in: a key in the run's environment, a stored login, or neither. */
export type CursorSignIn = { readonly status: "key" | "login" } | { readonly status: "none"; readonly reason: string };

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
  /** Whether Cursor's sandbox can start for a run in `cwd` with exactly `env`, in Cursor's words. No run. */
  readonly sandbox: (cwd: string, env: Record<string, string>) => CursorSandboxSupport;
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

/** A key in the run's environment, else the SDK's own answer about its stored login. */
async function signIn(env: Record<string, string>): Promise<CursorSignIn> {
  if ((env.CURSOR_API_KEY ?? "") !== "") return { status: "key" };
  // Loaded only here, so a host without the SDK never loads it, and the check
  // reads the stored login under the same `HOME` the run is handed.
  const { Cursor } = (await import("@cursor/sdk")) as unknown as {
    Cursor: { auth: { status(): Promise<{ status: string }> } };
  };
  const status = await Cursor.auth.status();
  return status.status === "logged-in"
    ? { status: "login" }
    : { status: "none", reason: "no CURSOR_API_KEY in the run's environment and no stored login" };
}

/** The host's own answers. */
export const HOST_CHECKS: CursorHostChecks = {
  sdk: readInstalledCursorSdkVersion,
  makeRoot: (repository) => {
    mkdirSync(worktreeRoot(repository), { recursive: true });
  },
  childStarts,
  signIn,
  sandbox: (cwd, env) => probeCursorSandbox({ cwd, env }),
};

/**
 * Cursor mode's own check, for the gate's mode-check slot: the pinned Cursor
 * SDK is installed, the worktree root can be made, a process with only the
 * run's environment can start (the Cursor package runs the runtime in one),
 * Cursor is signed in over that environment, and Cursor's sandbox can start
 * here. The first that fails is the reason.
 *
 * Cursor fails a run whose sandbox can't start rather than running without
 * it, hence the sandbox check (`probeCursorSandbox`). Under
 * `KITCHEN_SINK_HARNESS_UNSANDBOXED=1` it is skipped, and the available
 * mode's note says the run is unsandboxed.
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
    if (harnessUnsandboxed()) return { available: true, note: unsandboxedNote("Cursor") };
    const sandbox = checks.sandbox(repository, env);
    if (!sandbox.supported) {
      return {
        available: false,
        reason: `Cursor's sandbox can't start on this host, and Cursor mode runs only inside it. Cursor says: ${sandbox.reason} ${unsandboxedHint("Cursor")}`,
      };
    }
    return { available: true };
  };
}
