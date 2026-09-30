/**
 * App Lab's entry: connect as the page was served, and draw the shell.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { createLabClients, readConnection } from "./lib/connection";
import "./styles.css";

const clients = createLabClients(readConnection());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App clients={clients} />
  </StrictMode>,
);
