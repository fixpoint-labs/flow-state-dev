/**
 * One pending ask, drawn with the registry's own approval and question cards,
 * answered through the one resume path (S3). Inbox's detail and a
 * workstream's Stream both draw an ask with this, so they can't answer it two
 * ways (BR-25).
 *
 * The card resolves through a `SuspensionResolverProvider` bound to the ask:
 * the answer goes to the flow the ask's session records as its owner, and a
 * successful answer refreshes the snapshot so the ask leaves every surface
 * together (BR-26). An ask the Lab won't reopen from outside gets no resolver,
 * so the card offers no answer, and says why.
 */
import { useMemo } from "react";
import type { OutputItem } from "@flow-state-dev/core/items";
import { SuspensionResolverProvider, type SuspensionResolver } from "@flow-state-dev/react";
import { SessionItemsProvider } from "./flow-state/session-items-context";
import { SuspensionCard } from "./flow-state/suspension-card";
import { useLab } from "../lib/lab-data";
import type { Ask } from "../lib/reads";

/**
 * The registry's cards read their resolution from the session's items. An ask
 * here is pending by construction (`deriveSuspensions` dropped the resolved
 * ones), so the cards are given no items rather than the transcript.
 */
const NO_ITEMS: OutputItem[] = [];

/**
 * `titled`: the caller draws the ask's question as its own heading (Inbox's
 * detail, v2:597), so the registry card is handed the ask without its message
 * and the question isn't drawn twice. The card itself is unedited.
 */
export function AskCard({ ask, titled = false }: { ask: Ask; titled?: boolean }) {
  const { answer } = useLab();
  const resolve = useMemo<SuspensionResolver>(
    () => async ({ action, data }) => {
      await answer(ask, { action, ...(data === undefined ? {} : { data }) });
    },
    [answer, ask],
  );
  const item = useMemo(() => (titled ? { ...ask.item, message: "" } : ask.item), [ask.item, titled]);
  const card = (
    <SessionItemsProvider value={NO_ITEMS}>
      <SuspensionCard item={item} />
    </SessionItemsProvider>
  );
  return (
    <div data-testid="ask-card" data-suspension-id={ask.item.suspensionId} data-session-id={ask.sessionId}>
      {ask.unanswerable === null ? (
        <SuspensionResolverProvider resolve={resolve}>{card}</SuspensionResolverProvider>
      ) : (
        <>
          {card}
          <p className="text-xs text-muted-foreground" data-testid="ask-unanswerable">
            {ask.unanswerable}
          </p>
        </>
      )}
    </div>
  );
}
