import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PassThrough } from "node:stream";
import { createInMemoryStores } from "@flow-state-dev/engine";
import { executeConductorCommand } from "../src/commands/conductor";
import { readDrafts } from "../src/conductor/compose-history";
import { writeLastFocus } from "../src/conductor/last-focus";
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

function lastFrame(text: string): string {
  const marker = "\x1b[H\x1b[J";
  const at = text.lastIndexOf(marker);
  return at < 0 ? text : text.slice(at);
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

const priorRepo = process.env.CONDUCTOR_REPO;

beforeEach(() => {
  process.exitCode = undefined;
  delete process.env.CONDUCTOR_REPO;
});
afterEach(() => {
  process.exitCode = undefined;
  if (priorRepo === undefined) delete process.env.CONDUCTOR_REPO;
  else process.env.CONDUCTOR_REPO = priorRepo;
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
    expect(tty.text).toContain("\x1b]0;conductor · fixture-epic · 1 waiting\x1b\\");
    expect(tty.text).not.toContain("conductor-atlas-prove-public");

    tty.input.write("the real file\r");
    await waitFor(() => tty.text, "completed");

    tty.input.write("/quit\r");
    await expect(running).resolves.toBe(0);
  });

  it("names the product checkout in the tab title when CONDUCTOR_REPO is set", async () => {
    process.env.CONDUCTOR_REPO = "/tmp/fsd-product";
    const tty = fakeTty();
    const running = executeConductorCommand(["tui"], {
      cwd: fixtureDir,
      stores: createInMemoryStores(),
      config: false,
      input: tty.input as unknown as NodeJS.ReadStream,
      output: tty.output as unknown as NodeJS.WriteStream,
      pollMs: 80,
    });
    await waitFor(() => tty.text, "FSDEV CONDUCTOR");
    expect(tty.text).toContain("\x1b]0;conductor · fixture-epic · fsd-product\x1b\\");
    expect(stripAnsi(lastFrame(tty.text))).toContain("fsd-product");
    const beforeAlt = tty.text.slice(0, tty.text.indexOf("\x1b[?1049h"));
    expect(beforeAlt).toBe("fixture-epic · fsd-product\n");
    tty.input.write("/quit\r");
    await expect(running).resolves.toBe(0);
  });

  it("leaves the board name on the main screen so leftover CONDUCTOR_EPIC is visible after /quit", async () => {
    process.env.CONDUCTOR_REPO = "/tmp/fsd-product";
    const tty = fakeTty();
    const running = executeConductorCommand(["tui"], {
      cwd: fixtureDir,
      stores: createInMemoryStores(),
      config: false,
      input: tty.input as unknown as NodeJS.ReadStream,
      output: tty.output as unknown as NodeJS.WriteStream,
      pollMs: 80,
    });
    await waitFor(() => tty.text, "\x1b[?1049h");
    expect(tty.text.slice(0, tty.text.indexOf("\x1b[?1049h"))).toBe(
      "fixture-epic · fsd-product\n",
    );
    tty.input.write("/quit\r");
    await expect(running).resolves.toBe(0);
    expect(tty.text.startsWith("fixture-epic · fsd-product\n")).toBe(true);
    expect(tty.text).toContain("\x1b[?1049l");
  });

  it("start on a TTY seeds inside the board, not as a dump first", async () => {
    const stores = createInMemoryStores();
    const tty = fakeTty();
    const running = executeConductorCommand(["start", "LIVE-1"], {
      cwd: fixtureDir,
      stores,
      config: false,
      input: tty.input as unknown as NodeJS.ReadStream,
      output: tty.output as unknown as NodeJS.WriteStream,
      pollMs: 50,
    });
    await waitFor(() => lastFrame(tty.text), "LIVE-1");
    const alt = tty.text.indexOf("\x1b[?1049h");
    expect(alt).toBeGreaterThan(-1);
    const beforeAlt = stripAnsi(tty.text.slice(0, alt));
    expect(beforeAlt).not.toMatch(/ISSUE|PHASE/);
    expect(beforeAlt).not.toContain("LIVE-1");
    expect(stripAnsi(lastFrame(tty.text))).toMatch(/▸\s+LIVE-1/);
    expect(stripAnsi(lastFrame(tty.text))).toContain("seeded LIVE-1");
    tty.input.write("/quit\r");
    await expect(running).resolves.toBe(0);
  });

  it("start on a TTY focuses the seeded row even when last-focus remembered another", async () => {
    const stores = createInMemoryStores();
    const lastFocus = join(mkdtempSync(join(tmpdir(), "conductor-start-")), "tui-focus");
    await executeConductorCommand(["seed", "LIVE-1"], {
      cwd: fixtureDir,
      stores,
      config: false,
      output: new PassThrough() as unknown as NodeJS.WriteStream,
    });
    writeLastFocus(lastFocus, "LIVE-1");

    const tty = fakeTty();
    const running = executeConductorCommand(["start", "LIVE-2"], {
      cwd: fixtureDir,
      stores,
      config: false,
      lastFocusPath: lastFocus,
      input: tty.input as unknown as NodeJS.ReadStream,
      output: tty.output as unknown as NodeJS.WriteStream,
      pollMs: 50,
    });
    await waitFor(() => lastFrame(tty.text), "LIVE-2");
    expect(stripAnsi(lastFrame(tty.text))).toMatch(/▸\s+LIVE-2/);
    tty.input.write("/quit\r");
    await expect(running).resolves.toBe(0);
  });

  it("in-session seed selects the row it just filed", async () => {
    const stores = createInMemoryStores();
    await executeConductorCommand(["seed", "LIVE-1"], {
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
    await waitFor(() => stripAnsi(lastFrame(tty.text)), "▸");
    expect(stripAnsi(lastFrame(tty.text))).toMatch(/▸\s+LIVE-1/);

    tty.input.write("sLIVE-2\r");
    await waitFor(() => stripAnsi(lastFrame(tty.text)), "LIVE-2");
    expect(stripAnsi(lastFrame(tty.text))).toMatch(/▸\s+LIVE-2/);
    expect(stripAnsi(lastFrame(tty.text))).toContain("seeded LIVE-2");

    tty.input.write("/quit\r");
    await expect(running).resolves.toBe(0);
  });

  it("a talk turn that files a row selects that row", async () => {
    const stores = createInMemoryStores();
    await executeConductorCommand(["seed", "LIVE-1"], {
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
    await waitFor(() => stripAnsi(lastFrame(tty.text)), "▸");
    expect(stripAnsi(lastFrame(tty.text))).toMatch(/▸\s+LIVE-1/);

    tty.input.write("/steer start LIVE-2\r");
    await waitFor(() => stripAnsi(lastFrame(tty.text)), "LIVE-2");
    expect(stripAnsi(lastFrame(tty.text))).toMatch(/▸\s+LIVE-2/);

    tty.input.write("/quit\r");
    await expect(running).resolves.toBe(0);
  });

  it("wake selects the row that just started when you were watching another", async () => {
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
    await executeConductorCommand(["seed", "LIVE-2"], {
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
    await waitFor(() => stripAnsi(lastFrame(tty.text)), "▸");
    expect(stripAnsi(lastFrame(tty.text))).toMatch(/▸\s+LIVE-1/);

    tty.input.write("/wake\r");
    await waitFor(() => stripAnsi(lastFrame(tty.text)), "wake · drain ran");
    expect(stripAnsi(lastFrame(tty.text))).toMatch(/▸\s+LIVE-2/);

    tty.input.write("/quit\r");
    await expect(running).resolves.toBe(0);
  });

  it("a talk turn that retries a row selects the row that started", async () => {
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
    await executeConductorCommand(["seed", "LIVE-2"], {
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
    await waitFor(() => stripAnsi(lastFrame(tty.text)), "▸");
    expect(stripAnsi(lastFrame(tty.text))).toMatch(/▸\s+LIVE-1/);

    tty.input.write("/steer please retry the failed rows\r");
    await waitFor(() => stripAnsi(lastFrame(tty.text)), "woke the board");
    expect(stripAnsi(lastFrame(tty.text))).toMatch(/▸\s+LIVE-2/);

    tty.input.write("/quit\r");
    await expect(running).resolves.toBe(0);
  });

  it("wake leaves you on the selected row when that row is the one that started", async () => {
    const stores = createInMemoryStores();
    await executeConductorCommand(["seed", "LIVE-1"], {
      cwd: fixtureDir,
      stores,
      config: false,
      output: new PassThrough() as unknown as NodeJS.WriteStream,
    });
    await executeConductorCommand(["seed", "LIVE-2"], {
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
    await waitFor(() => stripAnsi(lastFrame(tty.text)), "▸");
    expect(stripAnsi(lastFrame(tty.text))).toMatch(/▸\s+LIVE-1/);

    tty.input.write("/wake\r");
    await waitFor(() => stripAnsi(lastFrame(tty.text)), "wake · drain ran");
    expect(stripAnsi(lastFrame(tty.text))).toMatch(/▸\s+LIVE-1/);

    tty.input.write("/quit\r");
    await expect(running).resolves.toBe(0);
  });

  it("does not enable mouse tracking so the terminal can select text", async () => {
    const tty = fakeTty();
    const running = executeConductorCommand(["tui"], {
      cwd: fixtureDir,
      stores: createInMemoryStores(),
      config: false,
      input: tty.input as unknown as NodeJS.ReadStream,
      output: tty.output as unknown as NodeJS.WriteStream,
      pollMs: 80,
    });
    await waitFor(() => tty.text, "FSDEV CONDUCTOR");
    expect(tty.text).not.toContain("\x1b[?1000h");
    expect(tty.text).not.toContain("\x1b[?1006h");
    tty.input.write("/quit\r");
    await expect(running).resolves.toBe(0);
    expect(tty.text).toContain("\x1b[?1000l");
    expect(tty.text).toContain("\x1b[?1006l");
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
    tty.input.write("/wake\r");
    await waitFor(() => tty.text, "Which path?");
    expect(tty.text).toContain("\x07");
    expect(tty.text).toContain("asked Which path?");
    expect(tty.text).toMatch(/parked ASK-1|drained |claiming /);

    tty.input.write("/quit\r");
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
    expect(tty.text).toContain("/wake");

    tty.input.write("/quit\r");
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

    tty.input.write("/quit\r");
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

    stores.request.persistEvents("req-live-1", [
      {
        stream: "request",
        type: "item.added",
        requestId: "req-live-1",
        sequence_number: 3,
        ts: 3,
        item: {
          id: "t2",
          type: "tool_output",
          status: "in_progress",
          blockName: "Bash",
          toolCall: {
            callId: "c2",
            name: "Bash",
            arguments: JSON.stringify({ command: "pnpm test" }),
            generatorBlock: "agent",
          },
        },
      } as never,
      {
        stream: "request",
        type: "item.done",
        requestId: "req-live-1",
        sequence_number: 4,
        ts: 4,
        item: {
          id: "t2",
          type: "tool_output",
          status: "failed",
          blockName: "Bash",
          output: "FAIL  test/foo.test.ts\nAssertionError: expected 1 to be 2\n",
          toolCall: {
            callId: "c2",
            name: "Bash",
            arguments: JSON.stringify({ command: "pnpm test" }),
            generatorBlock: "agent",
          },
        },
      } as never,
    ]);
    await waitFor(() => tty.text, "tool · Bash pnpm test · failed");
    await waitFor(() => tty.text, "AssertionError: expected 1 to be 2");

    tty.input.write("/quit\r");
    await expect(running).resolves.toBe(0);
  });

  it("keeps the other running row's tools off the selected transcript", async () => {
    const stores = createInMemoryStores();
    await executeConductorCommand(["seed", "LIVE-1"], {
      cwd: fixtureDir,
      stores,
      config: false,
      output: new PassThrough() as unknown as NodeJS.WriteStream,
    });
    await executeConductorCommand(["seed", "LIVE-2"], {
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

    await waitFor(() => tty.text, "LIVE-2");
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
          status: "in_progress",
          blockName: "Write",
          toolCall: {
            callId: "c1",
            name: "Write",
            arguments: JSON.stringify({
              file_path: "src/a.ts",
              contents: "export const a = 1;\n",
            }),
            generatorBlock: "agent",
          },
        },
      } as never,
    ]);
    stores.request.persistEvents("req-live-2", [
      {
        stream: "request",
        type: "item.added",
        requestId: "req-live-2",
        sequence_number: 1,
        ts: 1,
        item: {
          id: "t2",
          type: "tool_output",
          status: "in_progress",
          blockName: "Write",
          toolCall: {
            callId: "c2",
            name: "Write",
            arguments: JSON.stringify({
              file_path: "src/b.ts",
              contents: "export const b = 2;\n",
            }),
            generatorBlock: "agent",
          },
        },
      } as never,
    ]);
    await waitFor(() => lastFrame(tty.text), "tool · Write src/a.ts");
    expect(lastFrame(tty.text)).toContain("+ export const a = 1;");
    expect(lastFrame(tty.text)).toContain("Write src/b.ts");
    expect(lastFrame(tty.text)).not.toContain("+ export const b");

    tty.input.write("\x1b[B");
    await waitFor(() => lastFrame(tty.text), "tool · Write src/b.ts");
    expect(lastFrame(tty.text)).toContain("+ export const b = 2;");
    expect(lastFrame(tty.text)).toContain("Write src/a.ts");
    expect(lastFrame(tty.text)).not.toContain("+ export const a");

    tty.input.write("/quit\r");
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

    tty.input.write("/quit\r");
    await expect(running).resolves.toBe(0);
  });

  it("a row that finishes selects that row when compose is idle", async () => {
    const stores = createInMemoryStores();
    await executeConductorCommand(["seed", "LIVE-1"], {
      cwd: fixtureDir,
      stores,
      config: false,
      output: new PassThrough() as unknown as NodeJS.WriteStream,
    });
    await executeConductorCommand(["seed", "DONE-1"], {
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
    const running = executeConductorCommand(["tui", "LIVE-1"], {
      cwd: fixtureDir,
      stores,
      config: false,
      input: tty.input as unknown as NodeJS.ReadStream,
      output: tty.output as unknown as NodeJS.WriteStream,
      pollMs: 50,
    });

    await waitFor(() => lastFrame(tty.text), "LIVE-1");
    expect(stripAnsi(lastFrame(tty.text))).toMatch(/▸\s+LIVE-1/);

    tty.input.write("/wake\r");
    await waitFor(() => lastFrame(tty.text), "completed");
    expect(tty.text).toContain("\x07");
    expect(stripAnsi(lastFrame(tty.text))).toMatch(/▸\s+DONE-1/);

    tty.input.write("/quit\r");
    await expect(running).resolves.toBe(0);
  });

  it("a new question selects that row when compose is idle", async () => {
    const stores = createInMemoryStores();
    await executeConductorCommand(["seed", "LIVE-1"], {
      cwd: fixtureDir,
      stores,
      config: false,
      output: new PassThrough() as unknown as NodeJS.WriteStream,
    });
    await executeConductorCommand(["seed", "ASK-1"], {
      cwd: fixtureDir,
      stores,
      config: false,
      output: new PassThrough() as unknown as NodeJS.WriteStream,
    });

    const tty = fakeTty();
    const running = executeConductorCommand(["tui", "LIVE-1"], {
      cwd: fixtureDir,
      stores,
      config: false,
      input: tty.input as unknown as NodeJS.ReadStream,
      output: tty.output as unknown as NodeJS.WriteStream,
      pollMs: 50,
    });

    await waitFor(() => lastFrame(tty.text), "LIVE-1");
    expect(stripAnsi(lastFrame(tty.text))).toMatch(/▸\s+LIVE-1/);

    tty.input.write("/wake\r");
    await waitFor(() => tty.text, "Which path?");
    expect(tty.text).toContain("\x07");
    expect(stripAnsi(lastFrame(tty.text))).toMatch(/▸\s+ASK-1/);

    tty.input.write("/quit\r");
    await expect(running).resolves.toBe(0);
  });

  it("opening on an issue selects it once; later polls keep the row the operator moved to", async () => {
    const stores = createInMemoryStores();
    await executeConductorCommand(["seed", "LIVE-1"], {
      cwd: fixtureDir,
      stores,
      config: false,
      output: new PassThrough() as unknown as NodeJS.WriteStream,
    });
    await executeConductorCommand(["seed", "LIVE-2"], {
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
    const running = executeConductorCommand(["tui", "LIVE-2"], {
      cwd: fixtureDir,
      stores,
      config: false,
      input: tty.input as unknown as NodeJS.ReadStream,
      output: tty.output as unknown as NodeJS.WriteStream,
      pollMs: 80,
    });

    await waitFor(() => lastFrame(tty.text), "LIVE-2");
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(stripAnsi(lastFrame(tty.text))).toMatch(/▸\s+LIVE-2/);

    tty.input.write("\x1b[A");
    await waitFor(() => lastFrame(tty.text), "LIVE-1");
    await new Promise((resolve) => setTimeout(resolve, 200));
    const afterPoll = stripAnsi(lastFrame(tty.text));
    expect(afterPoll).toMatch(/▸\s+LIVE-1/);
    expect(afterPoll).not.toMatch(/▸\s+LIVE-2/);

    tty.input.write("/quit\r");
    await expect(running).resolves.toBe(0);
  });

  it("reopening the board selects the row you left", async () => {
    const stores = createInMemoryStores();
    const lastFocus = join(mkdtempSync(join(tmpdir(), "conductor-focus-")), "tui-focus");
    await executeConductorCommand(["seed", "LIVE-1"], {
      cwd: fixtureDir,
      stores,
      config: false,
      output: new PassThrough() as unknown as NodeJS.WriteStream,
    });
    await executeConductorCommand(["seed", "LIVE-2"], {
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

    const first = fakeTty();
    const firstRun = executeConductorCommand(["tui", "LIVE-2"], {
      cwd: fixtureDir,
      stores,
      config: false,
      lastFocusPath: lastFocus,
      input: first.input as unknown as NodeJS.ReadStream,
      output: first.output as unknown as NodeJS.WriteStream,
      pollMs: 80,
    });
    await waitFor(() => lastFrame(first.text), "LIVE-2");
    expect(stripAnsi(lastFrame(first.text))).toMatch(/▸\s+LIVE-2/);
    first.input.write("/quit\r");
    await expect(firstRun).resolves.toBe(0);

    const second = fakeTty();
    const secondRun = executeConductorCommand(["tui"], {
      cwd: fixtureDir,
      stores,
      config: false,
      lastFocusPath: lastFocus,
      input: second.input as unknown as NodeJS.ReadStream,
      output: second.output as unknown as NodeJS.WriteStream,
      pollMs: 80,
    });
    await waitFor(() => lastFrame(second.text), "LIVE-2");
    expect(stripAnsi(lastFrame(second.text))).toMatch(/▸\s+LIVE-2/);
    second.input.write("/quit\r");
    await expect(secondRun).resolves.toBe(0);
  });

  it("a waiting row wins over the remembered row when you reopen", async () => {
    const stores = createInMemoryStores();
    const lastFocus = join(mkdtempSync(join(tmpdir(), "conductor-focus-")), "tui-focus");
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

    const first = fakeTty();
    const firstRun = executeConductorCommand(["tui", "LIVE-1"], {
      cwd: fixtureDir,
      stores,
      config: false,
      lastFocusPath: lastFocus,
      input: first.input as unknown as NodeJS.ReadStream,
      output: first.output as unknown as NodeJS.WriteStream,
      pollMs: 80,
    });
    await waitFor(() => lastFrame(first.text), "LIVE-1");
    first.input.write("/quit\r");
    await expect(firstRun).resolves.toBe(0);

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

    const second = fakeTty();
    const secondRun = executeConductorCommand(["tui"], {
      cwd: fixtureDir,
      stores,
      config: false,
      lastFocusPath: lastFocus,
      input: second.input as unknown as NodeJS.ReadStream,
      output: second.output as unknown as NodeJS.WriteStream,
      pollMs: 80,
    });
    await waitFor(() => lastFrame(second.text), "Which path?");
    expect(second.text).toContain("\x07");
    expect(stripAnsi(lastFrame(second.text))).toMatch(/▸\s+ASK-1/);
    second.input.write("/quit\r");
    await expect(secondRun).resolves.toBe(0);
  });

  it("an explicit tui issue wins over the remembered row", async () => {
    const stores = createInMemoryStores();
    const lastFocus = join(mkdtempSync(join(tmpdir(), "conductor-focus-")), "tui-focus");
    await executeConductorCommand(["seed", "LIVE-1"], {
      cwd: fixtureDir,
      stores,
      config: false,
      output: new PassThrough() as unknown as NodeJS.WriteStream,
    });
    await executeConductorCommand(["seed", "LIVE-2"], {
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

    const remembered = fakeTty();
    const rememberedRun = executeConductorCommand(["tui", "LIVE-2"], {
      cwd: fixtureDir,
      stores,
      config: false,
      lastFocusPath: lastFocus,
      input: remembered.input as unknown as NodeJS.ReadStream,
      output: remembered.output as unknown as NodeJS.WriteStream,
      pollMs: 80,
    });
    await waitFor(() => lastFrame(remembered.text), "LIVE-2");
    remembered.input.write("/quit\r");
    await expect(rememberedRun).resolves.toBe(0);

    const explicit = fakeTty();
    const explicitRun = executeConductorCommand(["tui", "LIVE-1"], {
      cwd: fixtureDir,
      stores,
      config: false,
      lastFocusPath: lastFocus,
      input: explicit.input as unknown as NodeJS.ReadStream,
      output: explicit.output as unknown as NodeJS.WriteStream,
      pollMs: 80,
    });
    await waitFor(() => lastFrame(explicit.text), "LIVE-1");
    expect(stripAnsi(lastFrame(explicit.text))).toMatch(/▸\s+LIVE-1/);
    expect(stripAnsi(lastFrame(explicit.text))).not.toMatch(/▸\s+LIVE-2/);
    explicit.input.write("/quit\r");
    await expect(explicitRun).resolves.toBe(0);
  });

  it("reopening the board recalls a prior talk line", async () => {
    const stores = createInMemoryStores();
    const lastDrafts = join(mkdtempSync(join(tmpdir(), "conductor-drafts-")), "tui-drafts");

    const first = fakeTty();
    const firstRun = executeConductorCommand(["tui"], {
      cwd: fixtureDir,
      stores,
      config: false,
      lastDraftsPath: lastDrafts,
      input: first.input as unknown as NodeJS.ReadStream,
      output: first.output as unknown as NodeJS.WriteStream,
      pollMs: 80,
    });
    await waitFor(() => lastFrame(first.text), "FSDEV CONDUCTOR");
    first.input.write("please retry the failed rows\r");
    await waitFor(() => lastFrame(first.text), "you ·");
    first.input.write("/quit\r");
    await expect(firstRun).resolves.toBe(0);
    expect(readDrafts(lastDrafts)).toEqual(["please retry the failed rows"]);

    const second = fakeTty();
    const secondRun = executeConductorCommand(["tui"], {
      cwd: fixtureDir,
      stores,
      config: false,
      lastDraftsPath: lastDrafts,
      input: second.input as unknown as NodeJS.ReadStream,
      output: second.output as unknown as NodeJS.WriteStream,
      pollMs: 80,
    });
    await waitFor(() => lastFrame(second.text), "FSDEV CONDUCTOR");
    second.input.write("z");
    await waitFor(() => lastFrame(second.text), "↑ prior");
    second.input.write("\x1b[A");
    await waitFor(() => stripAnsi(lastFrame(second.text)), "❯ please retry the failed rows");
    second.input.write("\x1b");
    await waitFor(() => lastFrame(second.text), "type to talk");
    second.input.write("/quit\r");
    await expect(secondRun).resolves.toBe(0);
  });

  it("reopening the board still shows the last talk on the transcript", async () => {
    const stores = createInMemoryStores();
    const lastTalk = join(mkdtempSync(join(tmpdir(), "conductor-talk-")), "tui-talk");

    const first = fakeTty();
    const firstRun = executeConductorCommand(["tui"], {
      cwd: fixtureDir,
      stores,
      config: false,
      lastTalkPath: lastTalk,
      input: first.input as unknown as NodeJS.ReadStream,
      output: first.output as unknown as NodeJS.WriteStream,
      pollMs: 80,
    });
    await waitFor(() => lastFrame(first.text), "FSDEV CONDUCTOR");
    first.input.write("quiet first look\r");
    await waitFor(() => lastFrame(first.text), "coord · first look");
    first.input.write("/quit\r");
    await expect(firstRun).resolves.toBe(0);

    const second = fakeTty();
    const secondRun = executeConductorCommand(["tui"], {
      cwd: fixtureDir,
      stores,
      config: false,
      lastTalkPath: lastTalk,
      input: second.input as unknown as NodeJS.ReadStream,
      output: second.output as unknown as NodeJS.WriteStream,
      pollMs: 80,
    });
    await waitFor(() => lastFrame(second.text), "you · quiet first look");
    await waitFor(() => lastFrame(second.text), "coord · first look");
    const frame = stripAnsi(lastFrame(second.text));
    expect(frame).toContain("you · quiet first look");
    expect(frame).toContain("coord · first look");
    expect(frame).not.toContain("nothing yet. type to talk.");
    second.input.write("/quit\r");
    await expect(secondRun).resolves.toBe(0);
  });

  it("Ctrl-C during a drain aborts the wake even if the operator hits r first", async () => {
    const stores = createInMemoryStores();
    await executeConductorCommand(["seed", "HANG-1"], {
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
      pollMs: 10_000,
    });

    await waitFor(() => tty.text, "HANG-1");
    tty.input.write("/wake\r");
    await waitFor(() => tty.text, "hanging until abort");
    expect(stripAnsi(lastFrame(tty.text))).toContain("working");

    tty.input.write("r");
    tty.input.write("\x03");
    await waitFor(() => tty.text, "abort requested");

    const deadline = Date.now() + 2_000;
    let wake;
    while (Date.now() < deadline) {
      const records = await stores.request.list();
      wake = records.find((record) => record.actionName === "wake");
      if (wake?.abortRequested === true || wake?.status === "aborted") break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(wake, "wake request should exist").toBeDefined();
    expect(wake?.abortRequested === true || wake?.status === "aborted").toBe(true);

    const statusReads = (await stores.request.list()).filter((record) => record.actionName === "status");
    expect(statusReads.some((record) => record.abortRequested === true)).toBe(false);

    tty.input.write("/quit\r");
    await expect(running).resolves.toBe(0);
  });

  it("leaves the board by stopping a run that is still going", async () => {
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

    await waitFor(() => tty.text, "LIVE-1");
    tty.input.write("/quit\r");
    await expect(running).resolves.toBe(0);
    await expect(stores.request.isAbortRequested("req-live-1")).resolves.toBe(true);
  });

  it("returns from /quit without waiting for a host dispose that never finishes", async () => {
    const tty = fakeTty();
    const started = Date.now();
    const running = executeConductorCommand(["tui"], {
      cwd: fixtureDir,
      stores: createInMemoryStores(),
      config: false,
      input: tty.input as unknown as NodeJS.ReadStream,
      output: tty.output as unknown as NodeJS.WriteStream,
      pollMs: 10_000,
      leaveDrainMs: 30,
      dispose: () => new Promise(() => {}),
    });
    await waitFor(() => tty.text, "no rows");
    tty.input.write("/quit\r");
    await expect(running).resolves.toBe(0);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("keeps /quit typed before the first status returns", async () => {
    const tty = fakeTty();
    const running = executeConductorCommand(["tui"], {
      cwd: fixtureDir,
      stores: createInMemoryStores(),
      config: false,
      input: tty.input as unknown as NodeJS.ReadStream,
      output: tty.output as unknown as NodeJS.WriteStream,
      pollMs: 10_000,
    });
    await waitFor(() => tty.text, "no rows");
    tty.input.write("/quit\r");
    await expect(running).resolves.toBe(0);
  });

  it("shows a second talk turn that uses the same words when the stream did not write one", async () => {
    const stores = createInMemoryStores();
    const tty = fakeTty();
    const running = executeConductorCommand(["tui"], {
      cwd: fixtureDir,
      stores,
      config: false,
      input: tty.input as unknown as NodeJS.ReadStream,
      output: tty.output as unknown as NodeJS.WriteStream,
      pollMs: 10_000,
    });

    await waitFor(() => tty.text, "type to talk");
    tty.input.write("quiet same look\r");
    await waitFor(() => tty.text, "coord · same look");
    tty.input.write("quiet same look\r");
    await waitFor(() => {
      const frame = stripAnsi(lastFrame(tty.text));
      return frame.split("you · quiet same look").length - 1 >= 2 ? "two you" : "";
    }, "two you");
    const frame = stripAnsi(lastFrame(tty.text));
    expect(frame.split("you · quiet same look").length - 1).toBeGreaterThanOrEqual(2);
    expect(frame.split("coord · same look").length - 1).toBeGreaterThanOrEqual(2);

    tty.input.write("/quit\r");
    await expect(running).resolves.toBe(0);
  });

  it("shows the second talk reply when the stream did not write one", async () => {
    const stores = createInMemoryStores();
    const tty = fakeTty();
    const running = executeConductorCommand(["tui"], {
      cwd: fixtureDir,
      stores,
      config: false,
      input: tty.input as unknown as NodeJS.ReadStream,
      output: tty.output as unknown as NodeJS.WriteStream,
      pollMs: 10_000,
    });

    await waitFor(() => tty.text, "type to talk");
    tty.input.write("quiet first look\r");
    await waitFor(() => tty.text, "coord · first look");
    tty.input.write("quiet second look\r");
    await waitFor(() => tty.text, "coord · second look");
    const frame = stripAnsi(lastFrame(tty.text));
    expect(frame).toContain("you · quiet first look");
    expect(frame).toContain("coord · first look");
    expect(frame).toContain("you · quiet second look");
    expect(frame).toContain("coord · second look");

    tty.input.write("/quit\r");
    await expect(running).resolves.toBe(0);
  });

  it("cancels seed compose on Esc without another key", async () => {
    const stores = createInMemoryStores();
    const tty = fakeTty();
    const running = executeConductorCommand(["tui"], {
      cwd: fixtureDir,
      stores,
      config: false,
      input: tty.input as unknown as NodeJS.ReadStream,
      output: tty.output as unknown as NodeJS.WriteStream,
      pollMs: 10_000,
    });

    await waitFor(() => tty.text, "type to talk");
    tty.input.write("s");
    await waitFor(() => stripAnsi(lastFrame(tty.text)), "❯ seed");
    expect(stripAnsi(lastFrame(tty.text))).toContain("issue id");

    tty.input.write("\x1b");
    await waitFor(() => {
      const frame = stripAnsi(lastFrame(tty.text));
      return frame.includes("❯ seed") ? "" : "idle";
    }, "idle");
    const frame = stripAnsi(lastFrame(tty.text));
    expect(frame).not.toContain("❯ seed");
    expect(frame).toContain("type to talk  ·  s seed");
    expect(frame).not.toContain("seeded");

    tty.input.write("/quit\r");
    await expect(running).resolves.toBe(0);
  });

  it("talks from an empty board even when the first letter is a row key", async () => {
    const stores = createInMemoryStores();
    const tty = fakeTty();
    const running = executeConductorCommand(["tui"], {
      cwd: fixtureDir,
      stores,
      config: false,
      input: tty.input as unknown as NodeJS.ReadStream,
      output: tty.output as unknown as NodeJS.WriteStream,
      pollMs: 10_000,
    });

    await waitFor(() => tty.text, "type to talk");
    tty.input.write("what's on the board?\r");
    await waitFor(() => tty.text, "you · what's on the board?");
    await waitFor(() => tty.text, "No rows yet");

    tty.input.write("/quit\r");
    await expect(running).resolves.toBe(0);
  });
});
