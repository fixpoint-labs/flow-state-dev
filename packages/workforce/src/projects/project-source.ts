/**
 * `projectSourceCapability`: a worker reads the project its session works in,
 * without a coding run.
 *
 * Three tools, `globProjectSource`, `readProjectSource` and
 * `grepProjectSource`, in one preset, `read`, which a worker picks in its own
 * file (`capabilities: { projectSource: [read] }`). Each tool asks the
 * workspace host's own run source for the session's project (for an app that
 * runs coding on projects, `projectWorkspace()`), then the host's read view
 * (`WorkspaceHost.readSource`) for the files. So the lookup, the membership
 * check and the refusals are the coding run's, by construction, and the host
 * owns the clone, the remote allowlist and the caps. The tools only pass the
 * question on and the answer back.
 *
 * A refusal is a tool result, never a thrown error: `{ kind: "refused",
 * reason, message }`, with the reason and message the source or the host
 * gave, so the model can say why. No tool here writes, and no preset adds one:
 * a change to a project's files is a coding run's job.
 */

import { defineCapability, handler, type LooseBlockContext } from "@flow-state-dev/core";
import {
  SOURCE_READ_LIMITS,
  WorkspaceRefusedError,
  type SourceReadRequest,
  type SourceReadResult,
  type WorkspaceHost
} from "@flow-state-dev/workspace";
import { z } from "zod";
import { projectWorkspaceCapability } from "./project-workspace";

/** The capability's name, as a worker's file names it under `capabilities:`. */
export const PROJECT_SOURCE_CAPABILITY = "projectSource";

/** Options for {@link projectSourceCapability}. */
export interface ProjectSourceCapabilityOptions {
  /**
   * The workspace host the app's coding runs use, built with
   * `source: projectWorkspace()`. It must have a read view (`readSource`).
   */
  workspace: WorkspaceHost;
}

/** What a read the source or the host refused answers. */
const refusedSchema = z.object({ kind: z.literal("refused"), reason: z.string(), message: z.string() });

/** Where a read came from: a commit of the repository, or the kept files. */
const atSchema = z.union([
  z.object({
    kind: z.literal("repo"),
    commit: z.string(),
    branch: z.string(),
    fetchedAt: z.string().nullable(),
    ageMs: z.number().nullable()
  }),
  z.object({ kind: z.literal("files") })
]);

const cutSchema = z.object({ left: z.number(), by: z.enum(["paths", "lines", "bytes", "matches", "limit"]) }).nullable();

/** What `globProjectSource` answers. */
export const globProjectSourceOutputSchema = z.union([
  refusedSchema,
  z.object({ kind: z.literal("glob"), at: atSchema, paths: z.array(z.string()), cut: cutSchema })
]);

/** What `readProjectSource` answers. */
export const readProjectSourceOutputSchema = z.union([
  refusedSchema,
  z.object({
    kind: z.literal("read"),
    at: atSchema,
    path: z.string(),
    status: z.enum(["ok", "missing", "directory", "binary", "too-large"]),
    content: z.string().optional(),
    startLine: z.number().optional(),
    endLine: z.number().optional(),
    totalLines: z.number().optional(),
    bytes: z.number().optional(),
    cut: cutSchema.optional()
  })
]);

/** What `grepProjectSource` answers. */
export const grepProjectSourceOutputSchema = z.union([
  refusedSchema,
  z.object({
    kind: z.literal("grep"),
    at: atSchema,
    dialect: z.enum(["extended-regex", "javascript-regex", "literal"]),
    matches: z.array(z.object({ path: z.string(), line: z.number(), snippet: z.string() })),
    binary: z.literal("skipped"),
    cut: cutSchema
  })
]);

/** A refusal, from the run source or the host, as a tool answers it. */
type Refused = z.infer<typeof refusedSchema>;

/**
 * The host's result types and the tools' recorded schemas describe the same
 * payload. This fails to compile when a field or a value the host can return
 * is missing from the schemas.
 */
type ToolAnswer =
  | z.infer<typeof globProjectSourceOutputSchema>
  | z.infer<typeof readProjectSourceOutputSchema>
  | z.infer<typeof grepProjectSourceOutputSchema>;
const schemasCoverHostResults = (answer: SourceReadResult | Refused): ToolAnswer => answer;
void schemasCoverHostResults;

/**
 * One read of the session's project: the host's run source finds the project
 * (or refuses), and the host's read view answers. A refusal from either comes
 * back as a result. Shared by the three tools; exported for its tests.
 */
export async function readProjectSourceFor(
  workspace: WorkspaceHost,
  ctx: LooseBlockContext,
  request: SourceReadRequest
): Promise<SourceReadResult | Refused> {
  const answer = await workspace.source(ctx);
  if (answer.kind === "refused") return { kind: "refused", reason: answer.reason, message: answer.message };
  try {
    return await workspace.readSource!(answer, request);
  } catch (error) {
    if (error instanceof WorkspaceRefusedError) return { kind: "refused", reason: error.reason, message: error.message };
    throw error;
  }
}

