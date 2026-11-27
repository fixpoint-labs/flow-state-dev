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
 * Kitchen Sink goals repeat: building and serving the app and reading its
 * browser panels.
 */
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import type { Locator, Page } from "playwright";
import { intentFreeEnv } from "./env.mts";
import { KITCHEN_SINK, REPO_ROOT } from "./paths.mts";
import { onClosed, refuseIfAnswering, stopProcessGroup } from "./server.mts";
import { sleep } from "./time.mts";

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

/** A running Kitchen Sink server. */
export interface KitchenSinkServer {
  /** `http://127.0.0.1:<port>`. */
  readonly origin: string;
  /** The spawned `pnpm` shim, leader of the server's own process group: what `crashAndRestart` kills. */
  readonly child: ChildProcess;
  /** Resolves when the server command exits. */
  readonly exited: Promise<void>;
  /** Everything the server has written to stdout and stderr so far. */
  log(): string;
  /** Stop the server. Safe to call twice. */
  stop(): void;
}

/** Serve the production build on the scripted model and in-memory store by default. */
export function startKitchenSink(port: number, env: Record<string, string> = {}): Promise<KitchenSinkServer> {
  return serveKitchenSink("start", port, intentFreeEnv(process.env, {
    KITCHEN_SINK_TEST_MODE: "1",
    STORE_TYPE: "memory",
    ...env
  }));
}

/** Serve the development build with the supplied harness and store settings. */
export function startKitchenSinkDev(port: number, env: NodeJS.ProcessEnv): Promise<KitchenSinkServer> {
  return serveKitchenSink("dev", port, { ...env, NODE_ENV: "development", STORE_TYPE: "filesystem" });
}

/** Serve the harness UI in test mode with real coding harnesses. */
export function startKitchenSinkHarness(port: number, control: string, workspace?: string): Promise<KitchenSinkServer> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    KITCHEN_SINK_TEST_MODE: "1",
    NEXT_PUBLIC_KITCHEN_SINK_TEST_MODE: "1",
    KITCHEN_SINK_REAL_HARNESS: "1",
    ...(control === "" ? {} : { GOAL_CONTROL: control })
  };
  if (workspace === undefined) delete env.KITCHEN_SINK_HARNESS_WORKSPACE;
  else env.KITCHEN_SINK_HARNESS_WORKSPACE = workspace;
  return startKitchenSinkDev(port, env);
}

async function serveKitchenSink(mode: "dev" | "start", port: number, env: NodeJS.ProcessEnv): Promise<KitchenSinkServer> {
  const origin = `http://127.0.0.1:${port}`;
  const readiness = `${origin}/api/flows`;
  await refuseIfAnswering(mode === "dev" ? origin : readiness);

  const child = spawn("pnpm", ["exec", "next", mode, "--port", String(port)], {
    cwd: KITCHEN_SINK,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true
  });
  let log = "";
  let error: Error | undefined;
  child.stdout.on("data", (chunk: Buffer) => { log += chunk.toString(); });
  child.stderr.on("data", (chunk: Buffer) => { log += chunk.toString(); });
  child.once("error", (cause) => { error = cause; });
  const exited = new Promise<void>((resolve) => onClosed(child, () => resolve()));
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    stopProcessGroup(child);
  };

  try {
    const deadline = Date.now() + (mode === "dev" ? 120_000 : 90_000);
    while (Date.now() < deadline) {
      const status = await fetch(readiness, { signal: AbortSignal.timeout(2_000) }).then(
        (response) => {
          void response.body?.cancel().catch(() => undefined);
          return response.status;
        },
        () => undefined
      );
      if (error !== undefined) throw error;
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`next ${mode} exited (${child.exitCode ?? child.signalCode}):\n${log}`);
      }
      if (status === 200) return { origin, child, log: () => log, exited, stop };
      await sleep(500);
    }
    throw new Error(`next ${mode} never served ${readiness}:\n${log}`);
  } catch (cause) {
    stop();
    throw cause;
  }
}

// ---------------------------------------------------------------------------
// The page, as a person uses it
// ---------------------------------------------------------------------------

/** The harness conversation bound to the current session, as shown by the page. */
export async function boundId(page: Page): Promise<string> {
  return ((await page.getByTestId("bound-conversation").textContent()) ?? "").trim();
}

/** Wait for a reloaded harness page to draw its saved conversation binding. */
export async function loadedBoundId(page: Page): Promise<string> {
  await page.waitForFunction(
    () => {
      const text = document.querySelector('[data-testid="bound-conversation"]')?.textContent?.trim();
      return text !== undefined && text !== "none yet";
    },
    undefined,
    { timeout: 30_000 }
  ).catch(() => undefined);
  return boundId(page);
}

