/**
 * `sourceReadCapability`: a worker reads the source its app's workspace host
 * runs on, with no coding run and no project.
 *
 * The same three reads as `projectSourceCapability` (`globSource`,
 * `readSource`, `grepSource`), over the host's own run source and read view,
 * in one preset, `read`, which a worker picks in its own file
 * (`capabilities: { sourceRead: [read] }`). It names no project to the model
 * and installs no project resources: an app with no projects gives its host a
 * fixed source (one checkout), and a worker reads that. A refusal from the
 * source or the host is a tool result, never a thrown error. No tool writes.
 */
import { defineCapability } from "@flow-state-dev/core";
import type { WorkspaceHost } from "@flow-state-dev/workspace";
import { sourceReadTools } from "./projects/project-source";

/** The capability's name, as a worker's file names it under `capabilities:`. */
const SOURCE_READ_CAPABILITY = "sourceRead";

/** Options for {@link sourceReadCapability}. */
export interface SourceReadCapabilityOptions {
  /** The workspace host whose run source the reads read. It must have a read view (`readSource`). */
  workspace: WorkspaceHost;
}

/**
 * The capability a worker flow installs so its workers can read the host's
 * source. Its one preset, `read`, is off until a worker's own file names it.
 *
 * @throws When the host has no read view (`readSource`).
 * @example
 *   const workspace = localWorkspaceHost({ root, remotes: { allow: [] }, source: () => ({ kind: "repo", repo }) });
 *   workforce({ agent: { model, uses: [sourceReadCapability({ workspace })] } });
 */
export function sourceReadCapability(options: SourceReadCapabilityOptions) {
  const { workspace } = options;
  if (typeof workspace.readSource !== "function") {
    throw new Error(
      "sourceReadCapability: the workspace host has no read view (`readSource`), so its workers would have no way to " +
        "read its source. Pass a host that has one, such as `localWorkspaceHost`.",
    );
  }
  const tools = sourceReadTools(workspace, {
    names: { glob: "globSource", read: "readSource", grep: "grepSource" },
    what: "the source you work on",
    root: "its root",
    uses: [],
  });
  return defineCapability({
    name: SOURCE_READ_CAPABILITY,
    presets: { read: { tools: [tools.glob, tools.read, tools.grep] }, default: [] },
  });
}
