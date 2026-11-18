import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createClient } from "@flow-state-dev/client";
import { readBasePath, readBearerToken, readUserId, withBearerToken } from "@flow-state-dev/devtool/react";
import { AppProvider, createAppCalls } from "./app";
import { App } from "./components/App";
import "./styles.css";

// The served lab, as the user the page was served for: one client, which the calls and the package hooks share.
const fetcher = withBearerToken(readBearerToken());
const client = createClient({ userId: readUserId(), baseUrl: readBasePath(), fetcher });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppProvider calls={createAppCalls(client, { basePath: readBasePath(), fetcher })} client={client}>
      <App />
    </AppProvider>
  </StrictMode>,
);
