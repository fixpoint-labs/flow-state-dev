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
 * preview/sandbox environments without a real shell. `bashCap` (the bash
 * capability built from `selectBashProvider()`) lives in
 * `shared/capabilities/features.ts` alongside the other tool wiring.
 */
import { Sandbox as VercelSandbox } from "@vercel/sandbox";
import { createBashBlocks } from "@flow-state-dev/tools/bash";
import type { SandboxProvider } from "@flow-state-dev/tools/bash";
import path from "node:path";

/**
 * Pick the bash sandbox provider based on the runtime environment.
 *
 * Resolution order:
 *
 *   1. `BASH_PROVIDER` explicit opt-in (`vercel` | `moat` | `local` | `just-bash`)
 *      always wins. Caller-knows-best; the adapter surfaces a clear error if
 *      credentials are missing.
 *   2. On Vercel (`process.env.VERCEL` truthy) with the static access-token
 *      triple (`VERCEL_TOKEN` + `VERCEL_TEAM_ID` + `VERCEL_PROJECT_ID`),
 *      auto-detect picks the Vercel Sandbox adapter.
 *   3. `STORE_TYPE=filesystem` → local shell on the host's filesystem.
 *   4. Fallback: `just-bash` (in-memory virtual filesystem, ~70 commands,
 *      python + js enabled, zero auth). Anonymous-visitor demos on Vercel
 *      land here when neither OIDC nor static creds are configured —
 *      bash works without errors instead of returning HTTP 400 on every
 *      call.
 *
 * **Why OIDC isn't auto-detected.** Vercel Sandbox supports OIDC Federation
 * as the recommended auth path, but the OIDC token is delivered per-request
 * via the `x-vercel-oidc-token` header — it is not present in
 * `process.env.VERCEL_OIDC_TOKEN` when this module evaluates at cold start.
 * Operators with OIDC enabled on the project must opt in via
 * `BASH_PROVIDER=vercel`; the SDK then fetches the token lazily on each
 * call. The auto-detect path can only safely detect the static triple.
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
  const explicit = process.env.BASH_PROVIDER;
  if (explicit === "moat") {
    return { type: "moat", persist: true, configPath: "./moat.yaml" };
  }
  if (explicit === "local") {
    return { type: "local" };
  }
  if (explicit === "just-bash") {
    return { type: "just-bash", python: true, javascript: true };
  }
  if (explicit === "vercel") {
    // Honor explicit opt-in even without credentials — the SDK will fetch
    // an OIDC token from the per-request header on the first call, and if
    // none is available the adapter's enrichVercelError surfaces an
    // actionable diagnostic.
    return { type: "vercel", Sandbox: VercelSandbox };
  }
  if (explicit !== undefined && explicit !== "") {
    // Typos like "Vercel" or "verce" would otherwise silently fall through
    // to auto-detect, hiding the operator's intent. Warn but don't throw —
    // throwing here would crash the flow at module init, which a stale env
    // var on a dev machine shouldn't do.
    console.warn(
      `[bash-tools] Unknown BASH_PROVIDER="${explicit}". Expected one of: vercel, just-bash, local, moat. Falling through to auto-detect.`,
    );
  }

  if (process.env.VERCEL && hasVercelSandboxCredentials()) {
    return { type: "vercel", Sandbox: VercelSandbox };
  }

  if (process.env.STORE_TYPE === "filesystem") {
    return { type: "local" };
  }

  return { type: "just-bash", python: true, javascript: true };
}

/**
 * True if the runtime has the static access-token triple required by
 * `@vercel/sandbox` for non-OIDC auth. OIDC tokens are delivered as
 * per-request headers and cannot be detected at module init time, so this
 * helper is the strongest auto-detection signal available — operators with
 * OIDC enabled must set `BASH_PROVIDER=vercel` explicitly.
 *
 * See https://vercel.com/docs/vercel-sandbox/concepts/authentication.
 */
function hasVercelSandboxCredentials(): boolean {
  return Boolean(
    process.env.VERCEL_TOKEN &&
      process.env.VERCEL_TEAM_ID &&
      process.env.VERCEL_PROJECT_ID,
  );
}

export const { bashCommand, bashReadFile, bashWriteFile } = createBashBlocks({
  provider: selectBashProvider(),
  createState: (relativePath) => ({
    title: path.basename(relativePath),
    updatedAt: Date.now(),
  }),
});
