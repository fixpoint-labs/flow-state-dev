/**
 * The fixture app's page entry (FIX-2368): `?user=<id>&session=<id>` opens
 * that session's board for that signed-in user, against the host that served it.
 */
import { createRoot } from "react-dom/client";
import { FlowProvider } from "@flow-state-dev/react";
import { Board } from "./Board.tsx";

const params = new URLSearchParams(location.search);

createRoot(document.getElementById("root")!).render(
  <FlowProvider userId={params.get("user") ?? ""}>
    <Board sessionId={params.get("session") ?? ""} />
  </FlowProvider>
);
