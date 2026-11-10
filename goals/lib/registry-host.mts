/**
 * A fresh host app with registry items installed the way an adopter installs
 * them: the registry built from this checkout and served over HTTP, then one
 * `fsdev ui add <items>` into a host shaped as `shadcn init` leaves one.
 *
 * For goals that check what an installed registry component does in a real
 * layout. The host resolves its packages through the registry workspace's own
 * `node_modules` (linked after the install, so the CLI can never write
 * through them), and its shadcn primitives are the registry Storybook's.
 */
import { execFile, execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join } from "node:path";
import { promisify } from "node:util";
import { REPO_ROOT, repoPath } from "./paths.mts";

const execFileAsync = promisify(execFile);
const UI = repoPath("packages", "ui");

export type RegistryHost = {
  /** The host app's root: `components/flow-state/` holds the installed copies, `app/globals.css` the stylesheet. */
  host: string;
  /** Each installed file, as `target → registry source path` (relative to `packages/ui`), through dependencies. */
  shipped: Map<string, string>;
};

/** Serve `dir` at `/r/` on a local port, until `close`. */
async function serveRegistry(dir: string): Promise<{ origin: string; server: Server }> {
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    const file = join(dir, path.replace(/^\/r\//, ""));
    if (!path.startsWith("/r/") || !existsSync(file) || statSync(file).isDirectory()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": extname(file) === ".json" ? "application/json" : "text/plain" }).end(readFileSync(file));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  return { origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server };
}

/** A host the CLI finds everything already listed in, so it installs no package. */
function makeHost(dir: string): void {
  const ui = JSON.parse(readFileSync(join(UI, "package.json"), "utf8")) as Record<string, Record<string, string>>;
  const listed = { ...ui.dependencies, ...ui.devDependencies, ...ui.peerDependencies, cn: "*" };
  const deps = Object.fromEntries(Object.entries(listed).map(([name, range]) => [name, range.startsWith("workspace:") ? "*" : range]));
  mkdirSync(join(dir, "app"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "goal-host", private: true, type: "module", dependencies: deps }, null, 2));
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["./*"] } } }));
  writeFileSync(
    join(dir, "components.json"),
    JSON.stringify({
      $schema: "https://ui.shadcn.com/schema.json",
      style: "new-york",
      rsc: false,
      tsx: true,
      tailwind: { config: "", css: "app/globals.css", baseColor: "neutral", cssVariables: true },
      aliases: { components: "@/components", utils: "@/lib/utils", ui: "@/components/ui" },
    }),
  );
  writeFileSync(join(dir, "app/globals.css"), '@import "tailwindcss";\n');
}

/** Every registry file `items` ship, followed through their registry dependencies. */
function shippedFiles(registryDir: string, origin: string, items: string[]): Map<string, string> {
  const manifest = JSON.parse(readFileSync(join(UI, "registry.json"), "utf8")) as {
    items: Array<{ name: string; files?: Array<{ path: string; target: string }> }>;
  };
  const byName = new Map(manifest.items.map((i) => [i.name, i]));
  const out = new Map<string, string>();
  const seen = new Set<string>();
  const visit = (name: string) => {
    if (seen.has(name)) return;
    seen.add(name);
    const built = JSON.parse(readFileSync(join(registryDir, `${name}.json`), "utf8")) as { registryDependencies: string[] };
    for (const file of byName.get(name)?.files ?? []) out.set(file.target, file.path);
    for (const dep of built.registryDependencies) if (dep.startsWith(`${origin}/r/`)) visit(dep.slice(`${origin}/r/`.length, -".json".length));
  };
  for (const item of items) visit(item);
  return out;
}

/** Link the host's node_modules to the registry workspace's packages. */
function linkModules(dir: string): void {
  const from = join(UI, "node_modules");
  const to = join(dir, "node_modules");
  mkdirSync(to);
  for (const entry of readdirSync(from)) {
    if (entry.startsWith(".")) continue;
    if (entry.startsWith("@")) {
      mkdirSync(join(to, entry));
      for (const scoped of readdirSync(join(from, entry))) symlinkSync(join(from, entry, scoped), join(to, entry, scoped));
    } else {
      symlinkSync(join(from, entry), join(to, entry));
    }
  }
}

