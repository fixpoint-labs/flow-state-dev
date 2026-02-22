import type { ReactElement } from "react";
import { useBlockContext } from "@flow-state-dev/react";

type AgentResponseCardProps = {
  reply: string;
  artifactsModified: string[];
};

export default function AgentResponseCard(props: AgentResponseCardProps): ReactElement {
  const { blockName, renderKey, status } = useBlockContext();

  return (
    <div className={status === "in_progress" ? "animate-pulse" : ""}>
      <div>
        {blockName} ({renderKey ?? "default"})
      </div>
      <p>{props.reply}</p>
      {props.artifactsModified.length > 0 ? (
        <div>Modified: {props.artifactsModified.join(", ")}</div>
      ) : null}
    </div>
  );
}
