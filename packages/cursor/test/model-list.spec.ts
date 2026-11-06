/**
 * `listCursorModels`: which models the signed-in Cursor account can run,
 * asked of the SDK's `Cursor.models.list()` with no run.
 *
 * It matters because a host's model picker is this list: a hand-kept one ages
 * as Cursor ships and retires models, and is a different set for each account.
 * Scripted: the SDK's rows are fixed here, so what is pinned is the mapping
 * into core's shared shape (with Cursor's variants beside it), which key the
 * call is made with, and that every way the read fails is an answer, not a throw.
 */
import { describe, expect, it } from "vitest";
import { listCursorModels } from "../src/index";

/** A scripted SDK whose `Cursor.models.list` answers with `list`, recording the options it was called with. */
function scriptedSdk(list: (options?: { apiKey?: string }) => Promise<unknown>) {
  const seen: Array<{ apiKey?: string } | undefined> = [];
  return {
    seen,
    importSdk: async () => ({
      Cursor: {
        models: {
          list: (options?: { apiKey?: string }) => {
            seen.push(options);
            return list(options);
          },
        },
      },
    }),
  };
}

describe("listCursorModels", () => {
  it("lists the account's models in core's shape, each with the variants Cursor runs it at", async () => {
    const sdk = scriptedSdk(async () => [
      {
        id: "grok-4.7",
        displayName: "Grok 4.7",
        description: "Fast",
        variants: [
          { params: [{ id: "reasoning_effort", value: "low" }], displayName: "Low" },
          { params: [{ id: "reasoning_effort", value: "high" }], displayName: "High", description: "Thinks longer", isDefault: true },
        ],
      },
      { id: "composer-2.5", displayName: "Composer 2.5" },
    ]);
    const list = await listCursorModels({ env: {}, importSdk: sdk.importSdk });
    expect(list).toEqual({
      status: "models",
      models: [
        {
          id: "grok-4.7",
          label: "Grok 4.7",
          description: "Fast",
          // Cursor's catalog marks no model as the default, only a variant within one.
          isDefault: false,
          variants: [
            { params: [{ id: "reasoning_effort", value: "low" }], label: "Low", isDefault: false },
            { params: [{ id: "reasoning_effort", value: "high" }], label: "High", description: "Thinks longer", isDefault: true },
          ],
        },
        { id: "composer-2.5", label: "Composer 2.5", isDefault: false, variants: [] },
      ],
    });
  });

  it("asks with the run's key, so the list is the account the run signs in as", async () => {
    const sdk = scriptedSdk(async () => [{ id: "m", displayName: "M" }]);
    await listCursorModels({ env: { CURSOR_API_KEY: "run-key" }, importSdk: sdk.importSdk });
    await listCursorModels({ env: {}, importSdk: sdk.importSdk });
    // No key in the run's environment: the SDK's stored login answers.
    expect(sdk.seen).toEqual([{ apiKey: "run-key" }, {}]);
  });

  it("drops a row with no id and keeps one row per id", async () => {
    const sdk = scriptedSdk(async () => [{ displayName: "No id" }, { id: "m", displayName: "M" }, { id: "m", displayName: "Again" }]);
    const list = await listCursorModels({ env: {}, importSdk: sdk.importSdk });
    expect(list).toEqual({ status: "models", models: [{ id: "m", label: "M", isDefault: false, variants: [] }] });
  });

  it("answers every failure with a reason, and never throws", async () => {
    const missing = await listCursorModels({ env: {}, importSdk: async () => Promise.reject(new Error("Cannot find module '@cursor/sdk'")) });
    expect(missing).toEqual({ status: "failed", reason: expect.stringMatching(/Cursor SDK could not be loaded.*Cannot find module/) });

    const thrown = await listCursorModels({ env: {}, importSdk: scriptedSdk(async () => Promise.reject(new Error("401 unauthorized"))).importSdk });
    expect(thrown).toEqual({ status: "failed", reason: expect.stringMatching(/Cursor could not list its models: 401 unauthorized/) });

    const empty = await listCursorModels({ env: {}, importSdk: scriptedSdk(async () => []).importSdk });
    expect(empty).toEqual({ status: "failed", reason: "Cursor listed no models" });

    const slow = await listCursorModels({ env: {}, timeoutMs: 10, importSdk: scriptedSdk(() => new Promise(() => {})).importSdk });
    expect(slow).toEqual({ status: "failed", reason: "Cursor did not list its models within 10 ms" });
  });
});
