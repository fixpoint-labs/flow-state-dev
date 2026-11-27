/**
 * `cursorHarness()`: Cursor as one harness value, for the harness kit's
 * `harnesses` slot.
 *
 * Each run, readiness check and model list gets only Cursor's own
 * environment (`harnessEnv` over `CURSOR_PASS`). A local Cursor run must
 * name its model: `"default"`, Cursor's own pick, unless the options name
 * one. Its sandbox is off: a coding run already works in its own worktree.
 */
import { harnessEnv, type Harness } from "@flow-state-dev/core/harness";
import { cursorAgent, type CursorAgentOptions } from "./agent";
import { CURSOR_PASS } from "./env-pass";
import { listCursorModels } from "./model-list";
import { checkCursorReadiness } from "./sign-in";

/** What `cursorHarness` takes: the Cursor block's options, less what each run feeds it. */
export type CursorHarnessOptions = Omit<CursorAgentOptions, "cwd" | "resume" | "onSession" | "onSteerable" | "onActivity" | "onEvent"> & {
  /**
   * Variables set on every run over the pass-list, as given: values, not
   * names to pass. For what the host means a run to have, such as the GitHub
   * account it acts as (`gitHubAccountEnv` from `@flow-state-dev/core/harness`).
   */
  extraEnv?: Readonly<Record<string, string>>;
};

/**
 * Cursor as a harness value.
 *
 * @param options The Cursor block's options. Its environment is always Cursor's own.
 */
export function cursorHarness(harnessOptions: CursorHarnessOptions = {}): Harness {
  const { extraEnv, ...options } = harnessOptions;
  const env = () => ({ ...harnessEnv({ pass: CURSOR_PASS }), ...extraEnv });
  return {
    id: "cursor",
    label: "Cursor",
    agent: (feeds) =>
      cursorAgent({
        name: "cursor",
        model: "default",
        ...options,
        agent: { mode: "agent", ...options.agent, local: { sandboxOptions: { enabled: false }, ...options.agent?.local } },
        env: env(),
        cwd: feeds.cwd,
        resume: feeds.resume,
        onSession: feeds.onSession,
        ...(feeds.onSteerable === undefined ? {} : { onSteerable: feeds.onSteerable }),
        ...(feeds.onActivity === undefined ? {} : { onActivity: feeds.onActivity }),
        ...(feeds.onEvent === undefined ? {} : { onEvent: feeds.onEvent }),
      }),
    readiness: () => checkCursorReadiness(env()),
    pass: CURSOR_PASS,
    models: () => listCursorModels({ env: env() }),
  };
}
