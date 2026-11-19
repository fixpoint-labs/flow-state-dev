/**
 * The Teammates lab's goal page: its real `Conversation` and the `SessionOverlay` modal its popups open in,
 * with the lab's stylesheet, on a scripted conversation (`script.ts`) in place of the server. Copied to the
 * lab's scratch copy as `src/goal/teammates.tsx`.
 *
 * The script stands in for the conversation's follower: it publishes the script's lines as the follower
 * publishes what it read, and a line the composer sends reaches the script through the worker flow's door
 * on the page's client.
 *
 *   ?surface=conversation   the conversation and its composer
 *   ?surface=popup          a popup over it, showing the open conversation's lines
 */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import type { Client } from "@flow-state-dev/client";
import type { RosterEntry } from "@flow-state-dev/workforce/browser";
import { AppProvider, useAppClient } from "../app";
import type { ConversationEntry } from "../lib/conversation";
import { Conversation } from "../components/Conversation";
import { SessionOverlay } from "../components/flow-state/session-overlay";
import "../styles.css";
import { exposeGoal, script, useConversation, useOpen, type Line } from "./script";

const entryOf = (line: Line): ConversationEntry =>
  line.who === "person"
    ? { kind: "user", id: line.id, text: line.text }
    : line.who === "worker"
      ? { kind: "assistant", id: line.id, text: line.text, streaming: line.streaming }
      : { kind: "received", id: line.id, messageId: line.id, from: "researcher", text: line.text };

const worker: RosterEntry = { id: "helper", flow: "agent", standard: true, description: "helps out", name: "Helper", teamName: null, forkedFrom: null, edited: false, settings: {} };

/**
 * No server here: the package views the conversation reads (status, worker messages) wait for good, and the
 * worker flow's door hands each line to the script.
 */
const client = {
  userId: "you",
  view: () => new Promise(() => undefined),
  subscribe: () => ({ close: () => undefined }),
  sessions: { get: async (id: string) => ({ id, flowKind: "agent", updatedAt: 1, state: {} }) },
  flow: () => ({
    send: async (_action: string, input: { message: string }, options: { sessionId: string }) => {
      script.send(options.sessionId, input.message);
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    },
  }),
} as unknown as Client;

/** The conversation's follower, stood in for by the script: its lines, as the follower publishes what it read. */
function Follower({ sessionId }: { sessionId: string }) {
  const { conversations } = useAppClient();
  const conversation = useConversation(sessionId);
  useEffect(() => {
    conversations.publish(sessionId, {
      view: { entries: conversation.lines.map(entryOf), running: conversation.running, stopping: false, backgroundRunning: 0 },
      connection: "live",
      mark: undefined,
      follow: () => undefined,
    });
  }, [conversations, sessionId, conversation]);
  return null;
}

function Page() {
  const open = useOpen();
  const surface = new URLSearchParams(location.search).get("surface");
  const conversation = useConversation(open);
  return (
    <div style={{ height: "100vh" }} className="bg-background text-foreground">
      <Follower sessionId={open} />
      <Conversation
        worker={worker}
        sessionId={open}
        nameOf={(id) => id}
        lookOf={() => ({ icon: "•", color: "gray" }) as never}
        isCoding={() => false}
        harnessOf={() => undefined}
        onFire={async () => undefined}
        onOpen={() => undefined}
      />
      {surface === "popup" ? (
        <SessionOverlay key={open} variant="modal" label="Exchange" title={`Conversation ${open}`} onClose={() => undefined}>
          {conversation.lines.map((line) => (
            <div key={line.id} className="text-sm whitespace-pre-wrap" data-entry={line.who}>
              {line.text}
            </div>
          ))}
        </SessionOverlay>
      ) : null}
    </div>
  );
}

exposeGoal();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppProvider client={client}>
      <Page />
    </AppProvider>
  </StrictMode>,
);
