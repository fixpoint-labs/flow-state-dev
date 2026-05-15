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
 *   - `BASH_PROVIDER=moat`    → MOAT containerized sandbox (requires `moat` CLI ≥0.4.0)
 *   - `STORE_TYPE=filesystem` → local shell on the host's filesystem
 *   - otherwise               → just-bash (WASM, python + js enabled)
 *
 * MOAT is opt-in for local development — set `BASH_PROVIDER=moat` to run
 * commands inside a host-local container with outbound network restricted
 * to `MOAT_ALLOW_HOSTS` (comma-separated, default-deny when unset). The
 * grants the agent should use can be passed via `MOAT_GRANTS`. If a
 * hand-authored `moat.yaml` should be used as-is (declaring deps, ports,
 * etc.) point `MOAT_CONFIG_PATH` at it — the framework will leave that
 * file untouched and skip generating one from the env vars above. Any
 * flow that uses this provider must also wire `bashCap.cleanupBlock`
 * into `defineFlow({ request: { onFinished } })` to avoid leaking
 * containers — `chat-agent/flow.ts` does this unconditionally.
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
  if (process.env.BASH_PROVIDER === "moat") {
    const grants = (process.env.MOAT_GRANTS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const allowHosts = (process.env.MOAT_ALLOW_HOSTS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const configPath = process.env.MOAT_CONFIG_PATH?.trim() || undefined;
    return {
      type: "moat",
      grants: grants.length > 0 ? grants : undefined,
      allowHosts: allowHosts.length > 0 ? allowHosts : undefined,
      runName: "kitchen-sink",
      configPath,
    };
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
