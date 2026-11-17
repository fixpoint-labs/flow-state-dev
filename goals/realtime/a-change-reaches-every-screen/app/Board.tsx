/**
 * The fixture app's screen (FIX-2368): one session's board, as a person sees it.
 *
 * The org's plan (`useClientData`), the org's seats
 * (`useResourceCollectionList`) and the session's replies
 * (`useSession(id, { live: true })`), and three buttons that send the board
 * flow's actions. Ordinary app code: no push code, no poll interval.
 */
import { useState } from "react";
import { useClientData, useResourceCollectionList, useSession } from "@flow-state-dev/react";

type Message = { type: string; content?: Array<{ text?: string }> };

/** The board of `sessionId`. */
export function Board({ sessionId }: { sessionId: string }) {
  const session = useSession(sessionId, { flowKind: "board", live: true });
  const { org } = useClientData(session, { org: ["plan"] });
  const seats = useResourceCollectionList<{ name: string }>(session, "seats");
  const [value, setValue] = useState("");
  const replies = (session.items as Message[])
    .filter((item) => item.type === "message")
    .map((item) => item.content?.[0]?.text ?? "");

  const send = (action: "setPlan" | "addSeat" | "say") => () => void session.sendAction(action, { value });

  return (
    <main>
      <h1>Board</h1>
      <p>
        Plan: <span data-testid="plan">{String(org.plan ?? "")}</span>
      </p>
      <ul data-testid="seats">
        {seats.items.map((seat) => (
          <li key={seat.topic}>{seat.topic}</li>
        ))}
      </ul>
      <ol data-testid="replies">
        {replies.map((text, i) => (
          <li key={i}>{text}</li>
        ))}
      </ol>
      <input name="value" value={value} onChange={(event) => setValue(event.target.value)} />
      <button name="setPlan" onClick={send("setPlan")}>Set plan</button>
      <button name="addSeat" onClick={send("addSeat")}>Add seat</button>
      <button name="say" onClick={send("say")}>Say</button>
    </main>
  );
}
