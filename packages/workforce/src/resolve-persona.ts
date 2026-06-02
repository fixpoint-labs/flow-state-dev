/**
 * Persona resolution — thin helper over FIX-699's resource-template primitives.
 * Resolves a PersonaSource into a system-prompt string at generator execution time.
 */

import type { PersonaSource } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import {
  parseResourceTemplate,
  renderResourceTemplate,
} from "@flow-state-dev/core/resource-template";
import { resolveResourceByPath } from "@flow-state-dev/core";

export async function resolveAgentPersona(
  persona: PersonaSource,
  ctx: BlockContext,
): Promise<string> {
  if (typeof persona === "string") return persona;

  if ("path" in persona) {
    const ref = await resolveResourceByPath(persona.path, ctx);
    const content = await ref?.readContent();
    if (content == null) {
      throw new Error(
        `Agent persona "${persona.path}" resolved to no content. ` +
          `Ensure the persona resource or collection is declared in the resource graph.`,
      );
    }
    return content;
  }

  return renderResourceTemplate(
    parseResourceTemplate(persona.template),
    persona.state ?? {},
  );
}
