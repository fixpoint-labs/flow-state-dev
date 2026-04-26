/**
 * Bash tool blocks — execute commands and manage files in a sandbox workspace.
 *
 * Uses the framework's `createBashBlocks` factory. No explicit collection
 * config — the blocks auto-discover every `ResourceCollectionRef` installed
 * on the block's runtime context (artifacts, skills, etc.) and mount each
 * at its pattern prefix. Writes route back per-collection; files under
 * `/workspace/tmp/` are scratch; anything else is dropped with a warning.
 *
 * The sandbox provider is selected per environment by `selectBashProvider`
 * so the same code path works in local dev, on Vercel, and in
 * preview/sandbox environments without a real shell.
 */
import { Sandbox as VercelSandbox } from "@vercel/sandbox";
import { createBashBlocks } from "@flow-state-dev/tools/bash";
import type { SandboxProvider } from "@flow-state-dev/tools/bash";
import path from "node:path";

/**
 * Pick the bash sandbox provider based on the runtime environment:
 *
 *   - `VERCEL` set            → Vercel Sandbox (consumer-injected SDK)
 *   - `STORE_TYPE=filesystem` → local shell on the host's filesystem
 *   - otherwise               → just-bash (WASM, python + js enabled)
 *
 * The Vercel provider takes the SDK's `Sandbox` class via the provider
 * config. `@flow-state-dev/tools` doesn't take a peer dep on
 * `@vercel/sandbox` — bundlers and Vercel's file tracer (nft) follow
 * the static SDK import in this file to ship the package and its
 * transitive deps to the deployment.
 */
export function selectBashProvider(): SandboxProvider {
  if (process.env.VERCEL) {
    return { type: "vercel", Sandbox: VercelSandbox };
  }
  if (process.env.STORE_TYPE === "filesystem") {
    return { type: "local" };
  }
  return {
    type: "just-bash",
    python: true,
    javascript: true,
  };
}

export const { bashCommand, bashReadFile, bashWriteFile } = createBashBlocks({
  provider: selectBashProvider(),
  createState: (relativePath) => ({
    title: path.basename(relativePath),
    updatedAt: Date.now(),
  }),
});
