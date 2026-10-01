/**
 * App Lab's entry: take the shift it was started on, or else the OS's light or
 * dark setting, connect as the page was served, and draw the shell.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { bootColorScheme, readServedColorScheme } from "./lib/color-scheme";
import { createLabClients, readConnection, readDevtoolUrl } from "./lib/connection";
import "./styles.css";

bootColorScheme(readServedColorScheme());

const clients = createLabClients(readConnection());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App clients={clients} devtoolUrl={readDevtoolUrl()} />
  </StrictMode>,
);
