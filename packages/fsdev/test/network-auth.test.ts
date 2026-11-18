import { afterEach, expect, it, vi } from "vitest";
import { resolve } from "node:path";
import { serve } from "@flow-state-dev/node";
import { executeServeCommand } from "../src/commands/serve";
import { executeDevCommand } from "../src/commands/dev";

// Stop at the host boundary: the command must pass the policy to serve(),
// including false, without enforcing its own copy before reaching the host.
vi.mock("@flow-state-dev/node", async (importOriginal) => ({
  ...await importOriginal<typeof import("@flow-state-dev/node")>(),
  serve: vi.fn(async () => { throw new Error("host reached"); }),
}));
vi.mock("@flow-state-dev/devtool", () => ({
  getDevToolAssetPath: () => import.meta.dirname,
}));
afterEach(() => vi.clearAllMocks());

it.each([false, true])("fsdev serve passes allowUnauthenticated=%s to the host", async allowUnauthenticated => {
  await expect(executeServeCommand({
    cwd: resolve(import.meta.dirname, "fixtures-config/serve-unauth"),
    host: "0.0.0.0", port: "0", allowUnauthenticated,
  })).rejects.toThrow("host reached");
  expect(serve).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    host: "0.0.0.0", allowUnauthenticated,
  }));
});

it.each([false, true])("fsdev dev passes allowUnauthenticated=%s to the host", async allowUnauthenticated => {
  await expect(executeDevCommand({
    config: resolve(import.meta.dirname, "fixtures-config/serve-unauth/fsdev.config.ts"),
    host: "0.0.0.0", port: "0", open: false, allowUnauthenticated,
  })).rejects.toThrow("host reached");
  expect(serve).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    host: "0.0.0.0", allowUnauthenticated,
  }));
});
