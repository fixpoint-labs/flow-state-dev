/**
 * A task's brief in a session feed: the words Workforce hands a worker when it
 * starts a task, marked with `taskBriefMetadata`. They are what the session was
 * given, not words the user typed, so they show as one muted, folded
 * "Task brief" line that opens to the brief, never as the user's line. The
 * brief's files are drawn under its text by the registry's message
 * piece, read through the Lab's read route.
 * {@link shiftManagerRenderers} draws every message through
 * {@link MessageOrBrief}, a user's own files on their line included.
 */
import type { FileContent, MessageItem } from "@flow-state-dev/core/items";
import { taskBriefOf } from "@flow-state-dev/workforce/browser";
import { ChevronRightIcon } from "lucide-react";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Message, MessageFiles } from "./flow-state/message";
import { fileReadBase, readStoredFile } from "../lib/files";

/** Whether a message item is a task's brief rather than a line someone wrote. */
export function isTaskBrief(item: { type: string; metadata?: Record<string, unknown> }): boolean {
  return item.type === "message" && taskBriefOf(item) !== undefined;
}

/** The brief as one folded line, opening to its text and its files. */
function TaskBriefLine({ text, files }: { text: string; files: FileContent[] }) {
  return (
    <Collapsible className="group/brief not-prose w-full" data-testid="task-brief">
      <CollapsibleTrigger className="inline-flex max-w-full items-center gap-1 text-left text-sm text-muted-foreground hover:text-foreground">
        <span className="truncate">Task brief</span>
        <ChevronRightIcon className="size-3.5 shrink-0 transition-transform group-data-[state=open]/brief:rotate-90" />
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1.5 ml-1 border-l pl-3 outline-none">
        <p className="whitespace-pre-wrap text-sm text-muted-foreground">{text}</p>
        {files.length === 0 ? null : (
          <div className="mt-2 flex" data-testid="task-brief-files">
            <MessageFiles files={files} readBase={fileReadBase()} readFile={readStoredFile} />
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

/** The `message` renderer: a task's brief folded, every other message as the registry's copy draws it. */
export function MessageOrBrief({ item }: { item: MessageItem }) {
  if (isTaskBrief(item)) {
    const text = (item.content ?? []).flatMap((part) => (part.type === "output_text" ? [part.text] : [])).join("\n\n");
    const files = (item.content ?? []).filter((part): part is FileContent => part.type === "file");
    return <TaskBriefLine text={text} files={files} />;
  }
  return <Message item={item} readBase={fileReadBase()} readFile={readStoredFile} />;
}
