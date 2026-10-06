/**
 * Shift Manager's entry: set the look (the shift picked in this browser, else
 * the one it was started on, else the OS's light or dark setting), connect as
 * the page was served, and draw the shell.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { bootColorScheme, readServedColorScheme } from "./lib/color-scheme";
import { createLabClients, readConnection, readDevtoolUrl } from "./lib/connection";
import "./styles.css";

const look = bootColorScheme(readServedColorScheme());

const clients = createLabClients(readConnection());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App clients={clients} devtoolUrl={readDevtoolUrl()} look={look} />
  </StrictMode>,
);
