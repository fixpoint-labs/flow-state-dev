import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createLabAdapter } from "./adapter";
import { App } from "./App";
import "./styles.css";

// The lab's theme is dark only; `.dark` also turns on the dark variants of what it draws (highlighted code).
document.documentElement.classList.add("dark");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App adapter={createLabAdapter()} />
  </StrictMode>,
);
