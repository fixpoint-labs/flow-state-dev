import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import "@flow-state-dev/devtool/react/styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
