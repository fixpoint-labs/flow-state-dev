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
import { createBashBlocks } from "@flow-state-dev/tools/bash";
import type { SandboxProvider } from "@flow-state-dev/tools/bash";
import path from "node:path";

/**
 * Pick the bash sandbox provider based on the runtime environment:
 *
 *   - `VERCEL` set            → Vercel Sandbox (requires `@vercel/sandbox`)
 *   - `STORE_TYPE=filesystem` → local shell on the host's filesystem
 *   - otherwise               → just-bash (WASM, python + js enabled)
 *
 * Defaulting to just-bash keeps preview environments self-contained — no
 * mutations on the host, no provider account required — so any skill that
 * exercises bash is testable from a clean clone without setup.
 */
export function selectBashProvider(): SandboxProvider {
  if (process.env.VERCEL) {
    return { type: "vercel" };
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
