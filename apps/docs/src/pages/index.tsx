/**
 * flow-state.dev home page: "Harness an AI workforce."
 *
 * The page is a static port of the landing design (see `src/components/Landing`).
 * It renders its own nav and footer, so it skips the docs `Layout`; `Head` still
 * sets the title, description and the three page fonts.
 */
import type { ReactNode } from "react";
import Head from "@docusaurus/Head";

import { landingMarkup } from "../components/Landing/markup";
import "../components/Landing/landing.css";

const TITLE = "flow-state.dev · Harness an AI workforce";
const DESCRIPTION =
  "Claude Code, Codex and Grok Bot are someone else's harness. Flow State gives you the building blocks to build your own, from one agent to a whole workforce, on any model, at a cost you control.";

/** The landing page. */
export default function Home(): ReactNode {
  return (
    <>
      <Head>
        <title>{TITLE}</title>
        <meta name="description" content={DESCRIPTION} />
        <meta property="og:title" content={TITLE} />
        <meta property="og:description" content={DESCRIPTION} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Archivo:wght@900&family=IBM+Plex+Mono:wght@400;500;600&family=Space+Grotesk:wght@400;500;700&display=swap"
        />
      </Head>
      <main className="fs-landing" dangerouslySetInnerHTML={{ __html: landingMarkup }} />
    </>
  );
}
