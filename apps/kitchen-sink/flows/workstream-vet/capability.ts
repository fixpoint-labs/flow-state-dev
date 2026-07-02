/**
 * workstream-vet — the shared-workspace capability.
 *
 * The workstream's shared surface, injected into every member via `uses`
 * (n=1 member in the vet; multi-member injection is the same mechanism).
 * Contributes one context preset that renders the workspace — objective,
 * draft count, and the latest human feedback — under a
 * `<workstream-workspace>` tag.
 *
 * `formatWorkspaceContext` is exported so the unit test can assert the
 * rendered context contains the human feedback (vet criterion 4a) without
 * spinning up a model.
 */
import { defineCapability } from "@flow-state-dev/core";
import { workspaceResource, type WorkspaceState } from "./resources";

/** Render the workspace context, or `null` (suppress the tag) before `start`. */
export function formatWorkspaceContext(
  state: WorkspaceState | undefined,
): { workstreamWorkspace: string } | null {
  if (!state || state.goal == null) return null;
  const lines = [
    `Objective: ${state.goal}`,
    `Drafts written so far: ${state.draftsWritten ?? 0}`,
  ];
  if (state.latestFeedback != null) {
    lines.push(
      `Latest human feedback — the next revision must address it: ${state.latestFeedback}`,
    );
  }
  return { workstreamWorkspace: lines.join("\n") };
}

export const workstreamWorkspaceCap = defineCapability({
  name: "workstreamWorkspace" as const,
  resources: { wsvetWorkspace: workspaceResource },
  presets: {
    workspace: {
      context: (_input: unknown, ctx: any) =>
        formatWorkspaceContext(
          ctx.resources?.wsvetWorkspace?.state as WorkspaceState | undefined,
        ),
    },
    default: ["workspace"],
  },
});
