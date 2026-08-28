import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { PassThrough } from "node:stream";
import { createInMemoryStores } from "@flow-state-dev/engine";
import { executeConductorCommand } from "../src/commands/conductor";

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
});
