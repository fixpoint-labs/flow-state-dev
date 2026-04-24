import type { ReactElement } from "react";
import type { BlockOutputItem, BlockValue } from "@flow-state-dev/core/items";

type AgentOutput = {
  reply: string;
  artifactsModified: string[];
};

/**
 * The agent generator is a leaf; its block_output always carries
 * `kind: "inline"` (FIX-413). Unwrap to the typed payload.
 */
function unwrap(value: BlockValue<unknown>): AgentOutput | undefined {
  if (value.kind === "inline") return value.value as AgentOutput;
  return undefined;
}

export default function AgentResponseCard({ item }: { item: BlockOutputItem }): ReactElement | null {
  const output = unwrap(item.output);
  if (output === undefined) return null;

  return (
    <div className={item.status === "in_progress" ? "animate-pulse" : ""}>
      <div>
        {item.blockName}
      </div>
      <p>{output.reply}</p>
      {output.artifactsModified.length > 0 ? (
        <div>Modified: {output.artifactsModified.join(", ")}</div>
      ) : null}
    </div>
  );
}
