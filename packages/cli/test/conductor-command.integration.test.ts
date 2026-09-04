import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { PassThrough, Writable } from "node:stream";
import { createInMemoryStores } from "@flow-state-dev/engine";
import {
  conductorDefaultLogLevel,
  executeConductorCommand,
  resolveConductorConfigOption,
} from "../src/commands/conductor";
import { CliError } from "../src/resolve-block";
import { EXIT_CONFIG_ERROR, EXIT_DISCOVERY_ERROR, EXIT_INVALID_ARGS } from "../src/exit-codes";

const fixtureDir = resolve(import.meta.dirname, "fixtures-conductor");
const emptyDir = resolve(import.meta.dirname, "fixtures-chat", "empty");

function capture() {
  let text = "";
  const output = new Writable({
    write(chunk, _enc, cb) {
      text += chunk.toString();
      cb();
    },
  }) as Writable & { isTTY?: boolean };
  output.isTTY = false;
  return {
    output,
    get text() {
      return text;
    },
  };
}

beforeEach(() => {
  process.exitCode = undefined;
});
afterEach(() => {
  process.exitCode = undefined;
  delete process.env.CONDUCTOR_CONFIG;
});

describe("resolveConductorConfigOption", () => {
  it("uses CONDUCTOR_CONFIG when --config is omitted", () => {
    expect(
      resolveConductorConfigOption(undefined, {
        CONDUCTOR_CONFIG: "/tmp/lab/fsdev.config.ts",
      }),
    ).toBe("/tmp/lab/fsdev.config.ts");
  });

  it("lets an explicit --config win over CONDUCTOR_CONFIG", () => {
    expect(
      resolveConductorConfigOption("/explicit/fsdev.config.ts", {
        CONDUCTOR_CONFIG: "/tmp/lab/fsdev.config.ts",
      }),
    ).toBe("/explicit/fsdev.config.ts");
  });

  it("ignores CONDUCTOR_CONFIG when --no-config is set", () => {
    expect(
      resolveConductorConfigOption(false, {
        CONDUCTOR_CONFIG: "/tmp/lab/fsdev.config.ts",
      }),
    ).toBe(false);
  });

  it("returns undefined when neither flag nor env is set", () => {
    expect(resolveConductorConfigOption(undefined, {})).toBeUndefined();
  });

  it("ignores a blank CONDUCTOR_CONFIG", () => {
    expect(
      resolveConductorConfigOption(undefined, { CONDUCTOR_CONFIG: "  " }),
    ).toBeUndefined();
  });
});

