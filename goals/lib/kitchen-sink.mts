/**
 * The kitchen-sink app, built and served for a goal that reads its page in a
 * real browser, and the page's own handles as a person uses them.
 *
 * Kept out of `index.mts` for the reason `playwright.mts` is: most goals never
 * open a browser. Import it directly:
 *
 *   import { buildKitchenSink, startKitchenSink, openShell } from "../../lib/kitchen-sink.mts";
 *
 * What a goal grades stays in its `run.mts`. This holds only the scaffolding
 * the `kitchen-sink-talk` goals repeat: the production build, `next start` on
 * the scripted model and the in-memory store, and the rail and panel locators.
 */
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import type { Locator, Page } from "playwright";
import { intentFreeEnv } from "./env.mts";
import { KITCHEN_SINK, REPO_ROOT } from "./paths.mts";

// ---------------------------------------------------------------------------
// The built app
// ---------------------------------------------------------------------------

/**
 * Build the packages the app imports, then the app itself in test mode, so a
 * check grades this checkout and not a `.next` or a `dist` an earlier branch
 * left behind.
 */
export function buildKitchenSink(): void {
  execFileSync("pnpm", ["exec", "turbo", "run", "build", "--filter=@flow-state-dev/kitchen-sink^..."], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
  execFileSync("pnpm", ["build"], {
    cwd: KITCHEN_SINK,
    stdio: "inherit",
    env: { ...process.env, NEXT_PUBLIC_KITCHEN_SINK_TEST_MODE: "1" },
  });
}

/** A running production server. */
export interface KitchenSinkServer {
  /** `http://127.0.0.1:<port>`. */
  readonly origin: string;
  /** Everything the server has written to stdout and stderr so far. */
  log(): string;
  /** Stop the server. Safe to call twice. */
  stop(): void;
}

async function flowIndexStatus(origin: string): Promise<number | undefined> {
  try {
    return (await fetch(`${origin}/api/flows`)).status;
  } catch {
    return undefined;
  }
}

/**
 * Serve the built app with `next start`, on the scripted model and the
 * in-memory store. A control reaches the server through the same environment;
 * the app honours one only in test mode.
 *
 * @param port The port to serve on. Refused if something already answers there.
 * @param env Extra environment for the server, e.g. `{ AI_GATEWAY_API_KEY: "" }` to run keyless.
 */
export async function startKitchenSink(port: number, env: Record<string, string> = {}): Promise<KitchenSinkServer> {
  const origin = `http://127.0.0.1:${port}`;
  if ((await flowIndexStatus(origin)) !== undefined) {
    throw new Error(`something is already answering on ${origin}; stop it first, or this check would grade it`);
  }
  let log = "";
  // Detached, so the kill reaches `next start` and not only the pnpm shim.
  let server: ChildProcess | undefined = spawn("pnpm", ["exec", "next", "start", "--port", String(port)], {
    cwd: KITCHEN_SINK,
    env: intentFreeEnv(process.env, { KITCHEN_SINK_TEST_MODE: "1", STORE_TYPE: "memory", ...env }),
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  server.stdout?.on("data", (chunk: Buffer) => (log += chunk.toString()));
  server.stderr?.on("data", (chunk: Buffer) => (log += chunk.toString()));
  const handle: KitchenSinkServer = {
    origin,
    log: () => log,
    stop: () => {
      if (server?.pid !== undefined) {
        try {
          process.kill(-server.pid, "SIGTERM");
        } catch {
          // already gone
        }
      }
      server = undefined;
    },
  };
  for (let i = 0; i < 180; i += 1) {
    if ((await flowIndexStatus(origin)) === 200) return handle;
    if (server.exitCode !== null) throw new Error(`the app exited (${server.exitCode}) before serving:\n${log}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  handle.stop();
  throw new Error(`the built app never served ${origin}/api/flows:\n${log}`);
}

// ---------------------------------------------------------------------------
// The page, as a person uses it
// ---------------------------------------------------------------------------

/** The rail. */
export const rail = (page: Page): Locator => page.getByTestId("rail");

/** A kind's or an instance's row in the rail, by its exact name. */
export const row = (page: Page, name: string): Locator => rail(page).getByRole("button", { name, exact: true });

/** The picked panel. The page draws the stream twice, one hidden by width. */
export const panel = (page: Page): Locator => page.locator('[data-testid="picked-session"]:visible');

/** Load the page and wait until it can be used. */
export async function openShell(page: Page, origin: string): Promise<void> {
  await page.goto(`${origin}/`);
  await page.locator('[data-testid="message-input"]:visible').waitFor({ state: "visible", timeout: 30_000 });
}

/** Open a row, unless it is already open. */
export async function open(page: Page, name: string): Promise<void> {
  const button = row(page, name);
  await button.waitFor({ timeout: 15_000 });
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
}

/** Press "New conversation" on a seat's row and wait for the panel. */
export async function newConversation(page: Page, seat: string): Promise<void> {
  await rail(page)
    .locator(`[data-instance-id="${seat}"]`)
    .locator("xpath=..")
    .getByRole("button", { name: "New conversation" })
    .click();
  await panel(page).waitFor({ timeout: 15_000 });
}

/** Poll `read` until `done` holds, or the time is up; return the last reading either way. */
export async function readUntil<T>(read: () => Promise<T>, done: (value: T) => boolean, ms = 15_000): Promise<T> {
  let value = await read();
  for (let waited = 0; !done(value) && waited < ms; waited += 250) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    value = await read();
  }
  return value;
}

/** The picked conversation as drawn: each message's role and text, in order. */
export const conversation = (page: Page): Promise<Array<{ role: string; text: string }>> =>
  panel(page)
    .locator("[data-message-role]")
    .evaluateAll((messages) =>
      messages.map((message) => ({
        role: message.getAttribute("data-message-role") ?? "",
        text: message.textContent ?? "",
      })),
    );
