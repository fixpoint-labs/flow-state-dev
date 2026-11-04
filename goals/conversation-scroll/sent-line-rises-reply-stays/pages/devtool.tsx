/**
 * DevTool's goal page: its real `StreamView`, with DevTool's stylesheet, fed
 * request groups made from the scripted conversations (`script.ts`) in place
 * of a server's stream. Copied to `apps/devtool`'s scratch copy as
 * `src/goal/devtool.tsx`.
 *
 * Each line the person sends is a request, named by the line, as the panel's
 * action bar would dispatch it; the reply is that request's message. A line
 * that isn't theirs is a request of its own, as a scheduled run's would be.
 * A send counts in `sends` at once, and its request lands after, as the
 * panel does. A switch remounts the workspace, as the panel does, and the
 * stream is empty while the other session is read.
 *
 * `?surface=first-send` opens a session with no requests yet: the stream
 * draws its empty state until the first send's request lands.
 */
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { StreamView, type RequestGroup } from "@devtool-src/react/components/workspace/stream-view";
import { DebugProvider } from "@devtool-src/react/context/debug-context";
import { SelectionProvider } from "@devtool-src/react/context/selection-context";
import "@flow-state-dev/devtool/react/styles.css";
import "../styles.css";
import { exposeGoal, script, useConversation, useOpen, type Line } from "./script";

const message = (line: Line, requestId: string, index: number) => ({
  id: `${line.id}-item`,
  type: "message",
  role: "assistant",
  status: line.streaming ? "in_progress" : "completed",
  requestId,
  itemIndex: index,
  ts: index,
  content: [{ type: "output_text", text: line.text }],
});

/** One request per line the person sent (named by it), and one per line from elsewhere. */
function groupsOf(lines: Line[]): RequestGroup[] {
  const groups: RequestGroup[] = [];
  for (const line of lines) {
    if (line.who === "worker" && groups.length > 0) {
      const group = groups[groups.length - 1]!;
      group.items.push(message(line, group.requestId, group.items.length) as never);
      group.status = line.streaming ? "in_progress" : "completed";
      continue;
    }
    const requestId = `req-${line.id}`;
    groups.push({
      requestId,
      action: line.who === "person" ? line.text : "scheduledRun",
      status: "completed",
      startedAt: groups.length,
      items: line.who === "other" ? [message(line, requestId, 0) as never] : [],
    });
  }
  return groups;
}

let count: (n: (sends: number) => number) => void = () => undefined;
let reading: (on: boolean) => void = () => undefined;

function Page() {
  const open = useOpen();
  const conversation = useConversation(open);
  const [sends, setSends] = useState(0);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    count = setSends;
    reading = setLoading;
  }, []);
  return (
    <DebugProvider>
      {/* The panel remounts its workspace for each session, by this same key. */}
      <SelectionProvider key={open}>
        <div style={{ height: "100vh" }} className="bg-fs-surface">
          <StreamView
            requestGroups={loading ? [] : groupsOf(conversation.lines)}
            streamStatus={conversation.running ? "streaming" : "completed"}
            sends={sends}
          />
        </div>
      </SelectionProvider>
    </DebugProvider>
  );
}

exposeGoal({
  send(text) {
    count((n) => n + 1);
    void script.send(script.open, text);
  },
  switched() {
    reading(true);
    setTimeout(() => reading(false), 120);
  },
});
if (new URLSearchParams(location.search).get("surface") === "first-send") script.create(script.open);
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Page />
  </StrictMode>,
);
