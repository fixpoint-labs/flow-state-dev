import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";
import { inkTheme } from "./src/prismThemes";
import { redirects } from "./redirects.mjs";

// Search is Algolia DocSearch. The Vercel Algolia integration puts the app id
// and the search-only key into the build's environment; the search key is
// meant for the browser (never use ALGOLIA_WRITE_API_KEY here). Without them,
// as in a local or CI build, the site builds without a search bar instead of
// failing. `indexName` must match the index the Algolia crawler writes to.
const algolia: Preset.ThemeConfig["algolia"] =
  process.env.ALGOLIA_APP_ID && process.env.ALGOLIA_SEARCH_API_KEY
    ? {
        appId: process.env.ALGOLIA_APP_ID,
        apiKey: process.env.ALGOLIA_SEARCH_API_KEY,
        indexName: "flow-state-dev",
      }
    : undefined;

const config: Config = {
  title: "flow-state.dev",
  tagline: "Composable AI workflows for TypeScript. Blocks in. Streaming out.",
  favicon: "img/mark-paper.svg",

  url: "https://flow-state.dev",
  baseUrl: "/",

  organizationName: "fixpoint-labs",
  projectName: "flow-state-dev",

  onBrokenLinks: "throw",
  onBrokenAnchors: "throw",

  markdown: {
    hooks: {
      onBrokenMarkdownLinks: "warn",
    },
  },

  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },

  presets: [
    [
      "classic",
      {
        docs: {
          sidebarPath: "./sidebars.ts",
          editUrl:
            "https://github.com/fixpoint-labs/flow-state-dev/tree/main/implementation/apps/docs/",
        },
        // Blog is intentionally unlisted, not disabled: posts still build and
        // /blog/* stays reachable (e.g. the philosophy post), but the navbar
        // and footer links are removed. Don't "fix" this by re-adding nav
        // items — remove this block entirely if the blog should be dropped.
        blog: {
          showReadingTime: true,
          editUrl:
            "https://github.com/fixpoint-labs/flow-state-dev/tree/main/implementation/apps/docs/",
        },
        theme: {
          customCss: "./src/css/custom.css",
        },
        // Diagrams are SVGs imported into MDX and inlined through SVGR, so
        // they read the page's tokens and fonts (see src/components/Figure).
        // `cleanupIds` would shorten every id to "a", "b"…, which collide
        // between two figures on one page; `prefixIds` prefixes each id with
        // its file's name instead. Class names are left alone: they are the
        // page's drawing classes. `descProp` lets a figure pass its long
        // description as the SVG's <desc>. Any <title> is stripped, as the
        // brand lint requires: the figure's caption names the drawing.
        svgr: {
          svgrConfig: {
            descProp: true,
            svgoConfig: {
              plugins: [
                {
                  name: "preset-default",
                  params: {
                    overrides: {
                      removeTitle: true,
                      removeViewBox: false,
                      cleanupIds: false,
                    },
                  },
                },
                { name: "prefixIds", params: { prefixClassNames: false } },
                // Defence in depth behind the brand lint's ban: no script reaches the page.
                { name: "removeScriptElement" },
              ],
            },
          },
        },
      } satisfies Preset.Options,
    ],
  ],

  plugins: [
    // Every address of the site before its five sections lands on the page that holds its
    // topic, and every earlier Upgrading page on the current one (see redirects.mjs).
    ["@docusaurus/plugin-client-redirects", { redirects }],
    // The generated API reference: one section per published package, built from
    // the doc comments in the `.d.ts` files each package publishes, at
    // `/docs/reference/api/<slug>`. Generated into `.api-reference/` at each build and never
    // committed; the Reference sidebar links each section. FSD_API_REFERENCE_SKIP_TYPES=1
    // skips the packages' types build when the caller has just run it.
    [
      "./scripts/api-reference/plugin.mjs",
      { id: "api", path: ".api-reference", routeBasePath: "docs/reference/api" },
    ],
    // The docs as text for a coding agent: every docs page's Markdown at its URL plus `.md`,
    // and `/llms.txt` listing them by sidebar section. `full` names the sections
    // `/llms-full.txt` holds: Start, Concepts and the hand-written Reference.
    [
      "./scripts/agent-docs/plugin.mjs",
      {
        full: [
          "Start",
          "Concepts",
          "The model",
          "Running it",
          "Getting work done",
          "Building blocks",
          "State, data and the stream",
          "Reference: Running it",
          "Reference: Getting work done",
          "File formats",
          "Tools for building",
          "The site's own pages",
        ],
      },
    ],
  ],

  themeConfig: {
    ...(algolia && { algolia }),
    // The Algolia crawler reads this to verify we own the domain it crawls.
    metadata: [
      { name: "algolia-site-verification", content: "9C3EE12F53D419A7" },
    ],
    navbar: {
      title: "flow-state.dev",
      logo: {
        alt: "flow-state.dev logo",
        src: "img/flow-state-paper.svg",
        srcDark: "img/flow-state-night.svg",
      },
      items: [
        { type: "docSidebar", sidebarId: "startSidebar", position: "left", label: "Start" },
        { type: "docSidebar", sidebarId: "conceptsSidebar", position: "left", label: "Concepts" },
        { type: "docSidebar", sidebarId: "catalogSidebar", position: "left", label: "Catalog" },
        { type: "docSidebar", sidebarId: "buildSidebar", position: "left", label: "Build" },
        { type: "docSidebar", sidebarId: "referenceSidebar", position: "left", label: "Reference" },
        {
          href: "https://github.com/fixpoint-labs/flow-state-dev",
          label: "GitHub",
          position: "right",
        },
      ],
    },
    footer: {
      style: "light",
      links: [
        {
          title: "Docs",
          items: [
            { label: "What Flow State is", to: "/docs/start/what-flow-state-is" },
            { label: "Run a starter", to: "/docs/start/run-a-starter" },
            { label: "How it fits together", to: "/docs/concepts/how-it-fits-together" },
            { label: "Catalog", to: "/docs/catalog/" },
          ],
        },
        {
          title: "Learn",
          items: [
            { label: "Your first flow", to: "/docs/build/your-first-flow" },
            { label: "Choose where to deploy", to: "/docs/build/deploy" },
            { label: "Reference", to: "/docs/reference/blocks" },
          ],
        },
        {
          title: "More",
          items: [
            {
              label: "GitHub",
              href: "https://github.com/fixpoint-labs/flow-state-dev",
            },
          ],
        },
      ],
      copyright: `Copyright ${new Date().getFullYear()} Fixpoint Labs, LLC. Built with Docusaurus.`,
    },
    prism: {
      theme: inkTheme,
      darkTheme: inkTheme,
      additionalLanguages: ["bash", "json"],
    },
    colorMode: {
      defaultMode: "light",
      respectPrefersColorScheme: true,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
