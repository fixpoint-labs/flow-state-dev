/**
 * The registry's goal page: a chat page an adopter writes from the installed
 * registry items (`conversation`, `request-group`, `prompt-input`, `message`),
 * on a scripted conversation (`script.ts`) in place of a session. Copied into a
 * fresh host that installed them with `fsdev ui add`, as `goal/registry.tsx`.
 *
 *   ?surface=send        the page makes the feed, and its composer calls `feed.sent()`
 *   ?surface=read-only   a Conversation with no feed and no composer, keyed by the open conversation
 *
 * `goal.unmarked()` (send only): the page says it sent, and what lands is a line
 * from someone else, with no line of the person's to raise.
 *
 * Under `GOAL_CONTROL=main-registry` the host holds the items as on `main`,
 * which offer `ScrollOnNewRequest` and no feed. The page is then the one an
 * adopter wrote against them, as `main`'s docs show it.
 */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import type { MessageItem, OutputItem } from "@flow-state-dev/core/items";
import { FlowProvider, useJumpToLatest, type JumpToLatest } from "@flow-state-dev/react";
import * as conversation from "@/components/flow-state/conversation";
import { Message } from "@/components/flow-state/message";
import { PromptInput, PromptInputSubmit, PromptInputTextarea } from "@/components/flow-state/prompt-input";
import { RequestGroupRenderer } from "@/components/flow-state/request-group";
import "../app/globals.css";
import { exposeGoal, script, useConversation, useOpen, type Line } from "./script";

const { Conversation, ConversationContent, ConversationScrollButton } = conversation;
/** `main`'s items: the rule is `ScrollOnNewRequest`, placed in the content. */
const ScrollOnNewRequest = (conversation as unknown as { ScrollOnNewRequest?: (p: { items: OutputItem[] }) => null }).ScrollOnNewRequest;
const legacy = ScrollOnNewRequest !== undefined;

const surface = new URLSearchParams(location.search).get("surface");
type Goal = { background(): void; unmarked?: () => void };
const goalApi = () => (window as unknown as { goal: Goal }).goal;

/** The script's lines as a session's items: a line of the person's opens a request its reply joins; a line from anyone else is a request of its own. */
function itemsOf(lines: Line[]): OutputItem[] {
  let requestId = "start";
  return lines.map((line, itemIndex): OutputItem => {
    if (line.who !== "worker") requestId = `req-${line.id}`;
    const item: MessageItem = {
      id: line.id,
      type: "message",
      status: line.streaming ? "in_progress" : "completed",
      requestId,
      itemIndex,
      ts: 0,
      provenance: { blockName: "gen", blockInstanceId: "b1", phase: "main" },
      role: line.who === "person" ? "user" : "assistant",
      content: [{ type: "output_text", text: line.text }],
    };
    return item;
  });
}

function Feed({ open, feed }: { open: string; feed?: JumpToLatest }) {
  const c = useConversation(open);
  const items = itemsOf(c.lines);
  const wiring = legacy ? {} : feed === undefined ? { resetKey: open } : { feed };
  return (
    <Conversation className="min-h-0 flex-1" {...wiring}>
      <ConversationContent className="mx-auto w-full max-w-3xl">
        {ScrollOnNewRequest !== undefined && <ScrollOnNewRequest items={items} />}
        <RequestGroupRenderer items={items} isStreaming={c.running} />
      </ConversationContent>
      {/* `main`'s button has no name; the reader finds the arrow by this one. */}
      <ConversationScrollButton {...(legacy ? { "aria-label": "Jump to latest" } : {})} />
    </Conversation>
  );
}

function SendPage({ open }: { open: string }) {
  const feed = useJumpToLatest({ resetKey: open });
  const { sent } = feed;
  useEffect(() => {
    goalApi().unmarked = () => {
      if (!legacy) sent();
      goalApi().background();
    };
  }, [sent]);
  return (
    <>
      <Feed open={open} feed={feed} />
      <div className="border-t p-3">
        <PromptInput
          onSubmit={(message) => {
            if (!legacy) sent();
            void script.send(script.open, message.text);
          }}
        >
          <PromptInputTextarea />
          <PromptInputSubmit />
        </PromptInput>
      </div>
    </>
  );
}

function Page() {
  const open = useOpen();
  return (
    <FlowProvider flowKind="goal" userId="goal" baseUrl="" renderers={{ message: Message }}>
      <div style={{ height: "100vh" }} className="flex flex-col bg-background text-foreground">
        {surface === "read-only" ? <Feed open={open} /> : <SendPage open={open} />}
      </div>
    </FlowProvider>
  );
}

exposeGoal();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Page />
  </StrictMode>,
);