/** How often a token appears in the harness conversation. */
export async function tokenCount(page: Page, token: string): Promise<number> {
  const text = (await page.getByTestId("conversation").textContent()) ?? "";
  return text.split(token).length - 1;
}

export const stopButton = (page: Page) => page.getByRole("button", { name: "Stop" });

/** The rail. */
export const rail = (page: Page): Locator => page.getByTestId("rail");

/** A kind's or an instance's row in the rail, by its exact name. */
export const row = (page: Page, name: string): Locator => rail(page).getByRole("button", { name, exact: true });

/** The picked panel. The page draws the stream twice, one hidden by width. */
export const panel = (page: Page): Locator => page.locator('[data-testid="picked-session"]:visible');

/** Load the page and wait until it can be used. */
export async function openShell(page: Page, origin: string): Promise<void> {
  await page.goto(`${origin}/flow-state`);
  await page.locator('[data-testid="message-input"]:visible').waitFor({ state: "visible", timeout: 30_000 });
}

/** Open a row, unless it is already open. */
export async function open(page: Page, name: string): Promise<void> {
  const button = row(page, name);
  await button.waitFor({ timeout: 15_000 });
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
}

/**
 * Press "Talk" on a worker's row in the roster panel, which opens the person's
 * conversation with that worker (found or started), and wait for the panel.
 */
export async function talkTo(page: Page, worker: string): Promise<void> {
  await page.locator(`[data-testid="roster"]:visible [data-worker-id="${worker}"]`).getByTestId("roster-talk").click();
  await panel(page).waitFor({ timeout: 15_000 });
}

/** The flow every specialist runs on, registered as one copy at its kind. */
export const WORKER_FLOW = "agent";

/** The coordinator flow's kind, whose rail row opens into the person's conversation with each coordinator. */
export const COORDINATOR_FLOW = "coordinator";

/**
 * Open the worker flow's kind and its one copy in the rail, unless already
 * open, and wait for the copy's list to load. Every worker's sessions are
 * listed there, each one a session that names its worker.
 */
export async function openWorkerCopy(page: Page): Promise<Locator> {
  for (const button of [
    rail(page).locator(`button[data-kind="${WORKER_FLOW}"]`),
    rail(page).locator(`button[data-instance-id="${WORKER_FLOW}"]`),
  ]) {
    await button.waitFor({ timeout: 15_000 });
    if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
  }
  const leaf = rail(page).locator(`ul[data-leaf="${WORKER_FLOW}"]`);
  await leaf.waitFor({ timeout: 15_000 });
  await readUntil(
    async () => (await leaf.locator("[data-session-id]").count()) + (await leaf.getByText("No sessions yet").count()),
    (n) => n > 0,
    10_000,
  );
  return leaf;
}

/** Show the person's conversation with `coordinator` in the panel, from the rail. */
export async function showCoordinator(page: Page, coordinator: string): Promise<void> {
  await open(page, COORDINATOR_FLOW);
  await row(page, coordinator).click();
  await panel(page).getByTestId("coordinator-transcript").waitFor({ timeout: 15_000 });
}

/** One of a worker's sessions, as the server lists it. */
export interface WorkerSession {
  id: string;
  parentSessionId?: string | null;
}

/**
 * The person's sessions with `worker` on `flow`, as the server lists them by
 * the session's readonly `workerId`; with `runs`, the sessions a coordinator's
 * post started for it too. An index, never graded: what each session holds is
 * read on the page.
 */
export async function workerSessions(
  page: Page,
  origin: string,
  worker: string,
  options: { runs?: boolean; flow?: string; user?: string } = {},
): Promise<WorkerSession[]> {
  const query = new URLSearchParams({
    flowId: options.flow ?? WORKER_FLOW,
    userId: options.user ?? "devuser",
    "state.workerId": worker,
    limit: "100",
    ...(options.runs === true ? { include: "dispatch-runs" } : {}),
  });
  const res = await page.request.get(`${origin}/api/flows/sessions?${query}`);
  if (!res.ok()) throw new Error(`the sessions of ${worker} could not be listed: ${res.status()} ${await res.text()}`);
  return ((await res.json()) as { sessions: WorkerSession[] }).sessions;
}

/** The person's conversation with `coordinator`: the one session the rail opens. An index, never graded. */
export async function coordinatorConversation(page: Page, origin: string, coordinator: string): Promise<string | undefined> {
  const sessions = await workerSessions(page, origin, coordinator, { flow: COORDINATOR_FLOW });
  if (sessions.length > 1) throw new Error(`the person has ${sessions.length} conversations with ${coordinator} (want at most 1)`);
  return sessions[0]?.id;
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
