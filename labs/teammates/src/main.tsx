import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createClient } from "@flow-state-dev/client";
import { readBasePath, readBearerToken, readUserId, withBearerToken } from "@flow-state-dev/devtool/react";
import { AppProvider } from "./app";
import { App } from "./components/App";
import "./styles.css";

// The served lab, as the user the page was served for: one client, which every package hook shares,
// and the connection it was served with, for a line's files and react's own hooks.
const connection = { basePath: readBasePath(), fetcher: withBearerToken(readBearerToken()) };
const client = createClient({ userId: readUserId(), baseUrl: connection.basePath, fetcher: connection.fetcher });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppProvider client={client} connection={connection}>
      <App />
    </AppProvider>
  </StrictMode>,
);
