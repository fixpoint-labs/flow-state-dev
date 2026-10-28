/**
 * `listClaudeModels`: which models Claude Code offers, asked with no model
 * turn, each under the concrete id it resolves to.
 *
 * Scripted: the SDK's rows are fixed here, so what is pinned is the mapping
 * (aliases resolved, the default named and first, one row per id) and that the
 * list never sends a message.
 */
import { describe, expect, it } from "vitest";
import { listClaudeModels } from "../../src/sdk/model-list";

/** A scripted SDK whose `query` answers `supportedModels` with `rows`, recording what it was handed. */
function scriptedSdk(rows: () => Promise<unknown[]>) {
  const seen = { env: undefined as unknown, messagesSent: 0, closed: false };
  return {
    seen,
    importSdk: async () => ({
      query: (args: { prompt: AsyncIterable<unknown>; options?: { env?: unknown } }) => {
        seen.env = args.options?.env;
        void (async () => {
          for await (const _message of args.prompt) seen.messagesSent += 1;
        })();
        return {
          supportedModels: rows,
          close: () => {
            seen.closed = true;
          },
        };
      },
    }),
  };
}

describe("listClaudeModels, scripted", () => {
  it("names each model by its resolved id, the default first under its own name, and sends no message", async () => {
    const sdk = scriptedSdk(async () => [
      { value: "default", resolvedModel: "claude-big-2", displayName: "Default (recommended)", description: "Big 2" },
      { value: "sonnet", resolvedModel: "claude-mid-5", displayName: "Mid", description: "fast" },
      { value: "claude-big-2", displayName: "Big" },
      { value: "haiku", displayName: "Small" },
    ]);
    const env = { PATH: "/bin" };
    const list = await listClaudeModels({ env, importSdk: sdk.importSdk });

    expect(list).toEqual({
      status: "models",
      models: [
        { id: "claude-big-2", label: "Big", isDefault: true },
        { id: "claude-mid-5", label: "Mid", description: "fast", isDefault: false },
        // `haiku` came back with no resolved id: an alias stored on a session
        // would follow Claude Code to another model, so it isn't offered.
      ],
    });
    expect(list.status === "models" && list.models.map((m) => m.id)).not.toContain("haiku");
    expect(sdk.seen.env).toEqual(env);
    expect(sdk.seen.messagesSent).toBe(0);
    expect(sdk.seen.closed).toBe(true);
  });

  it("keeps the default when no other row names it, and drops a default row that resolves to nothing", async () => {
    const named = await listClaudeModels({
      env: {},
      importSdk: scriptedSdk(async () => [{ value: "default", resolvedModel: "claude-x", displayName: "Default" }]).importSdk,
    });
    expect(named).toEqual({ status: "models", models: [{ id: "claude-x", label: "claude-x", isDefault: true }] });

    const unresolved = await listClaudeModels({
      env: {},
      importSdk: scriptedSdk(async () => [{ value: "default", displayName: "Default" }, { value: "claude-y", displayName: "Y" }]).importSdk,
    });
    expect(unresolved).toEqual({ status: "models", models: [{ id: "claude-y", label: "Y", isDefault: false }] });
  });

  it("offers no alias it can't resolve, so a stored id never moves when the alias does", async () => {
    const list = await listClaudeModels({
      env: {},
      importSdk: scriptedSdk(async () => [
        { value: "sonnet[1m]", displayName: "Mid, long context" },
        { value: "opusplan", displayName: "Plan with Big" },
        { value: "us.anthropic.claude-mid-5", displayName: "Mid on Bedrock" },
      ]).importSdk,
    });
    expect(list).toEqual({
      status: "models",
      models: [{ id: "us.anthropic.claude-mid-5", label: "Mid on Bedrock", isDefault: false }],
    });

    const onlyAliases = await listClaudeModels({
      env: {},
      importSdk: scriptedSdk(async () => [{ value: "haiku", displayName: "Small" }]).importSdk,
    });
    expect(onlyAliases).toEqual({ status: "failed", reason: "Claude Code listed no models" });
  });

  it("fails with a reason, never a throw: an error, an empty list, no answer in time, no SDK", async () => {
    const thrown = await listClaudeModels({ env: {}, importSdk: scriptedSdk(async () => Promise.reject(new Error("boom"))).importSdk });
    expect(thrown).toEqual({ status: "failed", reason: "Claude Code could not be asked for its models: boom" });

    const empty = await listClaudeModels({ env: {}, importSdk: scriptedSdk(async () => []).importSdk });
    expect(empty).toEqual({ status: "failed", reason: "Claude Code listed no models" });

    const slow = await listClaudeModels({ env: {}, timeoutMs: 10, importSdk: scriptedSdk(() => new Promise(() => {})).importSdk });
    expect(slow).toEqual({ status: "failed", reason: "Claude Code did not list its models within 10 ms" });

    const missing = await listClaudeModels({ env: {}, importSdk: async () => Promise.reject(new Error("not found")) });
    expect(missing.status).toBe("failed");
  });
});
