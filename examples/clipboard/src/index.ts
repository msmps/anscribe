import { BoxRenderable, createCliRenderer, TextRenderable } from "@opentui/core";
import { installCapture } from "@anscribe/opentui";

const renderer = await createCliRenderer({ exitOnCtrlC: true, useMouse: true });

const shell = new BoxRenderable(renderer, {
  id: "anscribe-clipboard-demo-shell",
  flexDirection: "column",
  flexGrow: 1,
  padding: 1,
  border: true,
  title: "Anscribe Clipboard Demo",
});

const heading = new TextRenderable(renderer, {
  id: "demo-heading",
  content: "Capture this UI, type an instruction, paste the result into your agent.",
  height: 1,
});

const instructions = new TextRenderable(renderer, {
  id: "demo-instructions",
  content:
    "ctrl+g capture | tab navigate | space select | click select | a instruct | enter copy | q quit",
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
  id: "anscribe-clipboard-demo-status",
  content:
    "Press a inside Capture Mode and enter an instruction; on submit, the Capture lands on your system clipboard as markdown.",
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
