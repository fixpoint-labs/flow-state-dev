/**
 * Artifact inventory context formatter.
 *
 * Renders the artifact list (title + summary) so a generator knows what
 * artifacts exist without reading full content. Installed through the
 * capability's `inventory` preset — generators pick it up via `uses` rather
 * than threading it into a `context` slot by hand.
 */
import type { BlockContext, ResourceCollectionRef } from "@flow-state-dev/core/types";
import type { ArtifactState } from "./resource";

/** List this session's artifacts in the inventory preset. */
export const artifactListContext = async (_input: unknown, ctx: BlockContext) => {
  const artifacts = ctx.resources.artifacts as ResourceCollectionRef<ArtifactState>;
  const instances = await artifacts.list();
  if (instances.length === 0) {
    return "No artifacts exist yet in this session.";
  }
  const list = instances
    .map((ref) => {
      const id = ref.path.replace("artifacts/", "");
      const title = ref.state.title ?? "Untitled";
      const summary = ref.state.summary ? ` — ${ref.state.summary}` : "";
      return `- ${id}: ${title}${summary}`;
    })
    .join("\n");
  return `Current artifacts:\n${list}`;
};
