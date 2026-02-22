import { useState, type ReactElement } from "react";
import {
  FlowProvider,
  ItemsRenderer,
  useFlow,
  useSession
} from "@flow-state-dev/react";

const BASE_URL = "http://localhost:3000";

export default function HelloChatApp(): ReactElement {
  return (
    <FlowProvider flowKind="hello-chat" userId="devuser" baseUrl={BASE_URL}>
      <div style={{ display: "flex" }}>
        <SessionSidebar />
        <ChatView />
      </div>
    </FlowProvider>
  );
}

function SessionSidebar(): ReactElement {
  const flow = useFlow();

  return (
    <aside style={{ width: 200, borderRight: "1px solid #ccc", padding: 8 }}>
      <button onClick={() => void flow.createSession()}>New Chat</button>
      {flow.sessions.map((s) => (
        <div
          key={s.id}
          onClick={() => flow.selectSession(s.id)}
          style={{
            padding: 4,
            cursor: "pointer",
            fontWeight: s.id === flow.activeSessionId ? "bold" : "normal"
          }}
        >
          Session {s.id.slice(0, 8)}
        </div>
      ))}
    </aside>
  );
}

function ChatView(): ReactElement {
  const [message, setMessage] = useState("Hello there");
  const flow = useFlow({ autoCreateSession: true });
  const session = useSession(flow.activeSessionId);

  const messageCount = Number(session.snapshot?.state?.session?.messageCount ?? 0);

  const handleSend = async (): Promise<void> => {
    if (flow.activeSessionId === undefined || message.trim().length === 0) {
      return;
    }

    await session.sendAction("chat", {
      message: message.trim()
    });
  };

  return (
    <div style={{ flex: 1, padding: 8 }}>
      <h2>Hello Chat</h2>
      <div>
        <input
          value={message}
          onChange={(event) => setMessage(event.currentTarget.value)}
        />
        <button onClick={() => void handleSend()}>Send</button>
      </div>
      <p>Messages sent: {messageCount}</p>
      <ItemsRenderer items={session.items} />
    </div>
  );
}
