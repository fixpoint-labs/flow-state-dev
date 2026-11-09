import { stepRun, type SessionStep } from "../adapter";
import { MarkdownText } from "./flow-state/message-response";
import { ToolRun } from "./ToolRun";

/**
 * A session's steps, drawn like a conversation: what the worker was given on
 * the right, what it wrote as Markdown, a message it sent as a line, and each
 * run of tool steps as one line ("Ran 3 commands and edited a file") that
 * opens to what each one did: open while it runs, folded once it doesn't.
 */
export function Steps({ steps, nameOf, empty }: { steps: readonly SessionStep[]; nameOf: (id: string) => string; empty: string }) {
  if (steps.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  const groups: (SessionStep | SessionStep[])[] = [];
  for (const step of steps) {
    const last = groups[groups.length - 1];
    if (step.kind === "tool" && Array.isArray(last)) last.push(step);
    else groups.push(step.kind === "tool" ? [step] : step);
  }
  return groups.map((group) => {
    if (Array.isArray(group)) return <ToolRun key={group[0]!.id} steps={group} run={stepRun(group)} />;
    switch (group.kind) {
      case "given":
        return (
          <div key={group.id} className="flex justify-end">
            <div data-step="given" className="max-w-[80%] rounded-lg bg-accent px-4 py-2.5 text-sm whitespace-pre-wrap">
              {group.text}
            </div>
          </div>
        );
      case "said":
        return (
          <div key={group.id} data-step="said" className="text-sm leading-relaxed">
            <MarkdownText text={group.text} />
          </div>
        );
      case "sent":
        return (
          <div key={group.id} data-step="sent" className="font-mono text-xs text-success">
            → to {nameOf(group.to ?? "")} · <span className="whitespace-pre-wrap text-foreground">{group.text}</span>
          </div>
        );
      case "harness":
        return (
          <div key={group.id} data-step="harness" className="font-mono text-xs text-muted-foreground">
            {group.text}
          </div>
        );
      default:
        return null;
    }
  });
}
