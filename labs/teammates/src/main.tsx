import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppProvider, createAppCalls } from "./app";
import { App } from "./components/App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppProvider calls={createAppCalls()}>
      <App />
    </AppProvider>
  </StrictMode>,
);
