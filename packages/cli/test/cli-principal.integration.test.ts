/**
 * Who a terminal run is. `fsdev run` and `fsdev chat` ask the loaded app the
 * question its HTTP routes ask, instead of answering for themselves.
 *
 * Why these matter: a CLI that runs in a different organization from the app
 * writes records the app's own users can never read, so nothing
 * organization-shaped can be verified from the terminal. Every check below
 * compares what the terminal did against what the app itself would do, or
 * against what is actually in the store — never against the CLI's own report.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Readable, Writable } from "node:stream";
import { Command } from "commander";
import { createInMemoryStores, runAction, type FlowState, type StoreRegistry } from "@flow-state-dev/engine";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { executeRunCommand, registerRunCommand } from "../src/commands/run";
import { executeChatCommand, registerChatCommand } from "../src/commands/chat";
import { registerServeCommand } from "../src/commands/serve";
import { registerDevCommand } from "../src/commands/dev";
import { CliError } from "../src/resolve-block";
import { EXIT_INVALID_ARGS } from "../src/exit-codes";
import { APP_ORG, APP_USER, SEAT_ID, makeApp, resetSharedStores, sharedStores } from "./fixtures-principal/app";

const appDir = resolve(import.meta.dirname, "fixtures-principal");
const discoveryDir = resolve(import.meta.dirname, "fixtures");

let stdoutLines: string[];
let stderrLines: string[];
const originalStdoutWrite = process.stdout.write;
const originalStderrWrite = process.stderr.write;
const open: FlowState[] = [];

beforeEach(() => {
  resetSharedStores();
  stdoutLines = [];
  stderrLines = [];
  const collect = (into: string[]) =>
    vi.fn((chunk: unknown) => {
      for (const line of String(chunk).split("\n")) if (line.trim().length > 0) into.push(line);
      return true;
    }) as unknown as typeof process.stdout.write;
  process.stdout.write = collect(stdoutLines);
  process.stderr.write = collect(stderrLines);
  process.exitCode = undefined;
});

afterEach(async () => {
  process.stdout.write = originalStdoutWrite;
  process.stderr.write = originalStderrWrite;
  process.exitCode = undefined;
  while (open.length > 0) await open.pop()!.dispose().catch(() => undefined);
});

/** The same app the terminal loaded, for asking its HTTP router. */
async function appRouter() {
  const app = makeApp();
  open.push(app);
  return { router: await app.getRouter(), stores: sharedStores() };
}

type Router = Awaited<ReturnType<FlowState["getRouter"]>>;

async function http(router: Router, method: "GET" | "POST", path: string, body?: unknown) {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "content-type": "application/json" };
  }
  const res = await router[method](new Request(`http://app.local/api/flows/${path}`, init), {
    params: { path: path.split("/").filter((s) => s.length > 0) },
  });
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

/** `fsdev run`, reporting the thrown refusal instead of raising it. */
async function run(flow: string, options: Parameters<typeof executeRunCommand>[2]) {
  return executeRunCommand(flow, "respond", { cwd: appDir, input: '{"message":"hi"}', ...options }).then(
    (result) => ({ ok: true as const, result }),
    (error: unknown) => ({ ok: false as const, error: error as CliError }),
  );
}

function session(stores: StoreRegistry, id: string) {
  return stores.session.get(id);
}

