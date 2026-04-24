/**
 * `fsdev dev` command — starts an HTTP dev server serving the flow API and DevTool UI.
 *
 * Discovers flows from conventional directories, registers them in a FlowRegistry,
 * creates an HTTP server that routes `/api/flows/*` to createFlowApiRouter and
 * serves the DevTool static assets for all other requests.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { exec } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, join, sep } from "node:path";
import type { Command } from "commander";
import type { FlowInstance, ModelResolver } from "@flow-state-dev/core/types";
import {
  createFlowApiRouter,
  createFlowRegistry,
  createFilesystemStores,
  createModelResolver,
} from "@flow-state-dev/server";
import { discoverFlows, getSearchedDirs, type DiscoverFlowsOptions } from "../resolve-flow";
import { CliError } from "../resolve-block";
import { EXIT_SUCCESS, EXIT_DISCOVERY_ERROR, EXIT_CONFIG_ERROR, EXIT_INTERNAL_ERROR } from "../exit-codes";
import { loadEnvFiles } from "../load-env";

/** MIME types for static file serving. */
const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json",
};

interface DevCommandOptions {
  port?: string;
  flowDir?: string[];
  model?: string;
  open?: boolean;
}

/** Commander accumulator for repeatable options. */
function collectValues(value: string, previous: string[] | undefined): string[] {
  return (previous ?? []).concat(value);
}

/** Registers the `dev` subcommand on the given commander program. */
export function registerDevCommand(program: Command): void {
  program
    .command("dev")
    .description("Start the DevTool dev server with auto-discovered flows")
    .option("-p, --port <port>", "Port to listen on", "4200")
    .option("--flow-dir <path>", "Override flow discovery root (repeatable)", collectValues, undefined)
    .option("-m, --model <model>", "Override model for all generator blocks")
    .option("--no-open", "Don't open the browser automatically")
    .action(async (options: DevCommandOptions) => {
      try {
        await executeDevCommand(options);
      } catch (err) {
        if (err instanceof CliError) {
          process.stderr.write(err.message + "\n");
          process.exitCode = err.exitCode;
          return;
        }
        process.stderr.write(
          `Unexpected error: ${err instanceof Error ? err.message : String(err)}\n`,
        );
        process.exitCode = EXIT_INTERNAL_ERROR;
      }
    });
}

