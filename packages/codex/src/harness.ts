/**
 * `codexHarness()`: Codex as one harness value, for the harness kit's
 * `harnesses` slot.
 *
 * Each run, and each readiness check, usage read and model list, gets only
 * Codex's own environment (`harnessEnv` over `CODEX_PASS`). A run works in
 * `workspace-write` sandbox mode unless the options say otherwise.
 */
import { harnessEnv, type Harness } from "@flow-state-dev/core/harness";
import { checkCodexReadiness } from "./account-probe";
import { codexAgent, type CodexAgentOptions } from "./agent";
import { CODEX_PASS } from "./env-pass";
import { listCodexModels } from "./model-list";
import { readCodexUsage } from "./usage";

/** What `codexHarness` takes: the Codex block's options, less what each run feeds it. */
export type CodexHarnessOptions = Omit<CodexAgentOptions, "cwd" | "resume" | "onSession" | "onActivity" | "onEvent"> & {
  /**
   * Variables set on every run over the pass-list, as given: values, not
   * names to pass. For what the host means a run to have, such as the GitHub
   * account it acts as (`gitHubAccountEnv` from `@flow-state-dev/core/harness`).
   */
  extraEnv?: Readonly<Record<string, string>>;
};

/** How long the readiness check waits for Codex's account to answer. */
const READINESS_TIMEOUT_MS = 30_000;

/**
 * Codex as a harness value.
 *
 * @param options The Codex block's options. Its client's environment is always Codex's own.
 */
export function codexHarness(harnessOptions: CodexHarnessOptions = {}): Harness {
  const { extraEnv, ...options } = harnessOptions;
  const env = () => ({ ...harnessEnv({ pass: CODEX_PASS }), ...extraEnv });
  return {
    id: "codex",
    label: "Codex",
    agent: (feeds) =>
      codexAgent({
        name: "codex",
        ...options,
        thread: { sandboxMode: "workspace-write", ...options.thread },
        client: { ...options.client, env: env() },
        cwd: feeds.cwd,
        resume: feeds.resume,
        onSession: feeds.onSession,
        ...(feeds.onActivity === undefined ? {} : { onActivity: feeds.onActivity }),
        ...(feeds.onEvent === undefined ? {} : { onEvent: feeds.onEvent }),
      }),
    readiness: (check) => checkCodexReadiness({ env: env(), timeoutMs: READINESS_TIMEOUT_MS, ...(check?.signal === undefined ? {} : { signal: check.signal }) }),
    pass: CODEX_PASS,
    usage: (read) => readCodexUsage({ env: env(), ...(read?.signal === undefined ? {} : { signal: read.signal }) }),
    models: () => listCodexModels({ env: env() }),
  };
}
