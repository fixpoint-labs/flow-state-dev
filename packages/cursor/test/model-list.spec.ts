/**
 * `listCursorModels`: which models the signed-in Cursor account can run,
 * asked of the SDK's `Cursor.models.list()` with no run.
 *
 * It matters because a host's model picker is this list: a hand-kept one ages
 * as Cursor ships and retires models, and is a different set for each account.
 * Scripted: the SDK is a stand-in module the asking process loads, so what is
 * pinned is the mapping into core's shared shape (with Cursor's variants
 * beside it), which account is asked, and that every way the read fails is an
 * answer, not a throw.
 *
 * Red state produced before the asking process was trusted: asked in this
 * process, a run environment with no `CURSOR_API_KEY` listed with the
 * server's own key (`listed-with-server-key`), an account the run can't use.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { listCursorModels } from "../src/index";

/**
 * A stand-in `@cursor/sdk` whose `Cursor.models.list()` runs `body`, with the
 * real SDK's key precedence: an explicit `apiKey`, then its own process's
 * `CURSOR_API_KEY`. `key` is in scope in `body`.
 */
function sdk(body: string): string {
  return `data:text/javascript,${encodeURIComponent(`export const Cursor = { models: { list: async (o) => {
    const key = o?.apiKey ?? process.env.CURSOR_API_KEY ?? "none";
    ${body}
  } } };`)}`;
}

/** The asking process's environment beyond the key: none is needed. */
const ENV = { PATH: process.env.PATH ?? "" };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("listCursorModels", () => {
  it("lists the account's models in core's shape, each with the variants Cursor runs it at", async () => {
    const rows = [
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
    ];
    const list = await listCursorModels({ env: ENV, sdkModule: sdk(`return ${JSON.stringify(rows)};`) });
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
    const list = await listCursorModels({
      env: { ...ENV, CURSOR_API_KEY: "run-key" },
      sdkModule: sdk(`return [{ id: "listed-with-" + key, displayName: key }];`),
    });
    expect(list).toMatchObject({ status: "models", models: [{ id: "listed-with-run-key" }] });
  });

  it("never lists with the server's key when the run's environment has none, as the run can't use it", async () => {
    vi.stubEnv("CURSOR_API_KEY", "server-key");
    const list = await listCursorModels({ env: ENV, sdkModule: sdk(`return [{ id: "listed-with-" + key, displayName: key }];`) });
    expect(list).toMatchObject({ status: "models", models: [{ id: "listed-with-none" }] });
  });

  it("asks under the run's HOME, where the SDK keeps the stored login the run uses", async () => {
    const list = await listCursorModels({
      env: { ...ENV, HOME: "/run/home" },
      sdkModule: sdk(`return [{ id: "home-" + process.env.HOME, displayName: "M" }];`),
    });
    expect(list).toMatchObject({ status: "models", models: [{ id: "home-/run/home" }] });
  });

  it("drops a row with no id and keeps one row per id", async () => {
    const list = await listCursorModels({
      env: ENV,
      sdkModule: sdk(`return [{ displayName: "No id" }, { id: "m", displayName: "M" }, { id: "m", displayName: "Again" }];`),
    });
    expect(list).toEqual({ status: "models", models: [{ id: "m", label: "M", isDefault: false, variants: [] }] });
  });

  it("answers every failure with a reason, and never throws", async () => {
    const missing = await listCursorModels({ env: ENV, sdkModule: "@cursor/no-such-sdk" });
    expect(missing).toEqual({ status: "failed", reason: expect.stringMatching(/Cursor SDK could not be loaded.*no-such-sdk/) });

    const thrown = await listCursorModels({ env: ENV, sdkModule: sdk(`throw new Error("401 unauthorized");`) });
    expect(thrown).toEqual({ status: "failed", reason: "Cursor could not list its models: 401 unauthorized" });

    const empty = await listCursorModels({ env: ENV, sdkModule: sdk(`return [];`) });
    expect(empty).toEqual({ status: "failed", reason: "Cursor listed no models" });

    const slow = await listCursorModels({ env: ENV, timeoutMs: 200, sdkModule: sdk(`return new Promise(() => setInterval(() => {}, 1000));`) });
    expect(slow).toEqual({ status: "failed", reason: "Cursor did not list its models within 200 ms" });
  });
});
