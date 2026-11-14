/**
 * `cursorHarness()`: Cursor as one harness value, for the harness kit's
 * `harnesses` slot (`@flow-state-dev/harness-manager/kit`).
 *
 * Each run, readiness check and model list gets only Cursor's own
 * environment (`harnessEnv` over `CURSOR_PASS`). A local Cursor run must
 * name its model: `"default"`, Cursor's own pick, unless the options name
 * one. Its sandbox is off: a coding run already works in its own worktree.
 */
import { harnessEnv, type HarnessBlock } from "@flow-state-dev/core/harness";
import type { Harness } from "@flow-state-dev/harness-manager";
import { cursorAgent, type CursorAgentOptions } from "./agent";
import { CURSOR_PASS } from "./env-pass";
import { listCursorModels } from "./model-list";
import { checkCursorReadiness } from "./sign-in";

/** What `cursorHarness` takes: the Cursor block's options, less what each run feeds it. */
export type CursorHarnessOptions = Omit<CursorAgentOptions, "cwd" | "resume" | "onSession" | "onSteerable" | "onActivity">;

/**
 * Cursor as a harness value.
 *
 * @param options The Cursor block's options. Its environment is always Cursor's own.
 */
export function cursorHarness(options: CursorHarnessOptions = {} as CursorHarnessOptions): Harness {
  const env = () => harnessEnv({ pass: CURSOR_PASS });
  const given = options as { agent?: { local?: object } };
  return {
    id: "cursor",
    label: "Cursor",
    agent: (feeds) =>
      cursorAgent({
        name: "cursor",
        model: "default",
        ...options,
        agent: { mode: "agent", ...given.agent, local: { sandboxOptions: { enabled: false }, ...given.agent?.local } },
        env: env(),
        cwd: feeds.cwd,
        resume: feeds.resume,
        onSession: feeds.onSession,
        ...(feeds.onSteerable === undefined ? {} : { onSteerable: feeds.onSteerable }),
        ...(feeds.onActivity === undefined ? {} : { onActivity: feeds.onActivity }),
      } as never) as unknown as HarnessBlock,
    readiness: () => checkCursorReadiness(env()),
    pass: CURSOR_PASS,
    models: () => listCursorModels({ env: env() }),
  };
}
