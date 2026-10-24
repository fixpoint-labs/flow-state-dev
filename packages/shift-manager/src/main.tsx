/**
 * Shift Manager's entry: set the theme (the one picked in this browser, else
 * the one the page was started on, else the one the clock calls for), connect as
 * the page was served, and draw the shell.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { bootTheme, readServedTheme } from "./lib/theme";
import { readConnection, readDevtoolUrl } from "./lib/connection";
import "./styles.css";

const look = bootTheme(readServedTheme());

const connection = readConnection();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App connection={connection} devtoolUrl={readDevtoolUrl()} look={look} />
  </StrictMode>,
);
