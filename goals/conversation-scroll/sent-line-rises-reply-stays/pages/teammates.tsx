/**
 * The Teammates lab's goal page: its real `Conversation` and `SessionPopup`,
 * with the lab's stylesheet, on a scripted adapter (`script.ts`) in place of
 * the server. Copied to the lab's scratch copy as `src/goal/teammates.tsx`.
 *
 *   ?surface=conversation   the conversation and its composer
 *   ?surface=popup          a popup over it, showing the open conversation's lines
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { ConversationEntry, LabAdapter, LabWorker } from "../adapter";
import { Conversation } from "../components/Conversation";
import { SessionPopup } from "../components/SessionPopup";
import "../styles.css";
import { exposeGoal, script, useConversation, useOpen, type Line } from "./script";

const entryOf = (line: Line): ConversationEntry =>
  line.who === "person"
    ? { kind: "user", id: line.id, text: line.text }
    : line.who === "worker"
      ? { kind: "assistant", id: line.id, text: line.text, streaming: line.streaming }
      : { kind: "received", id: line.id, messageId: line.id, from: "researcher", text: line.text };

const watchers = new Map<string, unknown>();
/** Every read the conversation makes; only the conversation itself and its connection say anything. */
const adapter = new Proxy({} as LabAdapter, {
  get(_, name: string) {
    if (!watchers.has(name)) {
      watchers.set(
        name,
        name === "watchConversation"
          ? (key: string, emit: (v: unknown) => void) => {
              const read = () => {
                const c = script.get(key);
                emit({ entries: c.lines.map(entryOf), running: c.running });
              };
              read();
              return script.subscribe(read);
            }
          : name === "watchConnection"
            ? (_key: string, emit: (v: unknown) => void) => (emit("live"), () => undefined)
            : name === "send"
              ? (key: string, text: string) => script.send(key, text)
              : name.startsWith("watch")
                ? () => () => undefined
                : async () => undefined,
      );
    }
    return watchers.get(name);
  },
});

const worker: LabWorker = { id: "helper", name: "Helper", role: "helps out" };

function Page() {
  const open = useOpen();
  const surface = new URLSearchParams(location.search).get("surface");
  const conversation = useConversation(open);
  return (
    <div style={{ height: "100vh" }} className="bg-background text-foreground">
      <Conversation
        adapter={adapter}
        worker={worker}
        sessionId={open}
        nameOf={(id) => id}
        lookOf={() => ({ icon: "•", color: "gray" }) as never}
        isCoding={() => false}
        harnessOf={() => undefined}
        onFire={async () => undefined}
        onOpen={() => undefined}
        talkOpen={false}
        onToggleTalk={() => undefined}
      />
      {surface === "popup" ? (
        <SessionPopup key={open} label="Exchange" title={`Conversation ${open}`} onClose={() => undefined}>
          {conversation.lines.map((line) => (
            <div key={line.id} className="text-sm whitespace-pre-wrap" data-entry={line.who}>
              {line.text}
            </div>
          ))}
        </SessionPopup>
      ) : null}
    </div>
  );
}

exposeGoal();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Page />
  </StrictMode>,
);
