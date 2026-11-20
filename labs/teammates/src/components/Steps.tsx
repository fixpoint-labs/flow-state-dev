import { FlowProvider, type ItemLine } from "@flow-state-dev/react";
import { lookOf as lookOfRow, type Look } from "../lib/looks";
import { LineContext } from "./flow-state/conversation-lines";
import { Line, teammatesRenderers, useLinesNames } from "./lines";

/** No teammate looks given: each id's own initial and color. */
const noLook = (id: string): Look => lookOfRow({ id, name: id });
/** No coding worker named. */
const noCoder = () => false;

/**
 * A session's lines in a popup, drawn as the conversation draws them (the
 * lab's renderers, {@link Line}): what the worker was given, what it wrote,
 * a message it sent, and each run of tool steps as one line that opens to
 * what each one did. A popup offers no action on a line: its line context
 * carries names and avatars only, so it opens nothing and retries nothing.
 */
export function Steps({ lines, nameOf, lookOf = noLook, isCoding = noCoder, empty }: {
  lines: readonly ItemLine[];
  nameOf: (id: string) => string;
  lookOf?: (id: string) => Look;
  isCoding?: (id: string) => boolean;
  empty: string;
}) {
  const names = useLinesNames(nameOf, lookOf, isCoding);
  if (lines.length === 0) return empty === "" ? null : <p className="text-sm whitespace-pre-wrap text-muted-foreground">{empty}</p>;
  return (
    <FlowProvider renderers={teammatesRenderers}>
      <LineContext.Provider value={names}>
        {lines.map((line) => (
          <Line key={line.id} line={line} />
        ))}
      </LineContext.Provider>
    </FlowProvider>
  );
}
