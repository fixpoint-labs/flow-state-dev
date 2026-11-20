import { FlowProvider, type ItemLine } from "@flow-state-dev/react";
import { useMemo } from "react";
import type { Look } from "../lib/looks";
import { Line, LineContext, quietScreen, teammatesRenderers } from "./lines";

/**
 * A session's lines in a popup, drawn as the conversation draws them (the
 * lab's renderers, {@link Line}): what the worker was given, what it wrote,
 * a message it sent, and each run of tool steps as one line that opens to
 * what each one did. A popup offers no action on a line: it opens nothing
 * and retries nothing.
 */
export function Steps({ lines, nameOf, lookOf, isCoding, empty }: {
  lines: readonly ItemLine[];
  nameOf: (id: string) => string;
  lookOf?: (id: string) => Look;
  isCoding?: (id: string) => boolean;
  empty: string;
}) {
  const screen = useMemo(
    () => ({ ...quietScreen, nameOf, ...(lookOf === undefined ? {} : { lookOf }), ...(isCoding === undefined ? {} : { isCoding }) }),
    [nameOf, lookOf, isCoding],
  );
  if (lines.length === 0) return empty === "" ? null : <p className="text-sm whitespace-pre-wrap text-muted-foreground">{empty}</p>;
  return (
    <FlowProvider renderers={teammatesRenderers}>
      <LineContext.Provider value={screen}>
        {lines.map((line) => (
          <Line key={line.id} line={line} />
        ))}
      </LineContext.Provider>
    </FlowProvider>
  );
}