describe("fsdev conductor — headless against a conductor-shaped flow", () => {
  it("routes an unslashed line through steer and files the issue", async () => {
    const stores = createInMemoryStores();
    const talked = capture();
    const code = await executeConductorCommand(["please", "start", "FIX-99"], {
      cwd: fixtureDir,
      stores,
      output: talked.output as unknown as NodeJS.WriteStream,
      stderr: talked.output as unknown as NodeJS.WriteStream,
      config: false,
    });
    expect(code).toBe(0);
    expect(talked.text).toMatch(/FIX-99/);
  });

  it("seeds, wakes, reads the board through status, and answers", async () => {
    const stores = createInMemoryStores();
    const seeded = capture();
    const seedCode = await executeConductorCommand(["seed", "ASK-1"], {
      cwd: fixtureDir,
      stores,
      output: seeded.output as unknown as NodeJS.WriteStream,
      config: false,
    });
    expect(seedCode).toBe(0);
    expect(seeded.text).toContain("ASK-1--implement");

    const woken = capture();
    const wakeCode = await executeConductorCommand(["wake"], {
      cwd: fixtureDir,
      stores,
      output: woken.output as unknown as NodeJS.WriteStream,
      config: false,
    });
    expect(wakeCode).toBe(2);
    expect(woken.text).toContain("awaiting_review");
    expect(woken.text).toContain("Which path?");

    const answered = capture();
    const answerCode = await executeConductorCommand(
      ["answer", "ASK-1/implement/1/q", "the real file"],
      {
        cwd: fixtureDir,
        stores,
        output: answered.output as unknown as NodeJS.WriteStream,
        config: false,
      },
    );
    expect(answerCode).toBe(0);
    expect(answered.text).toContain("answered");

    const status = capture();
    const statusCode = await executeConductorCommand(["status", "ASK-1"], {
      cwd: fixtureDir,
      stores,
      output: status.output as unknown as NodeJS.WriteStream,
      config: false,
    });
    expect(statusCode).toBe(0);
    expect(status.text).toContain("completed");
    expect(status.text).toContain("fixture-epic");
  });

  it("names the board on headless status so leftover CONDUCTOR_EPIC is visible", async () => {
    const prevRepo = process.env.CONDUCTOR_REPO;
    process.env.CONDUCTOR_REPO = "/tmp/fsd-product";
    try {
      const out = capture();
      const code = await executeConductorCommand(["status"], {
        cwd: fixtureDir,
        stores: createInMemoryStores(),
        output: out.output as unknown as NodeJS.WriteStream,
        config: false,
      });
      expect(code).toBe(1);
      expect(out.text).toContain("fixture-epic · fsd-product");
      expect(out.text).toContain("no rows");

      const json = capture();
      const jsonCode = await executeConductorCommand(["status", "--json"], {
        cwd: fixtureDir,
        stores: createInMemoryStores(),
        output: json.output as unknown as NodeJS.WriteStream,
        config: false,
      });
      expect(jsonCode).toBe(1);
      const parsed = JSON.parse(json.text) as {
        epic?: string;
        repo?: string;
        rows: unknown[];
      };
      expect(parsed.epic).toBe("fixture-epic");
      expect(parsed.repo).toBe("fsd-product");
      expect(parsed.rows).toEqual([]);
    } finally {
      if (prevRepo === undefined) delete process.env.CONDUCTOR_REPO;
      else process.env.CONDUCTOR_REPO = prevRepo;
    }
  });

  it("seeds a named phase onto the task id", async () => {
    const seeded = capture();
    const code = await executeConductorCommand(["seed", "ASK-1", "--phase", "review"], {
      cwd: fixtureDir,
      stores: createInMemoryStores(),
      output: seeded.output as unknown as NodeJS.WriteStream,
      config: false,
    });
    expect(code).toBe(0);
    expect(seeded.text).toContain("ASK-1--review");
  });

  it("seeds words after the issue id as the brief", async () => {
    const seeded = capture();
    const code = await executeConductorCommand(
      ["seed", "ASK-1", "Rename", "getSession", "in", "the", "docs"],
      {
        cwd: fixtureDir,
        stores: createInMemoryStores(),
        output: seeded.output as unknown as NodeJS.WriteStream,
        config: false,
      },
    );
    expect(code).toBe(0);
    expect(seeded.text).toContain("ASK-1--implement");
  });

  it("treats an unknown headless verb as talk", async () => {
    const talked = capture();
    const code = await executeConductorCommand(["nope"], {
      cwd: fixtureDir,
      stores: createInMemoryStores(),
      output: talked.output as unknown as NodeJS.WriteStream,
      stderr: talked.output as unknown as NodeJS.WriteStream,
      config: false,
    });
    expect(code).not.toBe(EXIT_INVALID_ARGS);
    expect(talked.text).toMatch(/No rows yet|Board has/);
  });

  it("is fatal when no conductor flow is discovered", async () => {
    const err = await executeConductorCommand(["status"], {
      cwd: emptyDir,
      stores: createInMemoryStores(),
      config: false,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).exitCode).toBe(EXIT_DISCOVERY_ERROR);
    expect((err as CliError).message).toMatch(/^This command drives a kind: "conductor" flow/);
    expect((err as CliError).message).toMatch(/labs\/conductor/);
    expect((err as CliError).message).toMatch(/--config/);
    expect((err as CliError).message).toMatch(/CONDUCTOR_CONFIG/);
  });

  it("consults CONDUCTOR_CONFIG when --config is omitted", async () => {
    process.env.CONDUCTOR_CONFIG = "/no/such/fsdev.config.ts";
    const err = await executeConductorCommand(["status"], {
      cwd: emptyDir,
      stores: createInMemoryStores(),
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).exitCode).toBe(EXIT_CONFIG_ERROR);
    expect((err as CliError).message).toMatch(/Config file not found/);
    expect((err as CliError).message).toMatch(/no\/such\/fsdev\.config\.ts/);
    expect((err as CliError).message).not.toMatch(/kind: "conductor"/);
  });

  it("ignores CONDUCTOR_CONFIG when --no-config is set", async () => {
    process.env.CONDUCTOR_CONFIG = "/no/such/fsdev.config.ts";
    const err = await executeConductorCommand(["status"], {
      cwd: emptyDir,
      stores: createInMemoryStores(),
      config: false,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).exitCode).toBe(EXIT_DISCOVERY_ERROR);
    expect((err as CliError).message).toMatch(/kind: "conductor"/);
    expect((err as CliError).message).not.toMatch(/Config file not found/);
  });

  it("leads with the conductor hint, not unrelated import warnings", async () => {
    const importFailDir = resolve(import.meta.dirname, "fixtures-import-failure");
    const stderr: string[] = [];
    const originalWrite = process.stderr.write;
    process.stderr.write = ((chunk: unknown) => {
      stderr.push(typeof chunk === "string" ? chunk : String(chunk));
      return true;
    }) as typeof process.stderr.write;
    try {
      const err = await executeConductorCommand(["status"], {
        cwd: importFailDir,
        stores: createInMemoryStores(),
        config: false,
      }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(CliError);
      expect((err as CliError).exitCode).toBe(EXIT_DISCOVERY_ERROR);
      expect((err as CliError).message).toMatch(/^This command drives a kind: "conductor" flow/);
      expect((err as CliError).message).toMatch(/labs\/conductor/);
      expect((err as CliError).message).not.toContain("broken-flow");
      expect(stderr.join("")).not.toContain("Warning: failed to import");
    } finally {
      process.stderr.write = originalWrite;
    }
  });

  it("start without a TTY seeds and watches through the same actions", async () => {
    const stores = createInMemoryStores();
    const started = capture();
    const code = await executeConductorCommand(["start", "ASK-1"], {
      cwd: fixtureDir,
      stores,
      output: started.output as unknown as NodeJS.WriteStream,
      config: false,
      tty: false,
      maxPolls: 1,
      pollMs: 1,
      sleep: async () => {},
    });
    expect(code).toBe(3);
    expect(started.text).toContain("ASK-1--implement");
    expect(started.text).toContain("ASK-1 pending");
  });

  it("watch exits 2 when a question is open, without spinning", async () => {
    const stores = createInMemoryStores();
    await executeConductorCommand(["seed", "ASK-1"], {
      cwd: fixtureDir,
      stores,
      output: capture().output as unknown as NodeJS.WriteStream,
      config: false,
    });
    await executeConductorCommand(["wake"], {
      cwd: fixtureDir,
      stores,
      output: capture().output as unknown as NodeJS.WriteStream,
      config: false,
    });
    const watched = capture();
    const code = await executeConductorCommand(["watch", "ASK-1"], {
      cwd: fixtureDir,
      stores,
      output: watched.output as unknown as NodeJS.WriteStream,
      config: false,
      maxPolls: 2,
      pollMs: 1,
      sleep: async () => {},
    });
    expect(code).toBe(2);
    expect(watched.text).toContain("Which path?");
  });

  it("watch exits 1 when the last attempt failed, without spinning", async () => {
    const stores = createInMemoryStores();
    await executeConductorCommand(["seed", "FAIL-1"], {
      cwd: fixtureDir,
      stores,
      output: capture().output as unknown as NodeJS.WriteStream,
      config: false,
    });
    await executeConductorCommand(["wake"], {
      cwd: fixtureDir,
      stores,
      output: capture().output as unknown as NodeJS.WriteStream,
      config: false,
    });
    const watched = capture();
    const code = await executeConductorCommand(["watch", "FAIL-1"], {
      cwd: fixtureDir,
      stores,
      output: watched.output as unknown as NodeJS.WriteStream,
      config: false,
      maxPolls: 2,
      pollMs: 1,
      sleep: async () => {},
    });
    expect(code).toBe(1);
    expect(watched.text).toContain("Not logged in");
    expect(watched.text).toContain("! failed");
  });

  it("status of a named settled issue catch-up the last attempt on stderr", async () => {
    const stores = createInMemoryStores();
    await executeConductorCommand(["seed", "FAIL-1"], {
      cwd: fixtureDir,
      stores,
      output: capture().output as unknown as NodeJS.WriteStream,
      config: false,
    });
    await executeConductorCommand(["wake"], {
      cwd: fixtureDir,
      stores,
      output: capture().output as unknown as NodeJS.WriteStream,
      config: false,
    });
    stores.request.persistEvents("req-fail-1", [
      {
        stream: "request",
        type: "item.added",
        requestId: "req-fail-1",
        sequence_number: 1,
        ts: 1,
        item: {
          id: "s1",
          type: "status",
          message: "Not logged in · Please run /login",
          transient: true,
        },
      } as never,
      {
        stream: "request",
        type: "item.added",
        requestId: "req-fail-1",
        sequence_number: 2,
        ts: 2,
        item: {
          id: "e1",
          type: "error",
          message: "Please run /login",
        },
      } as never,
      {
        stream: "request",
        type: "request.completed",
        status: "completed",
        requestId: "req-fail-1",
        sequence_number: 3,
        ts: 3,
      } as never,
    ]);
    const err = capture();
    const board = capture();
    const code = await executeConductorCommand(["status", "FAIL-1"], {
      cwd: fixtureDir,
      stores,
      output: board.output as unknown as NodeJS.WriteStream,
      stderr: err.output as unknown as NodeJS.WriteStream,
      config: false,
    });
    expect(code).toBe(1);
    expect(err.text).toContain("Not logged in");
    expect(board.text).toContain("Not logged in");

    const full = capture();
    await executeConductorCommand(["status"], {
      cwd: fixtureDir,
      stores,
      output: capture().output as unknown as NodeJS.WriteStream,
      stderr: full.output as unknown as NodeJS.WriteStream,
      config: false,
    });
    expect(full.text).not.toContain("Please run /login");
  });

  it("named status prints last tool, files, hunk, and todo on stdout", async () => {
    const stores = createInMemoryStores();
    await executeConductorCommand(["seed", "FAIL-1"], {
      cwd: fixtureDir,
      stores,
      output: capture().output as unknown as NodeJS.WriteStream,
      config: false,
    });
    await executeConductorCommand(["wake"], {
      cwd: fixtureDir,
      stores,
      output: capture().output as unknown as NodeJS.WriteStream,
      config: false,
    });
    stores.request.persistEvents("req-fail-1", [
      {
        stream: "request",
        type: "item.added",
        requestId: "req-fail-1",
        sequence_number: 1,
        ts: 1,
        item: {
          id: "t1",
          type: "tool_output",
          blockName: "TodoWrite",
          status: "completed",
          toolCall: {
            callId: "c2",
            name: "TodoWrite",
            arguments: JSON.stringify({
              todos: [
                { content: "Add hello.js", status: "completed" },
                { content: "Open the pull request", status: "pending" },
              ],
            }),
            generatorBlock: "agent",
          },
        },
      } as never,
      {
        stream: "request",
        type: "item.added",
        requestId: "req-fail-1",
        sequence_number: 2,
        ts: 2,
        item: {
          id: "t2",
          type: "tool_output",
          blockName: "Write",
          status: "completed",
          toolCall: {
            callId: "c1",
            name: "Write",
            arguments: JSON.stringify({
              file_path: "src/hello.js",
              contents: "export const hello = 1;\n",
            }),
            generatorBlock: "agent",
          },
        },
      } as never,
      {
        stream: "request",
        type: "request.completed",
        status: "completed",
        requestId: "req-fail-1",
        sequence_number: 3,
        ts: 3,
      } as never,
    ]);
    const named = capture();
    const namedErr = capture();
    const code = await executeConductorCommand(["status", "FAIL-1"], {
      cwd: fixtureDir,
      stores,
      output: named.output as unknown as NodeJS.WriteStream,
      stderr: namedErr.output as unknown as NodeJS.WriteStream,
      config: false,
    });
    expect(code).toBe(1);
    expect(named.text).toContain("Write src/hello.js");
    expect(named.text).toContain("src/hello.js");
    expect(named.text).toContain("+ export const hello = 1;");
    expect(named.text).toContain("[ ] Open the pull request");
    expect(named.text).not.toContain("\x1b]8;;");

    const fullOut = capture();
    const fullErr = capture();
    await executeConductorCommand(["status"], {
      cwd: fixtureDir,
      stores,
      output: fullOut.output as unknown as NodeJS.WriteStream,
      stderr: fullErr.output as unknown as NodeJS.WriteStream,
      config: false,
    });
    expect(fullOut.text).not.toContain("Write src/hello.js");
    expect(fullOut.text).not.toContain("Open the pull request");
    expect(fullErr.text).not.toContain("tool · Write src/hello.js");
  });

  it("full-board status and wake print a running row's current action, not a settled journal", async () => {
    const stores = createInMemoryStores();
    await executeConductorCommand(["seed", "LIVE-1"], {
      cwd: fixtureDir,
      stores,
      output: capture().output as unknown as NodeJS.WriteStream,
      config: false,
    });
    await executeConductorCommand(["seed", "FAIL-1"], {
      cwd: fixtureDir,
      stores,
      output: capture().output as unknown as NodeJS.WriteStream,
      config: false,
    });
    await executeConductorCommand(["wake"], {
      cwd: fixtureDir,
      stores,
      output: capture().output as unknown as NodeJS.WriteStream,
      config: false,
    });
    stores.request.persistEvents("req-live-1", [
      {
        stream: "request",
        type: "item.added",
        requestId: "req-live-1",
        sequence_number: 1,
        ts: 1,
        item: {
          id: "t1",
          type: "tool_output",
          blockName: "Write",
          status: "completed",
          toolCall: {
            callId: "c-live",
            name: "Write",
            arguments: JSON.stringify({
              file_path: "src/live.ts",
              contents: "export const live = 1;\n",
            }),
            generatorBlock: "agent",
          },
        },
      } as never,
    ]);
    stores.request.persistEvents("req-fail-1", [
      {
        stream: "request",
        type: "item.added",
        requestId: "req-fail-1",
        sequence_number: 1,
        ts: 1,
        item: {
          id: "t-fail",
          type: "tool_output",
          blockName: "Write",
          status: "completed",
          toolCall: {
            callId: "c-fail",
            name: "Write",
            arguments: JSON.stringify({
              file_path: "src/hello.js",
              contents: "export const hello = 1;\n",
            }),
            generatorBlock: "agent",
          },
        },
      } as never,
    ]);
    const full = capture();
    await executeConductorCommand(["status"], {
      cwd: fixtureDir,
      stores,
      output: full.output as unknown as NodeJS.WriteStream,
      stderr: capture().output as unknown as NodeJS.WriteStream,
      config: false,
    });
    expect(full.text).toContain("Write src/live.ts");
    expect(full.text).not.toContain("src/hello.js");

    const asJson = capture();
    await executeConductorCommand(["status", "--json"], {
      cwd: fixtureDir,
      stores,
      output: asJson.output as unknown as NodeJS.WriteStream,
      stderr: capture().output as unknown as NodeJS.WriteStream,
      config: false,
    });
    const board = JSON.parse(asJson.text) as {
      rows: Array<{ issue: string | null; now?: string; files?: string[] }>;
    };
    const live = board.rows.find((row) => row.issue === "LIVE-1");
    const failed = board.rows.find((row) => row.issue === "FAIL-1");
    expect(live?.now).toBe("Write src/live.ts");
    expect(live?.files).toContain("src/live.ts");
    expect(failed?.now).toBeUndefined();
    expect(failed?.files).toBeUndefined();

    const woken = capture();
    await executeConductorCommand(["wake"], {
      cwd: fixtureDir,
      stores,
      output: woken.output as unknown as NodeJS.WriteStream,
      stderr: capture().output as unknown as NodeJS.WriteStream,
      config: false,
    });
    expect(woken.text).toContain("Write src/live.ts");
    expect(woken.text).not.toContain("src/hello.js");
  });

  it("watch of the full board does not replay a settled journal it never tailed", async () => {
    const stores = createInMemoryStores();
    await executeConductorCommand(["seed", "FAIL-1"], {
      cwd: fixtureDir,
      stores,
      output: capture().output as unknown as NodeJS.WriteStream,
      config: false,
    });
    await executeConductorCommand(["wake"], {
      cwd: fixtureDir,
      stores,
      output: capture().output as unknown as NodeJS.WriteStream,
      config: false,
    });
    stores.request.persistEvents("req-fail-1", [
      {
        stream: "request",
        type: "item.added",
        requestId: "req-fail-1",
        sequence_number: 1,
        ts: 1,
        item: {
          id: "s1",
          type: "status",
          message: "should not reprint on a full-board watch",
          transient: true,
        },
      } as never,
      {
        stream: "request",
        type: "request.completed",
        status: "completed",
        requestId: "req-fail-1",
        sequence_number: 2,
        ts: 2,
      } as never,
    ]);
    const err = capture();
    const code = await executeConductorCommand(["watch"], {
      cwd: fixtureDir,
      stores,
      output: capture().output as unknown as NodeJS.WriteStream,
      stderr: err.output as unknown as NodeJS.WriteStream,
      config: false,
      maxPolls: 2,
      pollMs: 1,
      sleep: async () => {},
    });
    expect(code).toBe(1);
    expect(err.text).not.toContain("should not reprint on a full-board watch");
  });

  it("watch of a settled issue catch-up the last attempt on stderr", async () => {
    const stores = createInMemoryStores();
    await executeConductorCommand(["seed", "FAIL-1"], {
      cwd: fixtureDir,
      stores,
      output: capture().output as unknown as NodeJS.WriteStream,
      config: false,
    });
    await executeConductorCommand(["wake"], {
      cwd: fixtureDir,
      stores,
      output: capture().output as unknown as NodeJS.WriteStream,
      config: false,
    });
    stores.request.persistEvents("req-fail-1", [
      {
        stream: "request",
        type: "item.added",
        requestId: "req-fail-1",
        sequence_number: 1,
        ts: 1,
        item: {
          id: "s1",
          type: "status",
          message: "agent stopped after login failed",
          transient: true,
        },
      } as never,
      {
        stream: "request",
        type: "request.completed",
        status: "completed",
        requestId: "req-fail-1",
        sequence_number: 2,
        ts: 2,
      } as never,
    ]);
    const err = capture();
    const watched = capture();
    const code = await executeConductorCommand(["watch", "FAIL-1"], {
      cwd: fixtureDir,
      stores,
      output: watched.output as unknown as NodeJS.WriteStream,
      stderr: err.output as unknown as NodeJS.WriteStream,
      config: false,
      maxPolls: 2,
      pollMs: 1,
      sleep: async () => {},
    });
    expect(code).toBe(1);
    expect(err.text).toContain("agent stopped after login failed");
    expect(watched.text).toContain("Not logged in");
  });

  it("watch tails a detached run's request stream on stderr", async () => {
    const stores = createInMemoryStores();
    await executeConductorCommand(["seed", "LIVE-1"], {
      cwd: fixtureDir,
      stores,
      output: capture().output as unknown as NodeJS.WriteStream,
      config: false,
    });
    await executeConductorCommand(["wake"], {
      cwd: fixtureDir,
      stores,
      output: capture().output as unknown as NodeJS.WriteStream,
      config: false,
    });
    const err = capture();
    const watched = capture();
    const running = executeConductorCommand(["watch", "LIVE-1"], {
      cwd: fixtureDir,
      stores,
      output: watched.output as unknown as NodeJS.WriteStream,
      stderr: err.output as unknown as NodeJS.WriteStream,
      config: false,
      maxPolls: 25,
      pollMs: 20,
    });
    const start = Date.now();
    while (!watched.text.includes("LIVE-1") && Date.now() - start < 1_000) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    stores.request.persistEvents("req-live-1", [
      {
        stream: "request",
        type: "item.added",
        requestId: "req-live-1",
        sequence_number: 1,
        ts: 1,
        item: {
          id: "s1",
          type: "status",
          message: "coding the checkout",
          transient: true,
        },
      } as never,
    ]);
    const code = await running;
    expect(code).toBe(3);
    expect(err.text).toContain("coding the checkout");
  });

  it("aborts the running request id status put on the row", async () => {
    const stores = createInMemoryStores();
    await executeConductorCommand(["seed", "LIVE-1"], {
      cwd: fixtureDir,
      stores,
      output: capture().output as unknown as NodeJS.WriteStream,
      config: false,
    });
    await executeConductorCommand(["wake"], {
      cwd: fixtureDir,
      stores,
      output: capture().output as unknown as NodeJS.WriteStream,
      config: false,
    });

    const missing = capture();
    const missingCode = await executeConductorCommand(["abort", "LIVE-1"], {
      cwd: fixtureDir,
      stores,
      output: missing.output as unknown as NodeJS.WriteStream,
      config: false,
    });
    expect(missing.text).toContain("stop · req-live-1 was not running");
    expect(missingCode).toBe(3);

    const ts = Date.now();
    await stores.request.set(
      "req-live-1",
      {
        id: "req-live-1",
        flowKind: "conductor",
        actionName: "wake",
        userId: "cli-user",
        source: "http",
        status: "in_progress",
        startedAtMs: ts,
        state: {},
        version: 0,
        createdAt: ts,
        updatedAt: ts,
      },
      "any",
    );
    const stopped = capture();
    const stopCode = await executeConductorCommand(["stop", "LIVE-1"], {
      cwd: fixtureDir,
      stores,
      output: stopped.output as unknown as NodeJS.WriteStream,
      config: false,
    });
    expect(stopped.text).toContain("stop · req-live-1");
    expect(stopped.text).not.toContain("was not running");
    expect(stopCode).toBe(3);
    await expect(stores.request.isAbortRequested("req-live-1")).resolves.toBe(true);
  });

  it("prints nothing running when abort finds no in-flight row", async () => {
    const empty = capture();
    const code = await executeConductorCommand(["abort"], {
      cwd: fixtureDir,
      stores: createInMemoryStores(),
      output: empty.output as unknown as NodeJS.WriteStream,
      config: false,
    });
    expect(code).toBe(1);
    expect(empty.text).toContain("nothing running to stop");
  });
});

describe("conductorDefaultLogLevel", () => {
  it("is silent on the fullscreen board and warn on headless verbs", () => {
    expect(conductorDefaultLogLevel({ mode: "tui" }, {})).toBe("silent");
    expect(conductorDefaultLogLevel({ mode: "headless", command: { kind: "status" } }, {})).toBe(
      "warn",
    );
    expect(
      conductorDefaultLogLevel({ mode: "headless", command: { kind: "wake" } }, { tty: true }),
    ).toBe("warn");
    expect(
      conductorDefaultLogLevel({ mode: "headless", command: { kind: "start" } }, { tty: false }),
    ).toBe("warn");
    expect(
      conductorDefaultLogLevel({ mode: "headless", command: { kind: "start" } }, { tty: true }),
    ).toBe("silent");
  });
});

describe("fsdev conductor — config-path init narration", () => {
  const configDir = resolve(import.meta.dirname, "fixtures-conductor-config");

  function fakeTty() {
    const input = new PassThrough() as PassThrough & {
      isTTY: boolean;
      isRaw?: boolean;
      setRawMode: (mode: boolean) => void;
    };
    input.isTTY = true;
    input.setRawMode = (mode) => {
      input.isRaw = mode;
    };
    const output = new PassThrough() as PassThrough & {
      isTTY: boolean;
      columns: number;
      rows: number;
    };
    output.isTTY = true;
    output.columns = 80;
    output.rows = 24;
    let text = "";
    output.on("data", (chunk: Buffer | string) => {
      text += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    });
    return {
      input,
      output,
      get text() {
        return text;
      },
    };
  }

  it("does not print the active-profile line at the default warn level", async () => {
    const errors: string[] = [];
    const restoreError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    };
    const stderr: string[] = [];
    const originalWrite = process.stderr.write;
    process.stderr.write = ((chunk: unknown) => {
      stderr.push(typeof chunk === "string" ? chunk : String(chunk));
      return true;
    }) as typeof process.stderr.write;
    try {
      const out = capture();
      const code = await executeConductorCommand(["status"], {
        cwd: configDir,
        stores: createInMemoryStores(),
        output: out.output as unknown as NodeJS.WriteStream,
        stderr: out.output as unknown as NodeJS.WriteStream,
      });
      // Empty board is a status outcome (1), not a failed init.
      expect(code).toBe(1);
      expect(errors.join("")).not.toMatch(/active profile/);
      expect(stderr.join("")).not.toMatch(/active profile/);
    } finally {
      console.error = restoreError;
      process.stderr.write = originalWrite;
    }
  });

  it("--log-level info still prints the active-profile line on stderr", async () => {
    const stderr: string[] = [];
    const originalWrite = process.stderr.write;
    process.stderr.write = ((chunk: unknown) => {
      stderr.push(typeof chunk === "string" ? chunk : String(chunk));
      return true;
    }) as typeof process.stderr.write;
    try {
      const out = capture();
      const code = await executeConductorCommand(["status"], {
        cwd: configDir,
        stores: createInMemoryStores(),
        output: out.output as unknown as NodeJS.WriteStream,
        logLevel: "info",
      });
      expect(code).toBe(1);
      expect(stderr.join("")).toMatch(/\[flowstate\] active profile/);
    } finally {
      process.stderr.write = originalWrite;
    }
  });

  it("the fullscreen board is silent unless --log-level is passed", async () => {
    const stderr: string[] = [];
    const originalWrite = process.stderr.write;
    process.stderr.write = ((chunk: unknown) => {
      stderr.push(typeof chunk === "string" ? chunk : String(chunk));
      return true;
    }) as typeof process.stderr.write;
    const errors: string[] = [];
    const restoreError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    };
    try {
      const tty = fakeTty();
      const running = executeConductorCommand(["tui"], {
        cwd: configDir,
        stores: createInMemoryStores(),
        input: tty.input as unknown as NodeJS.ReadStream,
        output: tty.output as unknown as NodeJS.WriteStream,
        pollMs: 50,
      });
      const start = Date.now();
      while (!tty.text.includes("FSDEV CONDUCTOR") && Date.now() - start < 3_000) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(tty.text).toContain("FSDEV CONDUCTOR");
      tty.input.write("/quit\r");
      await expect(running).resolves.toBe(0);
      expect(stderr.join("")).not.toMatch(/\[flowstate\]|\[flow-state\]/);
      expect(errors.join("")).not.toMatch(/\[flowstate\]|\[flow-state\]/);
    } finally {
      process.stderr.write = originalWrite;
      console.error = restoreError;
    }
  });

  it("TUI --log-level info still prints the active-profile line on stderr", async () => {
    const stderr: string[] = [];
    const originalWrite = process.stderr.write;
    process.stderr.write = ((chunk: unknown) => {
      stderr.push(typeof chunk === "string" ? chunk : String(chunk));
      return true;
    }) as typeof process.stderr.write;
    try {
      const tty = fakeTty();
      const running = executeConductorCommand(["tui"], {
        cwd: configDir,
        stores: createInMemoryStores(),
        input: tty.input as unknown as NodeJS.ReadStream,
        output: tty.output as unknown as NodeJS.WriteStream,
        logLevel: "info",
        pollMs: 50,
      });
      const start = Date.now();
      while (!tty.text.includes("FSDEV CONDUCTOR") && Date.now() - start < 3_000) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(tty.text).toContain("FSDEV CONDUCTOR");
      tty.input.write("/quit\r");
      await expect(running).resolves.toBe(0);
      expect(stderr.join("")).toMatch(/\[flowstate\] active profile/);
    } finally {
      process.stderr.write = originalWrite;
    }
  });
});
