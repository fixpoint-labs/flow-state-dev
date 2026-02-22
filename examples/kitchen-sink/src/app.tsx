import { useState, type ReactElement } from "react";
import {
  FlowProvider,
  ItemsRenderer,
  useFlow,
  useProjections,
  useSession,
  type BlockComponentType
} from "@flow-state-dev/react";
import AgentResponseCard from "./components/AgentResponseCard";
import {
  artifactsListSchema,
  modeStatusSchema,
  userPrefsSchema
} from "./client-schemas";

const BASE_URL = "http://localhost:3000";

const blockRenderers: Record<string, BlockComponentType> = {
  "agent-response": AgentResponseCard
};

export default function KitchenSinkApp(): ReactElement {
  return (
    <FlowProvider
      flowKind="kitchen-sink"
      userId="devuser"
      baseUrl={BASE_URL}
      blockRenderers={blockRenderers}
    >
      <MainView />
    </FlowProvider>
  );
}

function MainView(): ReactElement {
  const [message, setMessage] = useState("Summarize current project context");
  const [mode, setMode] = useState<"chat" | "plan" | "review">("chat");

  const flow = useFlow({ autoCreateSession: true });
  const session = useSession(flow.activeSessionId);

  const projections = useProjections(session, {
    session: {
      artifactsList: artifactsListSchema,
      modeStatus: modeStatusSchema
    },
    user: {
      preferences: userPrefsSchema
    }
  });

  const handleSend = async (): Promise<void> => {
    if (flow.activeSessionId === undefined) {
      return;
    }

    await session.sendAction("run", {
      message: message.trim(),
      mode
    });
  };

  return (
    <div>
      <h2>Kitchen Sink</h2>

      <div>
        Mode: {projections.session.modeStatus?.currentMode ?? "chat"}
        {" | "}
        Requests: {projections.session.modeStatus?.requestCount ?? 0}
        {" | "}
        User: {projections.user.preferences?.displayName ?? "Unknown"}
      </div>

      <div>
        <h3>Artifacts ({projections.session.artifactsList?.length ?? 0})</h3>
        {projections.session.artifactsList?.map((artifact) => (
          <div key={artifact.id}>{artifact.title}</div>
        ))}
      </div>

      <div>
        <textarea
          value={message}
          onChange={(event) => setMessage(event.currentTarget.value)}
        />
        <div>
          <button onClick={() => setMode("chat")}>Chat</button>
          <button onClick={() => setMode("plan")}>Plan</button>
          <button onClick={() => setMode("review")}>Review</button>
          <button onClick={() => void handleSend()}>Run</button>
        </div>
      </div>

      <ItemsRenderer items={session.items} />

      {session.isLoading ? <div>Loading...</div> : null}
      {session.isStreaming ? <div>Streaming...</div> : null}
      {session.error ? <div>Error: {session.error.message}</div> : null}
    </div>
  );
}