/**
 * The three read tools over `workspace`. An app installs them through the
 * capability, or, for workers that write a `tools:` line, puts them in its
 * worker flow's catalog and `uses` {@link projectWorkspaceCapability}, whose
 * collections they read.
 */
export function projectSourceTools(workspace: WorkspaceHost) {
  const globProjectSource = handler({
    name: "globProjectSource",
    description:
      "List the files of the project this session works in whose path matches a glob pattern (e.g. 'src/**', '**/*.ts'). " +
      "With no pattern, lists every file. A project with a repository is read at its default branch, and the result names the commit. " +
      `At most ${SOURCE_READ_LIMITS.paths} paths; the result says how many more there were.`,
    inputSchema: z.object({
      pattern: z.string().nullable().default(null).describe("Glob matched against each path from the project's root. Null lists every file."),
      limit: z.number().int().positive().nullable().default(null).describe(`At most this many paths. Null: up to ${SOURCE_READ_LIMITS.paths}.`)
    }),
    outputSchema: globProjectSourceOutputSchema,
    // The run source reads these, as the tool's own.
    uses: [projectWorkspaceCapability],
    execute: async (input, ctx) =>
      (await readProjectSourceFor(workspace, ctx, { kind: "glob", pattern: input.pattern, limit: input.limit })) as never
  });

  const readProjectSource = handler({
    name: "readProjectSource",
    description:
      "Read one file of the project this session works in, by its path from the project's root (e.g. 'src/index.ts'), or a range of its lines. " +
      `Returns at most ${SOURCE_READ_LIMITS.lines} lines or ${SOURCE_READ_LIMITS.bytes / 1024} KB, with the file's line count; the result says how many lines were left out, so read on with startLine. ` +
      "Binary files are refused.",
    inputSchema: z.object({
      path: z.string().describe("The file's path from the project's root, '/'-separated, e.g. 'src/index.ts'."),
      startLine: z.number().int().positive().nullable().default(null).describe("First line to return, counting from 1. Null: 1."),
      endLine: z.number().int().positive().nullable().default(null).describe("Last line to return. Null: the end of the file.")
    }),
    outputSchema: readProjectSourceOutputSchema,
    // The run source reads these, as the tool's own.
    uses: [projectWorkspaceCapability],
    execute: async (input, ctx) =>
      (await readProjectSourceFor(workspace, ctx, {
        kind: "read",
        path: input.path,
        startLine: input.startLine,
        endLine: input.endLine
      })) as never
  });

  const grepProjectSource = handler({
    name: "grepProjectSource",
    description:
      "Search the files of the project this session works in for a regular expression, or for the text as written when it isn't one. " +
      "The result names the dialect it used: git's extended regular expressions for a repository, JavaScript's for a project with no repository. " +
      `Returns each matching line's path, line number and text. Binary files are skipped. At most ${SOURCE_READ_LIMITS.matches} matches.`,
    inputSchema: z.object({
      pattern: z.string().describe("Regular expression or text to find in each line."),
      prefix: z.string().nullable().default(null).describe("Search only files at or under this path, e.g. 'src/billing'. Null searches every file."),
      maxResults: z.number().int().positive().nullable().default(null).describe(`At most this many matches. Null: up to ${SOURCE_READ_LIMITS.matches}.`)
    }),
    outputSchema: grepProjectSourceOutputSchema,
    // The run source reads these, as the tool's own.
    uses: [projectWorkspaceCapability],
    execute: async (input, ctx) =>
      (await readProjectSourceFor(workspace, ctx, {
        kind: "grep",
        pattern: input.pattern,
        prefix: input.prefix,
        maxResults: input.maxResults
      })) as never
  });

  return { globProjectSource, readProjectSource, grepProjectSource };
}

/**
 * The capability a worker flow installs so its workers can read their
 * session's project.
 *
 * Its one preset, `read`, is off until a worker's own file names it:
 *
 * ```yaml
 * capabilities:
 *   projectSource: [read]
 * ```
 *
 * It carries {@link projectWorkspaceCapability}, whose collections the run
 * source reads.
 *
 * @param options `workspace`: the host the app's coding runs use.
 * @throws When the host has no read view (`readSource`).
 * @example
 *   const workspace = localWorkspaceHost({ root, remotes: { allow: ["github.com"] }, source: projectWorkspace() });
 *   defineAgentWorkerFlow({ installation, model, uses: [projectSourceCapability({ workspace })] });
 */
export function projectSourceCapability(options: ProjectSourceCapabilityOptions) {
  const { workspace } = options;
  if (typeof workspace.readSource !== "function") {
    throw new Error(
      "projectSourceCapability: the workspace host has no read view (`readSource`), so its workers would have no way to " +
        "read a project. Pass a host that has one, such as `localWorkspaceHost`."
    );
  }
  const tools = projectSourceTools(workspace);
  return defineCapability({
    name: PROJECT_SOURCE_CAPABILITY,
    uses: [projectWorkspaceCapability],
    presets: {
      read: { tools: [tools.globProjectSource, tools.readProjectSource, tools.grepProjectSource] },
      default: []
    }
  });
}