/**
 * Build the registry, make a host in `dir`, and install `items` with one
 * `fsdev ui add`. Throws, naming the cause, if the CLI stops to ask, installs
 * a package, or a copy is not its registry source byte for byte.
 */
export async function installRegistryHost(dir: string, items: string[]): Promise<RegistryHost> {
  const registryDir = join(dir, "r");
  const host = join(dir, "host");
  const { origin, server } = await serveRegistry(registryDir);
  try {
    execFileSync("pnpm", ["exec", "tsx", "scripts/build-registry.ts", "--base-url", `${origin}/r`, "--out", registryDir], { cwd: UI, stdio: "ignore" });
    makeHost(host);
    // Asynchronous: the registry is served from this process. Stdin closed, so a prompt can't wait.
    const install = execFileAsync("pnpm", ["fsdev", "ui", "add", ...items, "--registry", `${origin}/r`, "--cwd", host], {
      cwd: REPO_ROOT,
      timeout: 180_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    install.child.stdin?.end();
    const { stdout, stderr } = await install;
    const said = `${stdout}${stderr}`;
    const tail = () => said.trim().split("\n").slice(-15).join("\n");
    const asked = said.match(/[^\n]*Would you like to[^\n?]*\?/g);
    if (asked) throw new Error(`fsdev ui add stopped to ask: ${[...new Set(asked)].join(" | ")}`);
    if (existsSync(join(host, "node_modules"))) throw new Error("the CLI installed packages; the host's package.json is missing one");
    const shipped = shippedFiles(registryDir, origin, items);
    for (const [target, source] of shipped) {
      const copy = join(host, target);
      if (!existsSync(copy)) throw new Error(`${target} was not installed. fsdev ui add said:\n${tail()}`);
      const want = readFileSync(join(UI, source), "utf8");
      const got = readFileSync(copy, "utf8");
      // The shadcn CLI drops the comments above the first statement of a file with no "use client".
      const same = got === want || (!/^["']use client["']/.test(want) && got === want.replace(/^(?:\/\*[\s\S]*?\*\/\s*)+/, ""));
      if (!same) throw new Error(`${target} differs from its registry source ${source}`);
    }
    // The registry Storybook's primitives, in place of the upstream ones the CLI fetched.
    cpSync(join(UI, ".storybook", "shadcn"), host, { recursive: true });
    linkModules(host);
    return { host, shipped };
  } finally {
    server.close();
  }
}

/**
 * The same host as {@link installRegistryHost}, with the items copied from the
 * registry instead of installed by `fsdev ui add`: each item's files, through
 * its registry dependencies, at the targets the manifest names, and the token
 * defaults in the stylesheet. For a machine that cannot reach the shadcn
 * registry the CLI fetches its primitives from; a goal that uses it must say
 * so in its verdict, because it no longer proves the install.
 */
export function copyRegistryHost(dir: string, items: string[]): RegistryHost {
  const host = join(dir, "host");
  makeHost(host);
  const manifest = JSON.parse(readFileSync(join(UI, "registry.json"), "utf8")) as {
    items: Array<{ name: string; registryDependencies: string[]; files?: Array<{ path: string; target: string }> }>;
  };
  const byName = new Map(manifest.items.map((i) => [i.name, i]));
  const shipped = new Map<string, string>();
  const seen = new Set<string>();
  const visit = (name: string) => {
    const item = byName.get(name);
    if (item === undefined || seen.has(name)) return;
    seen.add(name);
    for (const file of item.files ?? []) shipped.set(file.target, file.path);
    for (const dep of item.registryDependencies) visit(dep);
  };
  for (const item of items) visit(item);
  for (const [target, source] of shipped) {
    mkdirSync(join(host, target, ".."), { recursive: true });
    cpSync(join(UI, source), join(host, target));
  }
  writeFileSync(join(host, "app", "globals.css"), `@import "tailwindcss";\n${readFileSync(join(UI, "registry", "token-defaults.css"), "utf8")}`);
  cpSync(join(UI, ".storybook", "shadcn"), host, { recursive: true });
  linkModules(host);
  return { host, shipped };
}
