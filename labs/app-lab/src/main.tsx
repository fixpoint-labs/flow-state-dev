/**
 * App Lab's entry: follow the OS's light or dark setting, connect as the page
 * was served, and draw the shell.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { followColorScheme } from "./lib/color-scheme";
import { createLabClients, readConnection, readDevtoolUrl } from "./lib/connection";
import "./styles.css";

followColorScheme();

const clients = createLabClients(readConnection());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App clients={clients} devtoolUrl={readDevtoolUrl()} />
  </StrictMode>,
);
