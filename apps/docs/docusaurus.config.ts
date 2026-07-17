import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";
import { earthyDark, earthyLight } from "./src/prismThemes";

const config: Config = {
  title: "flow-state.dev",
  tagline: "Composable AI workflows for TypeScript. Blocks in. Streaming out.",
  favicon: "img/favicon.ico",

  url: "https://flow-state.dev",
  baseUrl: "/",

  organizationName: "fixpoint-labs",
  projectName: "flow-state-dev",

  onBrokenLinks: "throw",

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
  ],

  themeConfig: {
    navbar: {
      title: "flow-state.dev",
      logo: {
        alt: "flow-state.dev logo",
        src: "img/mark-color.svg"
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
      style: "dark",
      links: [
        {
          title: "Docs",
          items: [
            { label: "Introduction", to: "/docs/intro" },
            { label: "Quick Start", to: "/docs/getting-started/quick-start" },
            { label: "Fundamentals", to: "/docs/fundamentals/overview" },
          ],
        },
        {
          title: "Learn",
          items: [
            {
              label: "Building a Chat App",
              to: "/guides/building-a-chat-app",
            },
            { label: "Server Setup", to: "/docs/server/setup" },
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
      theme: earthyLight,
      darkTheme: earthyDark,
      additionalLanguages: ["bash", "json"],
    },
    colorMode: {
      defaultMode: "dark",
      respectPrefersColorScheme: true,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
