/**
 * Shift Manager's entry: set the look (the mode picked in this browser, else
 * the shift it was started on, else Auto, which follows the clock), connect as
 * the page was served, and draw the shell.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { bootShift, readServedShift } from "./lib/shift";
import { createLabClients, readConnection, readDevtoolUrl } from "./lib/connection";
import "./styles.css";

const look = bootShift(readServedShift());

const clients = createLabClients(readConnection());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App clients={clients} devtoolUrl={readDevtoolUrl()} look={look} />
  </StrictMode>,
);
