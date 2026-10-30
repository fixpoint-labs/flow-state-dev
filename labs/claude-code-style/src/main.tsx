import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createLabAdapter } from "./adapter";
import { App } from "./App";
import { bootTheme } from "./lib/theme";
import "./styles.css";

// The look: the sidebar's pick if there is one, else the system's setting (`lib/theme`).
bootTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App adapter={createLabAdapter()} />
  </StrictMode>,
);
