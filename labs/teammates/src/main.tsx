import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createLabAdapter } from "./adapter";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App adapter={createLabAdapter()} />
  </StrictMode>,
);
