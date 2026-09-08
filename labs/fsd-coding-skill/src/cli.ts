/**
 * Skill-facing CLI: parse one door + payload, boot the host, run that entry.
 *
 * The outer agent is not allowed to invent a second path. This module is
 * the only runner the skill names.
 */
import {
  createInMemoryStores,
  runAction,
  type RuntimeConfig,
  type StoreRegistry,
} from "@flow-state-dev/engine";
import { createFsdCodingFlow, type FsdCodingHostOptions } from "./flow";
import { DOORS, type CodingDoor } from "./schemas";

const CLI_TO_DOOR: Record<string, CodingDoor> = {
  implement: "implement",
  fix: "fix",
  "open-pr": "openPr",
  openPr: "openPr",
  "fix-fsd": "fixFsd",
  fixFsd: "fixFsd",
};

export interface ParsedCli {
  /** Host-selected adapter; CLI parsing defaults to Cursor. */
  harness?: FsdCodingHostOptions["harness"];
  /** Explicit host model override; omitted preserves adapter configuration. */
  model?: string;
  /** Extra host-selected writable directories for Codex workspace-write runs. */
  additionalDirectories?: string[];
  door: CodingDoor;
  cwd: string;
  sessionId: string;
  userId: string;
  sessionFile: string | undefined;
  input: { task: string } | { repro: string; notes?: string };
}

export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new CliUsageError(`--${name} needs a value`);
  }
  return value;
}

function repeatedFlag(args: string[], name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== `--${name}`) continue;
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new CliUsageError(`--${name} needs a value`);
    }
    if (value.trim() === "") {
      throw new CliUsageError(`--${name} needs a value`);
    }
    values.push(value);
  }
  return values;
}

/**
 * Parse `run.ts` argv (already minus the node/script prefix).
 */
export function parseArgs(argv: string[]): ParsedCli {
  const [rawDoor, ...rest] = argv;
  if (rawDoor === undefined || rawDoor.startsWith("--")) {
    throw new CliUsageError(
      "usage: run.ts <implement|fix|open-pr|fix-fsd> --task <text> | --repro <text>",
    );
  }
  const door = CLI_TO_DOOR[rawDoor];
  if (door === undefined) {
    throw new CliUsageError(
      `unknown door "${rawDoor}". declared doors: ${Object.keys(CLI_TO_DOOR).join(", ")}`,
    );
  }

  const cwd = flag(rest, "cwd") ?? process.env.FSD_CODING_CWD ?? process.cwd();
  const harness = flag(rest, "harness") ?? "cursor";
  if (harness !== "codex" && harness !== "cursor") {
    throw new CliUsageError(`invalid harness "${harness}"; expected codex or cursor`);
  }
  const sessionId = flag(rest, "session") ?? "fsd-coding";
  const model = flag(rest, "model");
  if (model !== undefined && model.trim() === "") {
    throw new CliUsageError("--model needs a value");
  }
  const additionalDirectories = repeatedFlag(rest, "add-dir");
  if (additionalDirectories.length > 0 && harness !== "codex") {
    throw new CliUsageError("--add-dir is only supported with --harness codex");
  }
  const addDirs = additionalDirectories.length === 0 ? undefined : additionalDirectories;
  const userId = flag(rest, "user") ?? "cli-user";
  const sessionFile = flag(rest, "session-file") ?? process.env.FSD_CODING_SESSION_FILE;
  const task = flag(rest, "task");
  const repro = flag(rest, "repro");
  const notes = flag(rest, "notes");

  if (door === "fixFsd") {
    if (repro === undefined) throw new CliUsageError("fix-fsd requires --repro");
    return { door, harness, model, additionalDirectories: addDirs, cwd, sessionId, userId, sessionFile, input: { repro, notes } };
  }
  if (task === undefined) throw new CliUsageError(`${rawDoor} requires --task`);
  return { door, harness, model, additionalDirectories: addDirs, cwd, sessionId, userId, sessionFile, input: { task } };
}

export interface RunCliOptions extends ParsedCli {
  host?: Omit<FsdCodingHostOptions, "cwd" | "sessionFile" | "harness" | "model">;
  stores?: StoreRegistry;
  runtimeConfig?: RuntimeConfig;
}

/**
 * Boot the host and run exactly one declared door.
 */
export async function runCli(options: RunCliOptions) {
  const flow = createFsdCodingFlow({
    ...(options.host ?? {}),
    harness: options.harness,
    model: options.model,
    additionalDirectories: options.additionalDirectories,
    cwd: options.cwd,
    sessionFile: options.sessionFile,
  });
  const stores = options.stores ?? createInMemoryStores();
  const result = await runAction({
    flow,
    actionName: options.door,
    input: options.input,
    userId: options.userId,
    sessionId: options.sessionId,
    stores,
    runtimeConfig: options.runtimeConfig ?? {},
  });
  return { result, stores, door: options.door, doors: DOORS };
}
