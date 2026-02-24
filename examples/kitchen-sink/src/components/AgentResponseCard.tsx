import type { ReactElement } from "react";
import type { BlockOutputItem } from "@flow-state-dev/core/items";

type AgentOutput = {
  reply: string;
  artifactsModified: string[];
};

export default function AgentResponseCard({ item }: { item: BlockOutputItem }): ReactElement {
  const output = item.output as AgentOutput;

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
