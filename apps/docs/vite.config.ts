import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

function injectAgentInstructions(): Plugin {
  return {
    name: "anscribe-inject-agent-instructions",
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        const llmsTxt = readFileSync(resolve(import.meta.dirname, "public/llms.txt"), "utf8");
        const escaped = llmsTxt
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");
        const block = `<div style="display:none" aria-hidden="true" data-agent-instructions="true">${escaped}</div>`;
        return html.replace("<body>", `<body>\n${block}`);
      },
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), injectAgentInstructions()],
});
