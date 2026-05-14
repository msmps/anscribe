import "@anscribe/opentui/react/preload";
import "@anscribe/mcp/sink";

import { Anscribe } from "@anscribe/opentui/react";
import { createCliRenderer } from "@opentui/core";
import { createRoot, useKeyboard, useRenderer } from "@opentui/react";

// Deliberately incomplete welcome screen for the Anscribe announcement demo.
// Enter Capture Mode (ctrl+g), select targets, write instructions, then hand
// off to an agent through MCP. The agent edits this file to complete each
// section — the recursive joke is that the demo IS the product's onboarding
// screen, and the agent ships it live on camera.

function App() {
  return (
    <>
      <Anscribe keybinding="ctrl+g" />
      <QuitHandler />
      <Shell />
    </>
  );
}

function Shell() {
  return (
    <box
      id="anscribe-shell"
      flexDirection="column"
      flexGrow={1}
      padding={1}
      gap={1}
      border
      title="Anscribe"
    >
      <Hero />
      <FeatureCards />
      <KeysCheatSheet />
      <GetStartedButton />
    </box>
  );
}

function Hero() {
  return <text id="hero" content="welcome." height={1} />;
}

function FeatureCards() {
  return (
    <box id="feature-cards" flexDirection="row" gap={2}>
      <CaptureCard />
      <InspectCard />
      <HandoffCard />
    </box>
  );
}

function CaptureCard() {
  return (
    <box id="capture-card" border title="Capture" width={24} padding={1}>
      <text content="TODO" />
    </box>
  );
}

function InspectCard() {
  return (
    <box id="inspect-card" border title="Inspect" width={24} padding={1}>
      <text content="TODO" />
    </box>
  );
}

function HandoffCard() {
  return (
    <box id="handoff-card" border title="Handoff" width={24} padding={1}>
      <text content="TODO" />
    </box>
  );
}

function KeysCheatSheet() {
  return <text id="keys" content="Keys: ctrl+g" height={1} />;
}

function GetStartedButton() {
  return <text id="get-started" content="[ Get Started ]" height={1} />;
}

function QuitHandler() {
  const renderer = useRenderer();

  useKeyboard((key) => {
    // Ignore "q" while a renderable like the capture instruction draft owns
    // focus — otherwise typing the letter would quit mid-draft.
    if (key.name === "q" && renderer.currentFocusedRenderable === null) {
      renderer.destroy();
    }
  });

  return null;
}

const renderer = await createCliRenderer({ exitOnCtrlC: true, useMouse: true });
createRoot(renderer).render(<App />);
