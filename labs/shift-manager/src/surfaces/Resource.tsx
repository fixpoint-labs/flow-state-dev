/**
 * A declared document, opened read-only from Jump to (BR-10): its content as
 * the Lab serves it, through a session whose flow serves it. Nothing here
 * writes; the page offers no edit.
 */
import { useEffect, useState } from "react";
import { EmptyState, SectionFailure } from "../components/ui";
import { useLab } from "../lib/lab-data";
import { describeFailure, type Failure } from "../lib/reads";

export function ResourceView({ sessionId, resourceRef }: { sessionId: string; resourceRef: string }) {
  const { clients } = useLab();
  const [content, setContent] = useState<{ text: string } | { failure: Failure } | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setContent(undefined);
    clients.resources
      .getResourceContent(sessionId, resourceRef)
      .then((read) => live && setContent({ text: read.content }))
      .catch((error: unknown) => live && setContent({ failure: describeFailure(error) }));
    return () => {
      live = false;
    };
  }, [clients, sessionId, resourceRef, attempt]);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="resource" data-resource-ref={resourceRef}>
      <header className="px-4 pt-3">
        <p className="text-[11px] font-semibold tracking-wider text-muted-foreground">RESOURCE · READ-ONLY</p>
        <h1 className="text-base font-semibold">{resourceRef}</h1>
      </header>
      {content === undefined ? (
        <p className="p-4 text-sm text-muted-foreground">Reading the document…</p>
      ) : "failure" in content ? (
        <div className="p-4">
          <SectionFailure what="This document" failure={content.failure} onRetry={() => setAttempt((a) => a + 1)} />
        </div>
      ) : content.text.trim().length === 0 ? (
        <EmptyState title="Empty document">The Lab serves this document with no content.</EmptyState>
      ) : (
        <article className="mx-auto w-full max-w-3xl overflow-y-auto whitespace-pre-wrap p-6 text-sm" data-testid="resource-content">
          {content.text}
        </article>
      )}
    </div>
  );
}
