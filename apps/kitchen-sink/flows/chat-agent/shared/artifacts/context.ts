/**
 * Artifact inventory context formatter.
 *
 * Renders the artifact list (title + summary) so a generator knows what
 * artifacts exist without reading full content. Installed through the
 * capability's `inventory` preset — generators pick it up via `uses` rather
 * than threading it into a `context` slot by hand.
 */
import type { ResourceCollectionRef } from "@flow-state-dev/core/types";

/**
 * `ctx: any` because the capability preset context slot is the sole call site —
 * there is no second, differently-typed consumer to satisfy.
 */
export const artifactListContext = async (_input: unknown, ctx: any) => {
  const artifacts = ctx.resources.artifacts as ResourceCollectionRef<{
    title: string;
    summary: string;
    updatedAt: number;
  }>;
  const instances = await artifacts.list();
  if (instances.length === 0) {
    return "No artifacts exist yet in this session.";
  }
  const list = instances
    .map((ref: any) => {
      const id = ref.path.replace("artifacts/", "");
      const title = ref.state.title ?? "Untitled";
      const summary = ref.state.summary ? ` — ${ref.state.summary}` : "";
      return `- ${id}: ${title}${summary}`;
    })
    .join("\n");
  return `Current artifacts:\n${list}`;
};
