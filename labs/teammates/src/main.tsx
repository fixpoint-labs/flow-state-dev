import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createLabAdapter } from "./adapter";
import { App } from "./App";
import "./styles.css";

// The page follows the system's light or dark setting; `.dark` is what the design-system theme keys on.
const dark = window.matchMedia("(prefers-color-scheme: dark)");
const applyScheme = () => document.documentElement.classList.toggle("dark", dark.matches);
applyScheme();
dark.addEventListener("change", applyScheme);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App adapter={createLabAdapter()} />
  </StrictMode>,
);
