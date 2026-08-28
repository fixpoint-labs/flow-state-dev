import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { PassThrough } from "node:stream";
import { createInMemoryStores } from "@flow-state-dev/engine";
import { executeConductorCommand } from "../src/commands/conductor";
import { stripAnsi } from "../src/conductor/theme";

const fixtureDir = resolve(import.meta.dirname, "fixtures-conductor");

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

  let text = "";
  const output = new PassThrough() as PassThrough & {
    isTTY: boolean;
    columns: number;
    rows: number;
  };
  output.isTTY = true;
  output.columns = 80;
  output.rows = 24;
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

function waitFor(getText: () => string, needle: string, ms = 3_000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = setInterval(() => {
      if (getText().includes(needle)) {
        clearInterval(tick);
        resolve();
        return;
      }
      if (Date.now() - start > ms) {
        clearInterval(tick);
        reject(new Error(`timed out waiting for ${JSON.stringify(needle)}\n${getText().slice(-400)}`));
      }
    }, 20);
  });
}

beforeEach(() => {
  process.exitCode = undefined;
});
afterEach(() => {
  process.exitCode = undefined;
});

describe("fsdev conductor — TUI over the same actions", () => {
  it("opens the board, types an answer on a waiting row, and quits", async () => {
    const stores = createInMemoryStores();
    await executeConductorCommand(["seed", "ASK-1"], {
      cwd: fixtureDir,
      stores,
      config: false,
      output: new PassThrough() as unknown as NodeJS.WriteStream,
    });
    await executeConductorCommand(["wake"], {
      cwd: fixtureDir,
      stores,
      config: false,
      output: new PassThrough() as unknown as NodeJS.WriteStream,
    });

    const tty = fakeTty();
    const running = executeConductorCommand(["tui"], {
      cwd: fixtureDir,
      stores,
      config: false,
      input: tty.input as unknown as NodeJS.ReadStream,
      output: tty.output as unknown as NodeJS.WriteStream,
      pollMs: 50,
    });

    await waitFor(() => tty.text, "Which path?");
    expect(tty.text).toContain("FSDEV CONDUCTOR");
    expect(tty.text).toContain("ASK-1");

    tty.input.write("the real file\r");
    await waitFor(() => tty.text, "completed");

    tty.input.write("q");
    await expect(running).resolves.toBe(0);
  });

  it("wakes from the board and writes the drain into the transcript", async () => {
    const stores = createInMemoryStores();
    await executeConductorCommand(["seed", "ASK-1"], {
      cwd: fixtureDir,
      stores,
      config: false,
      output: new PassThrough() as unknown as NodeJS.WriteStream,
    });

    const tty = fakeTty();
    const running = executeConductorCommand(["tui"], {
      cwd: fixtureDir,
      stores,
      config: false,
      input: tty.input as unknown as NodeJS.ReadStream,
      output: tty.output as unknown as NodeJS.WriteStream,
      pollMs: 50,
    });

    await waitFor(() => tty.text, "ASK-1");
    tty.input.write("w");
    await waitFor(() => tty.text, "Which path?");
    expect(tty.text).toContain("asked Which path?");
    expect(tty.text).toMatch(/parked ASK-1|drained |claiming /);

    tty.input.write("q");
    await expect(running).resolves.toBe(0);
  });

  it("keeps a failed attempt in a FAIL band the transcript cannot bury", async () => {
    const stores = createInMemoryStores();
    await executeConductorCommand(["seed", "FAIL-1"], {
      cwd: fixtureDir,
      stores,
      config: false,
      output: new PassThrough() as unknown as NodeJS.WriteStream,
    });
    await executeConductorCommand(["wake"], {
      cwd: fixtureDir,
      stores,
      config: false,
      output: new PassThrough() as unknown as NodeJS.WriteStream,
    });

    const tty = fakeTty();
    const running = executeConductorCommand(["tui"], {
      cwd: fixtureDir,
      stores,
      config: false,
      input: tty.input as unknown as NodeJS.ReadStream,
      output: tty.output as unknown as NodeJS.WriteStream,
      pollMs: 50,
    });

    await waitFor(() => tty.text, "Not logged in");
    expect(tty.text).toMatch(/\bFAIL\b/);
    expect(tty.text).toContain("1 failed");
    expect(tty.text).toContain("w retry");

    tty.input.write("q");
    await expect(running).resolves.toBe(0);
  });

  it("tails a detached run's request stream into the transcript", async () => {
    const stores = createInMemoryStores();
    await executeConductorCommand(["seed", "LIVE-1"], {
      cwd: fixtureDir,
      stores,
      config: false,
      output: new PassThrough() as unknown as NodeJS.WriteStream,
    });
    await executeConductorCommand(["wake"], {
      cwd: fixtureDir,
      stores,
      config: false,
      output: new PassThrough() as unknown as NodeJS.WriteStream,
    });

    const tty = fakeTty();
    const running = executeConductorCommand(["tui"], {
      cwd: fixtureDir,
      stores,
      config: false,
      input: tty.input as unknown as NodeJS.ReadStream,
      output: tty.output as unknown as NodeJS.WriteStream,
      pollMs: 40,
    });

    await waitFor(() => tty.text, "LIVE-1");
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
    await waitFor(() => tty.text, "coding the checkout");

    tty.input.write("q");
    await expect(running).resolves.toBe(0);
  });

  it("names a coding tool with the file it touched", async () => {
    const stores = createInMemoryStores();
    await executeConductorCommand(["seed", "LIVE-1"], {
      cwd: fixtureDir,
      stores,
      config: false,
      output: new PassThrough() as unknown as NodeJS.WriteStream,
    });
    await executeConductorCommand(["wake"], {
      cwd: fixtureDir,
      stores,
      config: false,
      output: new PassThrough() as unknown as NodeJS.WriteStream,
    });

    const tty = fakeTty();
    const running = executeConductorCommand(["tui"], {
      cwd: fixtureDir,
      stores,
      config: false,
      input: tty.input as unknown as NodeJS.ReadStream,
      output: tty.output as unknown as NodeJS.WriteStream,
      pollMs: 40,
    });

    await waitFor(() => tty.text, "LIVE-1");
    stores.request.persistEvents("req-live-1", [
      {
        stream: "request",
        type: "item.added",
        requestId: "req-live-1",
        sequence_number: 2,
        ts: 2,
        item: {
          id: "t1",
          type: "tool_output",
          status: "in_progress",
          blockName: "Write",
          toolCall: {
            callId: "c1",
            name: "Write",
            arguments: JSON.stringify({
              file_path: "src/conductor/render.ts",
              contents: "export function renderFrame() {}\n",
            }),
            generatorBlock: "agent",
          },
        },
      } as never,
    ]);
    await waitFor(() => tty.text, "tool · Write src/conductor/render.ts");
    await waitFor(() => tty.text, "+ export function renderFrame() {}");

    tty.input.write("q");
    await expect(running).resolves.toBe(0);
  });

  it("shows the RUN band and stops the selected request with x", async () => {
    const stores = createInMemoryStores();
    await executeConductorCommand(["seed", "LIVE-1"], {
      cwd: fixtureDir,
      stores,
      config: false,
      output: new PassThrough() as unknown as NodeJS.WriteStream,
    });
    await executeConductorCommand(["wake"], {
      cwd: fixtureDir,
      stores,
      config: false,
      output: new PassThrough() as unknown as NodeJS.WriteStream,
    });
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

    const tty = fakeTty();
    const running = executeConductorCommand(["tui"], {
      cwd: fixtureDir,
      stores,
      config: false,
      input: tty.input as unknown as NodeJS.ReadStream,
      output: tty.output as unknown as NodeJS.WriteStream,
      pollMs: 40,
    });

    await waitFor(() => tty.text, "conductor/LIVE-1--implement");
    const above = stripAnsi(tty.text);
    expect(above).toMatch(/^ RUN\s*$/m);
    expect(above).toContain("/tmp/conductor-src/.fsdev/workspaces/LIVE-1--implement");
    expect(above).toContain("x stop");

    tty.input.write("x");
    await waitFor(() => tty.text, "stop · req-live-1");
    await expect(stores.request.isAbortRequested("req-live-1")).resolves.toBe(true);

    tty.input.write("q");
    await expect(running).resolves.toBe(0);
  });
});
