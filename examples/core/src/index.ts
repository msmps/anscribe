import "@anscribe/mcp/sink";

import { BoxRenderable, createCliRenderer, TextRenderable } from "@opentui/core";
import { installCapture } from "@anscribe/opentui";

const renderer = await createCliRenderer({ exitOnCtrlC: true, useMouse: true });

const shell = new BoxRenderable(renderer, {
  id: "anscribe-demo-shell",
  flexDirection: "column",
  flexGrow: 1,
  padding: 1,
  border: true,
  title: "Anscribe OpenTUI Core Demo",
});

const heading = new TextRenderable(renderer, {
  id: "demo-heading",
  content: "Capture this UI, add an instruction, then pull pending Captures through MCP.",
  height: 1,
});

const instructions = new TextRenderable(renderer, {
  id: "demo-instructions",
  content:
    "ctrl+g capture | tab navigate | space select | click select | a instruct | enter save | q quit",
  height: 2,
});

const settingsPanel = new BoxRenderable(renderer, {
  id: "settings-panel",
  flexDirection: "column",
  width: 54,
  height: 7,
  padding: 1,
  border: true,
  title: "Settings",
});

const statusLine = new TextRenderable(renderer, {
  id: "settings-status",
  content: "Status: unsaved preference changes",
  height: 1,
});

const saveAction = new TextRenderable(renderer, {
  id: "save-action",
  content: "Save",
  height: 1,
});

const demoStatus = new TextRenderable(renderer, {
  id: "anscribe-demo-status",
  content:
    "Press a inside Capture Mode, type an instruction, then press enter. Then run bun run mcp from this directory.",
  height: 2,
});

settingsPanel.add(statusLine);
settingsPanel.add(saveAction);
shell.add(heading);
shell.add(instructions);
shell.add(settingsPanel);
shell.add(demoStatus);
renderer.root.add(shell);

const capture = installCapture(renderer, {
  keybinding: "ctrl+g",
});

renderer.keyInput.on("keypress", async (key) => {
  if (key.name === "q") {
    cleanup();
    renderer.destroy();
  }
});

process.on("SIGINT", () => {
  cleanup();
  renderer.destroy();
});

function cleanup(): void {
  capture.dispose();
}
