import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";
import { inkTheme } from "./src/prismThemes";

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
              ],
            },
          },
        },
      } satisfies Preset.Options,
    ],
  ],

  plugins: [
    [
      "@docusaurus/plugin-content-docs",
      {
        id: "guides",
        path: "guides",
        routeBasePath: "guides",
        sidebarPath: "./sidebarsGuides.ts",
        editUrl:
          "https://github.com/fixpoint-labs/flow-state-dev/tree/main/implementation/apps/docs/",
      },
    ],
    [
      // Keep old URLs alive so existing links don't 404.
      // Task Board and Flow Policy moved from /docs/patterns/* to
      // /docs/orchestration/* when the orchestration package was carved out.
      // Workers on disk moved from /docs/orchestration/* to /docs/workforce/*
      // when Workforce became its own top-level section. The Claude Code
      // `--remote` page was removed; its address points at the SDK agent.
      "@docusaurus/plugin-client-redirects",
      {
        redirects: [
          {
            from: "/docs/workforce/chief-of-staff",
            to: "/docs/workforce/shift-coordinator",
          },
          {
            from: "/docs/patterns/task-board",
            to: "/docs/orchestration/task-board",
          },
          {
            from: "/docs/patterns/flow-policy",
            to: "/docs/orchestration/flow-policy",
          },
          {
            from: "/docs/orchestration/workers-on-disk",
            to: "/docs/workforce/workers-on-disk",
          },
          {
            from: "/docs/skills/pattern-skills",
            to: "/docs/skills/overview",
          },
          {
            from: "/docs/advanced/utility-blocks-deprecated",
            to: "/docs/patterns/utility-blocks/core",
          },
          {
            from: "/docs/tools/claude-code-cli",
            to: "/docs/tools/claude-code-sdk",
          },
          {
            from: "/docs/workforce/channels",
            to: "/docs/workforce/coordinators",
          },
          {
            from: "/docs/workforce/mailboxes",
            to: "/docs/workforce/coordinators",
          },
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
        src: "img/mark-paper.svg",
        srcDark: "img/mark-night.svg",
      },
      items: [
        {
          type: "docSidebar",
          sidebarId: "docsSidebar",
          position: "left",
          label: "Docs",
        },
        {
          type: "docSidebar",
          sidebarId: "guidesSidebar",
          docsPluginId: "guides",
          position: "left",
          label: "Guides",
        },
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
            { label: "Introduction", to: "/docs/intro" },
            { label: "Installation", to: "/docs/getting-started/installation" },
            { label: "Quick Start", to: "/docs/getting-started/quick-start" },
            { label: "Fundamentals", to: "/docs/fundamentals/overview" },
          ],
        },
        {
          title: "Learn",
          items: [
            {
              label: "Anatomy of a Flow",
              to: "/guides/anatomy-of-a-flow",
            },
            {
              label: "Building a Chat App",
              to: "/guides/building-a-chat-app",
            },
            { label: "Engine setup", to: "/docs/server/setup" },
            { label: "Dev tools", to: "/docs/cli/overview" },
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
