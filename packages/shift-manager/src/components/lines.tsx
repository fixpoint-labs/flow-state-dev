/**
 * How Shift Manager draws a conversation's lines: React's conversation model
 * decides what each line is, and the UI registry's copies draw it (the chat
 * registry, `conversation-lines` and `workforce-lines`), configured by the
 * line context the conversation sets. A run of tool calls draws as the
 * registry's tool group, in the registry's words.
 *
 * What is Shift Manager's own: a message to or from another worker carries
 * the time it landed and a link to Messages ({@link withMessagesLink}); a
 * message's files are read through the Lab's read route; a coordinator's
 * routing record and the conversation's task board draw as its own. A wait
 * that isn't a yes (a question, a form) still draws as the chat registry's
 * suspension card.
 */
import type { ComponentType } from "react";
import type { DataItem, MessageItem } from "@flow-state-dev/core/items";
import type { RendererRegistry } from "@flow-state-dev/react";
import { COORDINATOR_ROUTE, RECEIVED_MESSAGE_DATA_TYPE, SENT_MESSAGE_DATA_TYPE } from "@flow-state-dev/workforce/browser";
import { chatAssistantRenderers } from "./flow-state/chat-assistant";
import { conversationLineRenderers } from "./flow-state/conversation-lines";
import { Message } from "./flow-state/message";
import { ReceivedLine, SentLine, withBrief, workforceLineRenderers } from "./flow-state/workforce-lines";
import { CoordinatorRoute } from "./CoordinatorRoute";
import { RouteLink } from "./RouteLink";
import { TaskBoardMeta } from "./TaskBoardMeta";
import { fileReadBase, readStoredFile } from "../lib/files";
import { clockTime } from "../lib/shell";

/** A line between workers, with the time it landed and a link to Messages under it, where the whole exchange is. */
function withMessagesLink(Line: ComponentType<{ item: DataItem }>): ComponentType<{ item: DataItem }> {
  return function MessageBetweenWorkers({ item }) {
    return (
      <div className="flex flex-col gap-1">
        <Line item={item} />
        <p className="flex gap-2 font-mono text-xs text-muted-foreground">
          <span data-look="message-time">{clockTime(item.ts)}</span>
          <RouteLink className="hover:text-foreground hover:underline" to={{ level: "messages" }} data-testid="messages-link">
            Messages ›
          </RouteLink>
        </p>
      </div>
    );
  };
}

/** A message, its files read through the Lab's read route. */
function LabMessage({ item }: { item: MessageItem }) {
  return <Message item={item} readBase={fileReadBase()} readFile={readStoredFile} />;
}

/** The chat registry with the registry's conversation and workforce lines, configured for Shift Manager. Module level: one object. */
export const shiftManagerRenderers: RendererRegistry = {
  ...chatAssistantRenderers,
  ...conversationLineRenderers,
  // A question or a form waits as the chat registry's card; a yes is one of them.
  suspension: chatAssistantRenderers.suspension,
  // A task's brief folds to one line; every other message is the registry's copy.
  message: withBrief(LabMessage),
  data: {
    ...chatAssistantRenderers.data,
    ...workforceLineRenderers,
    // A coordinator's routing record, drawn apart from the conversation's lines. Its task board, with each task opening its session.
    [COORDINATOR_ROUTE]: CoordinatorRoute,
    "task-board-meta": TaskBoardMeta,
    [RECEIVED_MESSAGE_DATA_TYPE]: withMessagesLink(ReceivedLine),
    [SENT_MESSAGE_DATA_TYPE]: withMessagesLink(SentLine),
  },
};