/** Core execution logic for `fsdev dev`. */
async function executeDevCommand(options: DevCommandOptions): Promise<void> {
  const port = parseInt(options.port ?? "4200", 10);
  if (isNaN(port) || port < 0 || port > 65535) {
    throw new CliError(`Invalid port: ${options.port}`, EXIT_CONFIG_ERROR);
  }

  // 0. Load .env.local files
  const cwd = process.cwd();
  loadEnvFiles(cwd);

  // 1. Resolve DevTool asset path
  const assetPath = await resolveDevToolAssets();

  // 2. Discover flows
  const discoverOptions: DiscoverFlowsOptions = {
    ...(options.flowDir !== undefined ? { flowDirs: options.flowDir } : {}),
  };
  const flows = await discoverFlows(discoverOptions);

  if (flows.length === 0) {
    const searched = getSearchedDirs(discoverOptions).join(", ");
    throw new CliError(
      `No flows found. Searched: ${searched}\n` +
      `Place flow definitions in src/flows/ or flows/, or use --flow-dir.`,
      EXIT_DISCOVERY_ERROR,
    );
  }

  // 3. Create flow registry
  const registry = createFlowRegistry();
  registry.registerMany(flows as FlowInstance[]);

  // 4. Create stores
  const stores = createFilesystemStores({ rootDir: ".fsdev/data" });

  // 5. Create model resolver
  let modelResolver: ModelResolver | undefined;
  if (options.model !== undefined) {
    const defaultResolver = createModelResolver();
    const override = ((_modelId: string, blockName?: string) => {
      return defaultResolver(options.model!, blockName);
    }) as ModelResolver;
    override.resolveId = (modelId: string) => defaultResolver.resolveId(modelId);
    modelResolver = override;
  }

  // 6. Create flow API router
  const router = createFlowApiRouter({
    registry,
    stores,
    modelResolver,
    onError: (error: Error, context: { method: string; path: string }) => {
      process.stderr.write(`[API error] ${context.method} ${context.path}: ${error.message}\n`);
    },
  });

  // 7. Create HTTP server
  const server = createServer(async (req, res) => {
    const url = req.url ?? "/";

    // Route /api/flows/* to the flow API router
    if (url.startsWith("/api/flows")) {
      await handleApiRequest(req, res, url, router);
      return;
    }

    // Serve static files for everything else
    await serveStaticFile(req, res, url, assetPath);
  });

  // 8. Start listening
  server.listen(port, () => {
    const flowNames = flows.map((f) => f.kind);
    process.stderr.write("\n");
    process.stderr.write(`  DevTool server running at http://localhost:${port}\n`);
    process.stderr.write("\n");
    process.stderr.write(`  Flows:  ${flowNames.join(", ")}\n`);
    process.stderr.write(`  API:    http://localhost:${port}/api/flows\n`);
    process.stderr.write(`  Data:   .fsdev/data/\n`);
    process.stderr.write("\n");

    if (options.open !== false) {
      openBrowser(`http://localhost:${port}`);
    }
  });

  // Keep process alive and handle graceful shutdown
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stderr.write("\nShutting down...\n");
    server.close();
    process.exit(EXIT_SUCCESS);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

/**
 * Resolves the DevTool static assets directory.
 * Tries the published @flow-state-dev/devtool package first,
 * then falls back to a local monorepo build.
 */
async function resolveDevToolAssets(): Promise<string> {
  // Try the @flow-state-dev/devtool package
  try {
    const devtoolPkg = await import("@flow-state-dev/devtool");
    return devtoolPkg.getAssetPath();
  } catch {
    // Not installed or assets not built — try fallback
  }

  // Monorepo fallback: apps/devtool/dist or packages/devtool/dist-client
  const monorepoFallbacks = [
    resolve(process.cwd(), "apps/devtool/dist"),
    resolve(process.cwd(), "packages/devtool/dist-client"),
  ];

  for (const candidate of monorepoFallbacks) {
    if (existsSync(resolve(candidate, "index.html"))) {
      return candidate;
    }
  }

  throw new CliError(
    "DevTool assets not found. Install @flow-state-dev/devtool or build the devtool app:\n" +
    "  pnpm add @flow-state-dev/devtool\n" +
    "  # or in the monorepo: cd apps/devtool && pnpm build",
    EXIT_CONFIG_ERROR,
  );
}

/**
 * Converts a Node.js IncomingMessage to a Web API Request,
 * dispatches it to the flow API router, and writes the Response back.
 */
async function handleApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  url: string,
  router: ReturnType<typeof createFlowApiRouter>,
): Promise<void> {
  const method = (req.method ?? "GET").toUpperCase();

  // Extract path segments after /api/flows
  const pathAfterPrefix = url.replace(/^\/api\/flows\/?/, "");
  const [pathPart] = pathAfterPrefix.split("?", 2);
  const pathSegments = pathPart
    .split("/")
    .filter((s) => s.length > 0);

  // Build full URL for the Web API Request
  const fullUrl = `http://localhost${url}`;

  // Read request body for POST/PATCH (the router supports GET, POST, PATCH, DELETE)
  let body: string | undefined;
  if (method === "POST" || method === "PATCH") {
    body = await readRequestBody(req);
  }

  // Build Web API Request
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value !== undefined) {
      headers.set(key, Array.isArray(value) ? value.join(", ") : value);
    }
  }

  const webRequest = new Request(fullUrl, {
    method,
    headers,
    body: body !== undefined ? body : undefined,
  });

  // Dispatch to the appropriate router method
  const handler = router[method as keyof typeof router];
  if (handler === undefined) {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  try {
    const webResponse = await handler(webRequest, {
      params: { path: pathSegments },
    });

    // Write status and headers
    res.writeHead(webResponse.status, Object.fromEntries(webResponse.headers.entries()));

    // Handle SSE streaming responses
    const contentType = webResponse.headers.get("content-type") ?? "";
    if (contentType.includes("text/event-stream") && webResponse.body !== null) {
      // Stream the response body
      const reader = webResponse.body.getReader();
      const decoder = new TextDecoder();

      // Disable buffering for SSE
      res.flushHeaders();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          res.write(chunk);
        }
        // Flush any buffered bytes from incomplete multibyte sequences
        const finalChunk = decoder.decode();
        if (finalChunk) res.write(finalChunk);
      } catch (streamErr) {
        // Client disconnect is expected; log other errors for debugging
        if (streamErr instanceof Error && streamErr.name !== "AbortError") {
          process.stderr.write(`[SSE stream error] ${streamErr.message}\n`);
        }
      } finally {
        res.end();
      }
      return;
    }

    // Regular response: read body and write
    const responseBody = await webResponse.text();
    res.end(responseBody);
  } catch (err) {
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        error: "Internal server error",
        message: err instanceof Error ? err.message : String(err),
      }));
    }
  }
}

/** Reads the full request body as a string. */
function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

/** Serves a static file from the DevTool asset directory. */
async function serveStaticFile(
  _req: IncomingMessage,
  res: ServerResponse,
  url: string,
  assetDir: string,
): Promise<void> {
  // Strip query string
  const cleanUrl = url.split("?")[0];

  // Resolve to a file path within the asset directory
  let filePath: string;
  if (cleanUrl === "/" || cleanUrl === "") {
    filePath = join(assetDir, "index.html");
  } else {
    // Prevent directory traversal — ensure resolved path is strictly inside assetDir
    const normalized = resolve(assetDir, "." + cleanUrl);
    if (normalized !== assetDir && !normalized.startsWith(assetDir + sep)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    filePath = normalized;
  }

  try {
    const fileStat = await stat(filePath);

    if (fileStat.isDirectory()) {
      filePath = join(filePath, "index.html");
      await stat(filePath); // Verify index.html exists
    }

    const content = await readFile(filePath);
    const ext = extname(filePath);
    const mimeType = MIME_TYPES[ext] ?? "application/octet-stream";

    res.writeHead(200, { "Content-Type": mimeType });
    res.end(content);
  } catch {
    // SPA fallback: serve index.html for unmatched routes
    try {
      const indexPath = join(assetDir, "index.html");
      const content = await readFile(indexPath);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  }
}

/** Opens a URL in the default browser (best-effort, non-blocking). */
function openBrowser(url: string): void {
  const platform = process.platform;

  const command =
    platform === "darwin" ? `open "${url}"` :
    platform === "win32" ? `start "" "${url}"` :
    `xdg-open "${url}"`;

  exec(command, () => {
    // Ignore errors — browser opening is best-effort
  });
}
