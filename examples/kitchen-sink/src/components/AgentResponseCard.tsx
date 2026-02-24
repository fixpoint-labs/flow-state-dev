import type { ReactElement } from "react";
import { useItemContext } from "@flow-state-dev/react";

type AgentResponseCardProps = {
  reply: string;
  artifactsModified: string[];
};

export default function AgentResponseCard(props: AgentResponseCardProps): ReactElement {
  const { blockName, status } = useItemContext();

  return (
    <div className={status === "in_progress" ? "animate-pulse" : ""}>
      <div>
        {blockName}
      </div>
      <p>{props.reply}</p>
      {props.artifactsModified.length > 0 ? (
        <div>Modified: {props.artifactsModified.join(", ")}</div>
      ) : null}
    </div>
  );
}
