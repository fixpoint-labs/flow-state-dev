/**
 * `babysit <issueId>` — the orchestrator CLI entrypoint.
 *
 * Wires the production dependencies (the GraphQL Linear transport, the `gh`
 * exec, SQLite durability under `.dev-orchestrator/`, the PATH `claude`
 * resolver) and runs the babysit loop against one issue. Observability is
 * stdout (a structured line per tick) plus the Linear timeline (the loop and
 * the stage comment on transitions and gates). Safety: the loop only advances
 * forward through non-destructive states and stops at every human gate — it
 * never merges and never crosses a gate unattended.
 *
 * Usage:
 *   babysit FIX-123 [--attended] [--from-backlog] [--db <path>]
 *
 * Env: LINEAR_MCP_API_KEY (Linear access), plus `claude` and `gh` on PATH.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { buildDevOrchestratorFlow } from "../flow/flow";
import { createOrchestratorRuntime } from "./runtime";
import { babysit } from "./babysit";
import { createStdinHumanGate, createLinearHumanGate } from "./human-gate";
import { LinearStatusClient, createLinearGraphQLTransport } from "../signals/linear";
import { GitHubSignalClient, defaultGhExec } from "../signals/github";

interface ParsedArgs {
  issueId: string;
  attended: boolean;
  fromBacklog: boolean;
  dbPath: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  let attended = false;
  let fromBacklog = false;
  let dbPath = "";

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--attended") attended = true;
    else if (arg === "--from-backlog") fromBacklog = true;
    else if (arg === "--db") {
      dbPath = argv[i + 1] ?? "";
      i += 1;
    } else positional.push(arg);
  }

  const issueId = positional[0];
  if (issueId === undefined) {
    throw new Error("Usage: babysit <issueId> [--attended] [--from-backlog] [--db <path>]");
  }
  if (dbPath === "") {
    dbPath = path.join(process.cwd(), ".dev-orchestrator", `${issueId}.sqlite`);
  }
  return { issueId, attended, fromBacklog, dbPath };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const apiKey = process.env.LINEAR_MCP_API_KEY;
  if (apiKey === undefined || apiKey === "") {
    throw new Error("LINEAR_MCP_API_KEY is required (the orchestrator's deterministic Linear access).");
  }

  mkdirSync(path.dirname(args.dbPath), { recursive: true });

  const linear = new LinearStatusClient(createLinearGraphQLTransport({ apiKey }));
  const github = new GitHubSignalClient(defaultGhExec);
  const runtime = createOrchestratorRuntime(args.dbPath);
  const flow = buildDevOrchestratorFlow({ linear, repoRoot: process.cwd() });

  console.log(`[orchestrator] babysitting ${args.issueId} (db: ${args.dbPath})`);

  try {
    const result = await babysit({
      issueId: args.issueId,
      flow,
      stores: runtime.stores,
      provider: runtime.provider,
      linear,
      github,
      humanGate: args.attended ? createStdinHumanGate() : createLinearHumanGate(),
      fromBacklog: args.fromBacklog,
      log: (line) => console.log(JSON.stringify({ at: new Date().toISOString(), ...line })),
    });
    console.log(`[orchestrator] stopped: ${result.reason} (final state: ${result.finalState ?? "unknown"})`);
  } finally {
    runtime.close();
  }
}

main().catch((err) => {
  console.error(`[orchestrator] fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
