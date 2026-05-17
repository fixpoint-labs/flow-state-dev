/**
 * Vercel Sandbox adapter.
 *
 * Wraps a `@vercel/sandbox` `Sandbox` class behind the framework's
 * `Sandbox` interface. The class is passed in via the provider config
 * (`{ type: "vercel", Sandbox: ... }`) — the framework intentionally does
 * not take a peer dependency on `@vercel/sandbox` itself. The consumer's
 * own static `import` of the SDK is what bundlers and Vercel's file
 * tracer follow to ship the package and its transitive deps to the
 * deployment.
 *
 * Supports both ephemeral and persistent sandboxes — pass an existing
 * `sandboxId` to reconnect.
 */

import type {
  Sandbox,
  CommandResult,
  VercelSandboxClassLike,
  VercelSandboxInstance,
} from "../types";

/**
 * Wrap a Vercel sandbox instance into the framework's `Sandbox` interface.
 *
 * Bash command lines are run through `sh -c "..."` so shell features
 * (pipes, redirects, env-var expansion) work the same way they do on
 * other adapters. `readFile`/`writeFile` map to `readFileToBuffer`/
 * `writeFiles` since those are the byte-oriented methods on the SDK.
 */
export function createVercelAdapter(
  sandbox: VercelSandboxInstance,
  sandboxId?: string,
): Sandbox {
  // Every call into the live sandbox can throw the SDK's APIError shape
  // (e.g. 400 from /fs/write with a useful body in `.json.error.message`).
  // Without enrichment the framework only sees `Status code N is not ok`,
  // which is unactionable in deploy logs and chat UIs. Wrap every method
  // so runtime failures get the same body-inlined treatment that
  // resolveVercelSandbox already gives to create()/get(). The operation
  // label is passed through so a 400 from `/fs/write` doesn't get the
  // OIDC credentials hint that only fires for create/get.
  async function wrap<T>(op: ResolveOp, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      throw enrichVercelError(err, { op, sandboxId });
    }
  }

  return {
    async executeCommand(command: string): Promise<CommandResult> {
      return wrap("runCommand", async () => {
        const result = await sandbox.runCommand("sh", ["-c", command]);
        const [stdout, stderr] = await Promise.all([
          result.stdout(),
          result.stderr(),
        ]);
        return {
          stdout,
          stderr,
          exitCode: result.exitCode ?? 0,
        };
      });
    },

    async readFile(filePath: string): Promise<string> {
      return wrap("readFileToBuffer", async () => {
        const buf = await sandbox.readFileToBuffer({ path: filePath });
        if (buf === null) {
          throw new Error(`File not found: ${filePath}`);
        }
        return buf.toString("utf-8");
      });
    },

    async writeFile(filePath: string, content: string): Promise<void> {
      return wrap("writeFiles", async () => {
        await sandbox.writeFiles([{ path: filePath, content }]);
      });
    },

    async stop(): Promise<void> {
      await wrap("stop", () => sandbox.stop());
    },
  };
}

/**
 * Resolve a Vercel sandbox — reconnect to an existing one via `sandboxId`
 * or provision a new one via `Sandbox.create(createOptions)`.
 *
 * Wraps `APIError`s from the SDK with the response body so deploy logs
 * carry the actionable detail instead of just `Status code 400 is not ok`.
 *
 * @returns The adapter sandbox and the resolved sandbox ID for persistence.
 */
export async function resolveVercelSandbox(opts: {
  Sandbox: VercelSandboxClassLike;
  sandboxId?: string;
  createOptions?: unknown;
}): Promise<{ sandbox: Sandbox; sandboxId: string }> {
  try {
    if (opts.sandboxId) {
      const raw = await opts.Sandbox.get({ sandboxId: opts.sandboxId });
      return {
        sandbox: createVercelAdapter(raw, opts.sandboxId),
        sandboxId: opts.sandboxId,
      };
    }

    const raw = await opts.Sandbox.create(opts.createOptions);
    return {
      sandbox: createVercelAdapter(raw, raw.sandboxId),
      sandboxId: raw.sandboxId,
    };
  } catch (err) {
    const op: ResolveOp = opts.sandboxId ? "get" : "create";
    throw enrichVercelError(err, { op, sandboxId: opts.sandboxId });
  }
}

/**
 * Which SDK call was in flight when the error was thrown. Used to label
 * the enriched message and to decide whether the OIDC-credentials hint
 * is relevant — auth failures only happen on `create`/`get`, never on
 * runtime calls against an already-authenticated sandbox.
 */
