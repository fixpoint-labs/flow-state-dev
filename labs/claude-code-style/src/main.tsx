import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createClient } from "@flow-state-dev/client";
import { readBasePath, readBearerToken, readUserId, withBearerToken } from "@flow-state-dev/devtool/react";
import { AppProvider } from "./app";
import { App } from "./components/App";
import "./styles.css";

// The page follows the system's light or dark setting; `.dark` is what the design-system theme keys on.
const dark = window.matchMedia("(prefers-color-scheme: dark)");
const applyScheme = () => document.documentElement.classList.toggle("dark", dark.matches);
applyScheme();
dark.addEventListener("change", applyScheme);

// The served lab, as the user the page was served for.
const fetcher = withBearerToken(readBearerToken());
const client = createClient({ userId: readUserId(), baseUrl: readBasePath(), fetcher });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppProvider client={client} connection={{ basePath: readBasePath(), fetcher }}>
      <App />
    </AppProvider>
  </StrictMode>,
);
