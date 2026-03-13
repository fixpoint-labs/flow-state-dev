import { themes as prismThemes } from "prism-react-renderer";
import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";

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

  themeConfig: {
    navbar: {
      title: "flow-state.dev",
      logo: {
        alt: "flow-state.dev logo",
        src: "img/logo.png",
      },
      items: [
        {
          type: "docSidebar",
          sidebarId: "docsSidebar",
          position: "left",
          label: "Docs",
        },
        { to: "/blog", label: "Blog", position: "left" },
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
              to: "/docs/tutorials/building-a-chat-app",
            },
            { label: "Server Setup", to: "/docs/server/setup" },
            {
              label: "React Integration",
              to: "/docs/client/react",
            },
          ],
        },
        {
          title: "More",
          items: [
            { label: "Blog", to: "/blog" },
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
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ["bash", "json"],
    },
    colorMode: {
      defaultMode: "dark",
      respectPrefersColorScheme: true,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
