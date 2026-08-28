import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { Writable } from "node:stream";
import { createInMemoryStores } from "@flow-state-dev/engine";
import { executeConductorCommand } from "../src/commands/conductor";
import { CliError } from "../src/resolve-block";
import { EXIT_DISCOVERY_ERROR, EXIT_INVALID_ARGS } from "../src/exit-codes";

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
});

describe("fsdev conductor — headless against a conductor-shaped flow", () => {
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
  });

  it("refuses a verb the parser does not know", async () => {
    await expect(
      executeConductorCommand(["nope"], {
        cwd: fixtureDir,
        stores: createInMemoryStores(),
        config: false,
      }),
    ).rejects.toMatchObject({ exitCode: EXIT_INVALID_ARGS });
  });

  it("is fatal when no conductor flow is discovered", async () => {
    const err = await executeConductorCommand(["status"], {
      cwd: emptyDir,
      stores: createInMemoryStores(),
      config: false,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).exitCode).toBe(EXIT_DISCOVERY_ERROR);
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
});