type ResolveOp =
  | "create"
  | "get"
  | "runCommand"
  | "readFileToBuffer"
  | "writeFiles"
  | "stop";

interface EnrichContext {
  op: ResolveOp;
  sandboxId?: string;
}

function formatAction(ctx: EnrichContext): string {
  switch (ctx.op) {
    case "create":
      return "create()";
    case "get":
      return ctx.sandboxId
        ? `get(sandboxId="${ctx.sandboxId}")`
        : "get()";
    default:
      // runCommand / readFileToBuffer / writeFiles / stop — runtime ops
      // against the already-resolved sandbox. Include the sandboxId so
      // logs can correlate failures to a specific sandbox.
      return ctx.sandboxId
        ? `${ctx.op}(sandboxId="${ctx.sandboxId}")`
        : `${ctx.op}()`;
  }
}

/**
 * Wrap raw errors from `@vercel/sandbox` with diagnostic detail that's
 * meaningful in deploy logs and the chat UI. Detection is structural — we
 * don't import the SDK's error classes to avoid taking a peer dep at the
 * framework level.
 *
 * Three paths:
 *
 *   1. **APIError with a `.response.status`.** The SDK ships the upstream
 *      body on `.json`/`.text` but its `.message` is just the statusText
 *      (e.g. `Status code 400 is not ok`). Re-throw with the body inlined
 *      and a credentials hint when the status looks auth-related *and*
 *      the failing op was `create`/`get` — runtime ops against an
 *      already-resolved sandbox never fail for OIDC reasons, so the
 *      credentials suggestion would mislead operators diagnosing
 *      e.g. a 400 from `/fs/write`.
 *   2. **`VercelOidcContextError` / `LocalOidcContextError`.** Thrown
 *      before any HTTP call when the SDK can't resolve an OIDC token at
 *      call time (Vercel deployment without OIDC Federation enabled, or
 *      local dev with `BASH_PROVIDER=vercel` but no static triple). These
 *      have no `.response.status`, so without detection by name they'd
 *      slip through as bare SDK messages. Surfaces the three remediation
 *      paths in one actionable error.
 *   3. **Anything else.** Returned as-is (already an Error). Non-Error
 *      throwables (strings, plain objects) are wrapped via `new Error(...)`.
 */
function enrichVercelError(err: unknown, ctx: EnrichContext): Error {
  if (!(err instanceof Error)) return new Error(String(err));

  const sdkErr = err as Error & {
    response?: { status?: number; statusText?: string };
    json?: unknown;
    text?: string;
  };

  const action = formatAction(ctx);
  const isResolveOp = ctx.op === "create" || ctx.op === "get";
  const status = sdkErr.response?.status;

  if (status !== undefined) {
    const detail =
      (sdkErr.json && JSON.stringify(sdkErr.json)) ||
      sdkErr.text ||
      sdkErr.response?.statusText ||
      "(no response body)";

    const hint =
      isResolveOp && (status === 400 || status === 401 || status === 403)
        ? " — likely an OIDC / credentials problem. Confirm OIDC is enabled on the Vercel project (Project Settings → OIDC) and that the team has Vercel Sandbox enabled."
        : "";

    return new Error(
      `Vercel Sandbox.${action} failed with status ${status}: ${detail}${hint}`,
      { cause: err },
    );
  }

  // Error.prototype.name defaults to "Error", so a `??` would never reach
  // the constructor name. Subclasses that don't set `this.name` (e.g.
  // `class VercelOidcContextError extends Error {}`) still inherit "Error";
  // for those, fall back to the constructor's name.
  const errName =
    sdkErr.name && sdkErr.name !== "Error"
      ? sdkErr.name
      : sdkErr.constructor?.name ?? "Error";
  const isOidcContextError =
    errName === "VercelOidcContextError" ||
    errName === "LocalOidcContextError" ||
    (typeof sdkErr.message === "string" && /OIDC.*token/i.test(sdkErr.message));

  if (isOidcContextError) {
    return new Error(
      `Vercel Sandbox.${action} failed: no OIDC token available. ` +
        `Either enable OIDC Federation on the Vercel project (Project Settings → ` +
        `OIDC Token Generation), or set VERCEL_TOKEN + VERCEL_TEAM_ID + ` +
        `VERCEL_PROJECT_ID, or set BASH_PROVIDER=just-bash to disable the Vercel ` +
        `adapter. See https://vercel.com/docs/vercel-sandbox/concepts/authentication.`,
      { cause: err },
    );
  }

  return err;
}