describe("V1 · fsdev run binds to the app's organization", () => {
  it("runs as the app's resolver says, seeds and records under that identity", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fsdev-principal-"));
    try {
      const capture = join(dir, "run.json");
      const outcome = await run("echo", { session: "v1", seedSession: '{"seeded":true}', capture });
      expect(outcome.ok).toBe(true);

      const payload = JSON.parse(readFileSync(capture, "utf-8"));
      expect(payload.command.principal).toEqual({ userId: APP_USER, orgId: APP_ORG, from: "resolver" });

      // The store decides, not the CLI's report: the session is the app's.
      const stored = await session(sharedStores(), "v1");
      expect(stored).toMatchObject({ userId: APP_USER, orgId: APP_ORG, state: { seeded: true } });

      // And the app's own router can read it, which is the point.
      const { router } = await appRouter();
      const read = await http(router, "GET", "sessions/v1");
      expect(read.status).toBe(200);

      // One stderr line names the organization; stdout stays NDJSON.
      expect(stderrLines.filter((l) => l.startsWith("[fsdev] running as"))).toEqual([
        `[fsdev] running as ${APP_USER} in organization ${APP_ORG} (from the app's resolver)`,
      ]);
      expect(() => stdoutLines.map((l) => JSON.parse(l))).not.toThrow();
      expect(stdoutLines.some((l) => l.includes("[fsdev]"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("with no resolver anywhere, stays cli-user in the development organization (BR-2)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fsdev-principal-"));
    try {
      const stores = createInMemoryStores();
      const capture = join(dir, "run.json");
      const result = await executeRunCommand("echo", "respond", {
        cwd: discoveryDir,
        input: '{"message":"hi"}',
        session: "v2",
        stores,
        capture,
      });
      expect(result.success).toBe(true);
      expect(await session(stores, "v2")).toMatchObject({ userId: "cli-user", orgId: DEFAULT_ORG_ID });
      expect(JSON.parse(readFileSync(capture, "utf-8")).command.principal).toEqual({
        userId: "cli-user",
        orgId: DEFAULT_ORG_ID,
        from: "development-default",
      });
      // The host's once-per-deployment warning is not repeated on the terminal.
      expect(stderrLines.some((l) => l.includes("no authentication.resolvePrincipal is configured"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("V3 · the terminal's outcome equals the app's action route, flow by flow", () => {
  it("same identity, or the same refusal, for every resolver shape", async () => {
    const { router, stores } = await appRouter();
    const rows: Record<string, { cli: string; http: string }> = {};
    for (const flow of ["echo", "admin", "digest", "placeholder", "bodyorg"]) {
      const cli = await run(flow, { session: `v3-${flow}` });
      let cliOutcome: string;
      if (cli.ok) {
        const stored = await session(stores, `v3-${flow}`);
        cliOutcome = `ok ${stored?.userId}@${stored?.orgId}`;
      } else {
        // The CLI wraps the resolver's refusal; compare the refusal itself.
        const match = /refused this terminal: (.*)\n/.exec(cli.error.message);
        cliOutcome = `refused: ${match?.[1] ?? cli.error.message}`;
      }

      // A credential-less HTTP caller naming the same user, action and input.
      const res = await http(router, "POST", `${flow}/actions/respond`, {
        userId: "cli-user",
        input: { message: "hi" },
      });
      let httpOutcome: string;
      if (res.status < 300 && typeof res.json?.request?.id === "string") {
        let request: { userId?: string; orgId?: string } | undefined;
        for (let i = 0; i < 50 && request === undefined; i++) {
          request = (await stores.request.get(res.json.request.id)) as typeof request;
          if (request === undefined) await new Promise((r) => setTimeout(r, 10));
        }
        httpOutcome = `ok ${request?.userId}@${request?.orgId}`;
      } else {
        // Statuses are not compared: the route maps a missing user to a legacy 400.
        httpOutcome = `refused: ${res.json?.error}`;
      }
      rows[flow] = { cli: cliOutcome, http: httpOutcome };
    }

    expect(rows.echo!.cli).toBe(`ok ${APP_USER}@${APP_ORG}`);
    // A resolver that reads the action body's input sees the same body both ways.
    expect(rows.bodyorg!.cli).toBe("ok body-user@org-hi");
    for (const flow of Object.keys(rows)) expect(rows[flow]!.cli, flow).toBe(rows[flow]!.http);
    // Every refused row really is a refusal, so the equality above is not two
    // empty strings agreeing.
    for (const flow of ["admin", "digest", "placeholder"]) {
      expect(rows[flow]!.cli, flow).toMatch(/^refused: \S/);
    }
  });
});

describe("V4 · a refused run writes nothing", () => {
  it("stops before the seed and the run, exits 2, and names the flow and --org", async () => {
    const outcome = await run("admin", { session: "v4", seedSession: '{"seeded":true}' });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toBeInstanceOf(CliError);
    expect(outcome.error.exitCode).toBe(EXIT_INVALID_ARGS);
    expect(outcome.error.message).toContain('Flow "admin"');
    expect(outcome.error.message).toContain("--org");

    expect(await session(sharedStores(), "v4")).toBeUndefined();
    expect(await sharedStores().request.list({ sessionId: "v4" })).toEqual([]);
  });
});

describe("V5 · what a developer can name", () => {
  it("--org skips the resolver: a credential-checking flow runs in the named org", async () => {
    const outcome = await run("admin", { session: "v5-org", org: "acme", user: "alice" });
    expect(outcome.ok).toBe(true);
    expect(await session(sharedStores(), "v5-org")).toMatchObject({ userId: "alice", orgId: "acme" });
  });

  it("--org without --user runs as cli-user, and the capture says a flag chose it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fsdev-principal-"));
    try {
      const capture = join(dir, "run.json");
      await run("echo", { session: "v5-flag", org: "acme", capture });
      expect(JSON.parse(readFileSync(capture, "utf-8")).command.principal).toEqual({
        userId: "cli-user",
        orgId: "acme",
        from: "flag",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each([
    ["blank", ""],
    ["whitespace", "   "],
    ["the reserved placeholder", DEFAULT_ORG_ID],
  ])("refuses --org that is %s, before anything is written", async (_label, org) => {
    const outcome = await run("echo", { session: "v5-bad", seedSession: '{"x":1}', org });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.exitCode).toBe(EXIT_INVALID_ARGS);
    expect(await session(sharedStores(), "v5-bad")).toBeUndefined();
  });

  it("--user alone keeps the resolver's organization and replaces its user", async () => {
    const outcome = await run("echo", { session: "v5-user", user: "bob" });
    expect(outcome.ok).toBe(true);
    expect(await session(sharedStores(), "v5-user")).toMatchObject({ userId: "bob", orgId: APP_ORG });
  });

  it("--user alone still asks the resolver, so a credential-checking flow still refuses", async () => {
    const outcome = await run("admin", { session: "v5-user-admin", user: "bob" });
    expect(outcome.ok).toBe(false);
    expect(await session(sharedStores(), "v5-user-admin")).toBeUndefined();
  });

  it("a flag-named organization's session is invisible to the app's router; the app's own is not", async () => {
    await run("echo", { session: "v5-other", org: "acme", user: APP_USER });
    await run("echo", { session: "v5-same", org: APP_ORG, user: APP_USER });
    const { router } = await appRouter();
    // Control: naming the app's own organization is readable, so the refusal
    // below is the organization boundary, not a read that never works.
    expect((await http(router, "GET", "sessions/v5-same")).status).toBe(200);
    expect((await http(router, "GET", "sessions/v5-other")).status).not.toBe(200);
  });
});

describe("V6 · an existing session is checked before any write", () => {
  /** Create a session the way its owner would, then snapshot the stored record. */
  async function ownedSession(id: string, userId: string, orgId: string) {
    const app = makeApp();
    open.push(app);
    const runtime = await app.getRuntime();
    const first = await runAction({
      flow: runtime.registry.get("echo")!,
      actionName: "respond",
      input: { message: "hi" },
      userId,
      orgId,
      sessionId: id,
      stores: runtime.stores,
      runtimeConfig: runtime.runtimeConfig,
    });
    expect(first.error).toBeUndefined();
    return JSON.stringify(await session(runtime.stores, id));
  }

  it.each([
    ["-s on a development-organization session, against an app with a resolver", "cli-user", DEFAULT_ORG_ID, undefined],
    ["--seed-session on a same-organization, different-user session", "alice", APP_ORG, '{"tampered":true}'],
    ["--seed-session on another organization's session", APP_USER, "acme", '{"tampered":true}'],
  ])("refuses %s and leaves it byte-for-byte unchanged", async (_label, owner, org, seed) => {
    const id = `v6-${owner}-${org}`;
    const before = await ownedSession(id, owner, org);
    const outcome = await run("echo", { session: id, ...(seed !== undefined ? { seedSession: seed } : {}) });
    // The owner's record first: a refusal that arrives after a write is the bug.
    expect(JSON.stringify(await session(sharedStores(), id))).toBe(before);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.exitCode).toBe(EXIT_INVALID_ARGS);
    expect(outcome.error.message).toContain(`user ${owner} in organization ${org}`);
  });
});

describe("a pinned seat refuses an identity outside its pin before any write", () => {
  it.each([
    ["--user names another user in the owning org", { user: "alice" }],
    ["--org names another org", { org: "acme", user: APP_USER }],
  ])("fsdev run: %s — no session, request or seed is written", async (_label, flags) => {
    const outcome = await run(SEAT_ID, { session: "pin-run", seedSession: '{"seeded":true}', ...flags });
    expect(await session(sharedStores(), "pin-run")).toBeUndefined();
    expect(await sharedStores().request.list({ sessionId: "pin-run" })).toEqual([]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.exitCode).toBe(EXIT_INVALID_ARGS);
    expect(outcome.error.message).toContain(`Flow "${SEAT_ID}" refused this terminal`);
    expect(outcome.error.message).toContain("Nothing was written");
  });

  it("fsdev run as the seat's owner runs (the pin admits its own identity)", async () => {
    const outcome = await run(SEAT_ID, { session: "pin-owner" });
    expect(outcome.ok).toBe(true);
    expect(await session(sharedStores(), "pin-owner")).toMatchObject({ userId: APP_USER, orgId: APP_ORG });
  });

  it("fsdev chat: the turn fails and writes nothing", async () => {
    let out = "";
    const output = new Writable({
      write(chunk, _enc, cb) {
        out += chunk.toString();
        cb();
      },
    });
    const stores = createInMemoryStores();
    await executeChatCommand(SEAT_ID, "respond", {
      cwd: appDir,
      stores,
      user: "alice",
      input: Readable.from(["hi\n/exit\n"]) as Readable & { isTTY?: boolean },
      output: output as unknown as NodeJS.WritableStream,
    });
    expect(out).toContain(`Flow "${SEAT_ID}" refused this terminal`);
    expect(await stores.session.list()).toEqual([]);
    expect(await stores.request.list({})).toEqual([]);
  });
});

describe("a session stored before organizations were required", () => {
  it("is refused with the engine's migration message and left unchanged", async () => {
    const stores = sharedStores();
    const legacy = {
      id: "legacy",
      flowKind: "echo",
      flowId: "echo",
      userId: APP_USER,
      state: {},
      version: 0,
      createdAt: 1,
      updatedAt: 1,
      journal: [],
    };
    await stores.session.set("legacy", legacy as never, "any");
    const before = JSON.stringify(await session(stores, "legacy"));
    const outcome = await run("echo", { session: "legacy", seedSession: '{"tampered":true}' });
    expect(JSON.stringify(await session(stores, "legacy"))).toBe(before);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.exitCode).toBe(EXIT_INVALID_ARGS);
    expect(outcome.error.message).toContain("stored before an organization was required");
    expect(outcome.error.message).toContain("persistence guide");
    expect(outcome.error.message).not.toContain("(none)");
  });
});

describe("--user alone", () => {
  it("names --user as the user's source on stderr; the capture's from stays the organization's", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fsdev-principal-"));
    try {
      const capture = join(dir, "run.json");
      await run("echo", { session: "user-alone", user: "bob", capture });
      expect(stderrLines.filter((l) => l.startsWith("[fsdev] running as"))).toEqual([
        `[fsdev] running as bob (named by --user) in organization ${APP_ORG} (from the app's resolver)`,
      ]);
      expect(JSON.parse(readFileSync(capture, "utf-8")).command.principal).toEqual({
        userId: "bob",
        orgId: APP_ORG,
        from: "resolver",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("V7 · fsdev chat asks per turn", () => {
  it("a refused turn fails, the next target's turn succeeds, /status shows the organization", async () => {
    let out = "";
    const output = new Writable({
      write(chunk, _enc, cb) {
        out += chunk.toString();
        cb();
      },
    });
    const stores = createInMemoryStores();
    await executeChatCommand("admin", "respond", {
      cwd: appDir,
      stores,
      input: Readable.from(["refused turn\n/use echo\nhello\n/status\n/exit\n"]) as Readable & { isTTY?: boolean },
      output: output as unknown as NodeJS.WritableStream,
    });

    expect(out).toContain('Flow "admin" refused this terminal');
    expect(out).toContain("--org");
    expect(out).toContain(`Org:     ${APP_ORG} (user ${APP_USER}, resolver)`);
    const sessions = await stores.session.list();
    expect(sessions.map((s) => [s.flowKind, s.userId, s.orgId])).toEqual([["echo", APP_USER, APP_ORG]]);
    // Piped mode reports the failed turn.
    expect(process.exitCode).toBe(1);
  });

  it("--org names every turn's organization", async () => {
    const stores = createInMemoryStores();
    await executeChatCommand("admin", "respond", {
      cwd: appDir,
      stores,
      org: "acme",
      input: Readable.from(["hi\n/exit\n"]) as Readable & { isTTY?: boolean },
      output: new Writable({ write: (_c, _e, cb) => cb() }) as unknown as NodeJS.WritableStream,
    });
    const sessions = await stores.session.list();
    expect(sessions.map((s) => [s.flowKind, s.userId, s.orgId])).toEqual([["admin", "cli-user", "acme"]]);
  });

  it("refuses an invalid --org at startup", async () => {
    const err = await executeChatCommand("echo", "respond", {
      cwd: appDir,
      stores: createInMemoryStores(),
      org: DEFAULT_ORG_ID,
      input: Readable.from(["/exit\n"]) as Readable & { isTTY?: boolean },
      output: new Writable({ write: (_c, _e, cb) => cb() }) as unknown as NodeJS.WritableStream,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(CliError);
    expect(err.exitCode).toBe(EXIT_INVALID_ARGS);
  });
});

describe("V8 · commands that serve a network take no identity", () => {
  /** Parse argv against one registered command whose action is stubbed out. */
  async function parse(register: (p: Command) => void, argv: string[]) {
    const program = new Command();
    register(program);
    const command = program.commands[0]!;
    let received: unknown;
    command.exitOverride().configureOutput({ writeErr: () => undefined, writeOut: () => undefined });
    command.action((...args: unknown[]) => {
      received = args.at(-2);
    });
    program.exitOverride();
    return program.parseAsync(["node", "fsdev", ...argv]).then(
      () => ({ ok: true as const, options: received as Record<string, unknown> }),
      (err: { code?: string }) => ({ ok: false as const, code: err.code }),
    );
  }

  it.each([
    ["serve", registerServeCommand],
    ["dev", registerDevCommand],
  ] as const)("fsdev %s rejects --org and --user as unknown options", async (name, register) => {
    expect(await parse(register, [name, "--org", "x"])).toEqual({ ok: false, code: "commander.unknownOption" });
    expect(await parse(register, [name, "--user", "x"])).toEqual({ ok: false, code: "commander.unknownOption" });
  });

  it("fsdev run and fsdev chat accept them (the same parse, so the rejection above is real)", async () => {
    const runParsed = await parse(registerRunCommand, ["run", "f", "a", "--org", "acme", "--user", "alice"]);
    expect(runParsed).toMatchObject({ ok: true, options: { org: "acme", user: "alice" } });
    const chatParsed = await parse(registerChatCommand, ["chat", "--org", "acme"]);
    expect(chatParsed).toMatchObject({ ok: true, options: { org: "acme" } });
  });
});
