import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
  guidesSidebar: [
    "anatomy-of-a-flow",
    "building-a-chat-app",
    "nextjs-setup",
    "development-tips",
    "building-agents",
    "adding-skills-to-your-app",
    "projects-on-org-scope",
    "writing-ui-stories",
    {
      type: "category",
      label: "Deployment",
      items: [
        "deployment",
        "deploying-to-vercel",
        "deploying-to-railway",
        "deploying-with-docker",
      ],
    },
  ],
};

export default sidebars;
