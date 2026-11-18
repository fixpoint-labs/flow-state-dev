// BR-25; BR-26; FIX-2774.
/**
 * One pending ask, drawn with the registry's own approval and question cards,
 * answered through orchestration's one answer call on the Inbox hold it is.
 * Inbox's detail, Shift Coordinator's summary and a task's session all draw
 * an ask with this, so they can't answer it two ways.
 *
 * The card resolves through a `SuspensionResolverProvider` bound to the hold:
 * the answer goes to the flow the hold names. No read follows: the server's
 * suspension notice takes the ask away from every screen that reads the
 * inbox view. An ask the Inbox can't answer gets no resolver, so the card
 * offers no answer, and says why.
 *
 * A coding run's review is drawn with the registry's review card directly, so
 * it can be handed what the run committed and the judge's verdict, read from
 * the stop's data in the ask's session by harness-manager's browser reader.
 */
import { useMemo } from "react";
import type { OutputItem } from "@flow-state-dev/core/items";
import { SuspensionResolverProvider, type SuspensionResolver } from "@flow-state-dev/react";
import { reviewDetail } from "@flow-state-dev/harness-manager/browser";
import { SessionItemsProvider } from "./flow-state/session-items-context";
import { SuspensionCard } from "./flow-state/suspension-card";
import { ReviewSuspension, takesReviewVerdict } from "./flow-state/review-hold";
import type { InboxHold } from "@flow-state-dev/orchestration/inbox";
import { answerOfResolution, sessionOfHold, suspensionOfHold, useInboxAnswer, useReviewData, type InboxAsk } from "../lib/inbox";

/**
 * The registry's cards read their resolution from the session's items. An ask
 * here is pending by construction (the view lists only pending ones), so the
 * cards are given no items rather than the transcript.
 */
const NO_ITEMS: OutputItem[] = [];

/**
 * `titled`: the caller draws the ask's question as its own heading (Inbox's
 * detail, v2:597), so the registry card is handed the ask without its message
 * and the question isn't drawn twice. The card itself is unedited.
 */
export function AskCard({ hold, titled = false }: { hold: InboxHold<InboxAsk>; titled?: boolean }) {
  const answer = useInboxAnswer();
  const data = useReviewData(hold);
  const resolve = useMemo<SuspensionResolver>(
    () => async ({ action, data: given }) => {
      await answer(hold, answerOfResolution(hold, action, given));
    },
    [answer, hold],
  );
  // Titled: the parent supplies the title, so the card is drawn without the message.
  const item = useMemo(() => {
    const drawn = suspensionOfHold(hold, data);
    return titled ? { ...drawn, message: "" } : drawn;
  }, [hold, data, titled]);
  const card = (
    <SessionItemsProvider value={NO_ITEMS}>
      {item.kind === "review" && takesReviewVerdict(item.resumeSchema) ? (
        <ReviewSuspension item={item} review={reviewDetail(item.data)} />
      ) : (
        <SuspensionCard item={item} />
      )}
    </SessionItemsProvider>
  );
  return (
    <div data-testid="ask-card" data-suspension-id={hold.id} data-session-id={sessionOfHold(hold) ?? undefined}>
      {hold.answerable ? (
        <SuspensionResolverProvider resolve={resolve}>{card}</SuspensionResolverProvider>
      ) : (
        <>
          {card}
          <p className="text-xs text-muted-foreground" data-testid="ask-unanswerable">
            {hold.unanswerable}
          </p>
        </>
      )}
    </div>
  );
}
