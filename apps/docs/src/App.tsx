import { useState } from "react";

const GITHUB_URL = "https://github.com/msmps/anscribe";
const EXAMPLES_URL = "https://github.com/msmps/anscribe/tree/main/examples";
const LLMS_TXT_URL = "/llms.txt";

const SELECT_KEYBINDINGS: Array<{ keys: string[]; description: string }> = [
  { keys: ["ctrl", "g"], description: "Enter Capture Mode" },
  { keys: ["tab"], description: "Next selectable renderable" },
  { keys: ["shift", "tab"], description: "Previous renderable" },
  { keys: ["space"], description: "Toggle current selection" },
  { keys: ["backspace"], description: "Deselect current target" },
  { keys: ["a"], description: "Open instruction draft" },
  { keys: ["esc"], description: "Exit Capture Mode" },
];

const DRAFT_KEYBINDINGS: Array<{ keys: string[]; description: string }> = [
  { keys: ["enter"], description: "Save pending Capture" },
  { keys: ["esc"], description: "Cancel draft, keep selection" },
];

const AGENT_PROMPT = "fetch https://anscribe.dev to install anscribe in your terminal app";

const INSTALL_SNIPPET = `bun add @anscribe/opentui`;

const SETUP_SNIPPET = `import { installCapture } from "@anscribe/opentui";
import { createCliRenderer } from "@opentui/core";

const renderer = await createCliRenderer({
  exitOnCtrlC: true,
  useMouse: true,
});

const capture = installCapture(renderer, {
  keybinding: "ctrl+g",
});

// On shutdown: capture.dispose() (sync) or await capture.close().`;

const MCP_OPT_IN_SNIPPET = `// 1. bun add @anscribe/mcp
// 2. Side-effect import registers the SQLite sink in @anscribe/core's
//    shared registry before installCapture snapshots it.
import "@anscribe/mcp/sink";

import { installCapture } from "@anscribe/opentui";

const capture = installCapture(renderer, {
  keybinding: "ctrl+g",
});`;

const REACT_SNIPPET = `import "@anscribe/opentui/react/preload";

import { Anscribe } from "@anscribe/opentui/react";
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";

const renderer = await createCliRenderer({
  exitOnCtrlC: true,
  useMouse: true,
});

function App() {
  return (
    <>
      <Anscribe keybinding="ctrl+g" />
      <text id="save-action" content="Save" />
    </>
  );
}

createRoot(renderer).render(<App />);`;

const REACT_MCP_SNIPPET = `import "@anscribe/opentui/react/preload";
import "@anscribe/mcp/sink";

import { Anscribe } from "@anscribe/opentui/react";

<Anscribe keybinding="ctrl+g" />`;

const MCP_REGISTER_SNIPPET = `npx add-mcp @anscribe/mcp`;

const MCP_MANUAL_SNIPPET = `{
  "mcpServers": {
    "anscribe": {
      "command": "anscribe-mcp"
    }
  }
}`;

const MCP_PROJECT_SNIPPET = `# Override the project the server reads from
anscribe-mcp --project /path/to/project

# Or via env var (CLI flag wins)
ANSCRIBE_PROJECT_ROOT=/path/to/project anscribe-mcp`;

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : "Copy to clipboard"}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        });
      }}
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-subtle transition-colors hover:bg-surface-2 hover:text-fg-soft"
    >
      {copied ? (
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.25"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="9" y="9" width="13" height="13" rx="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}

function AgentPromptBlock({ command }: { command: string }) {
  return (
    <div className="flex items-center overflow-hidden rounded-lg border border-border bg-surface shadow-card">
      <div className="shrink-0 pl-1.5">
        <CopyButton text={command} />
      </div>
      <div className="flex-1 overflow-x-auto px-3 py-2 font-mono text-[13px] leading-[1.65] whitespace-nowrap text-fg-soft select-all">
        {command}
      </div>
    </div>
  );
}

function CodeBlock({ code, language }: { code: string; language?: string }) {
  return (
    <div className="group relative overflow-hidden rounded-lg border border-border bg-surface shadow-card">
      <div className="flex items-center justify-between border-b border-divider px-3 py-1.5">
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-subtle">
          {language ?? "bash"}
        </span>
        <CopyButton text={code} />
      </div>
      <pre className="overflow-x-auto px-4 py-3 font-mono text-[13px] leading-[1.65] text-fg-soft">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function SectionHeading({
  id,
  num,
  children,
}: {
  id: string;
  num: string;
  children: React.ReactNode;
}) {
  return (
    <h2
      id={id}
      className="group scroll-mt-12 flex items-baseline gap-3 text-[18px] font-semibold tracking-[-0.01em] text-fg"
    >
      <span className="font-mono text-[12px] font-medium text-accent">
        {num}
      </span>
      <a href={`#${id}`} className="hover:text-fg">
        {children}
      </a>
    </h2>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-[12.5px] text-fg-soft">
      {children}
    </code>
  );
}

function KeyList({
  items,
}: {
  items: Array<{ keys: string[]; description: string }>;
}) {
  return (
    <ul className="flex flex-col rounded-lg border border-border bg-surface shadow-card">
      {items.map((kb, i) => (
        <li
          key={kb.description}
          className={`flex items-center justify-between gap-4 px-4 py-2.5 ${
            i === 0 ? "" : "border-t border-divider"
          }`}
        >
          <span className="flex flex-wrap items-center gap-1">
            {kb.keys.map((k, idx) => (
              <span key={`${k}-${idx}`} className="flex items-center gap-1">
                {idx > 0 && <span className="text-[11px] text-subtle">+</span>}
                <kbd className="kbd">{k}</kbd>
              </span>
            ))}
          </span>
          <span className="text-right text-[13px] text-fg-soft">
            {kb.description}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Logo() {
  return (
    <span
      aria-hidden="true"
      className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-surface font-mono text-[12px] font-semibold text-accent shadow-card"
    >
      a
    </span>
  );
}

export function App() {
  return (
    <div className="flex min-h-svh flex-col items-center bg-bg text-fg">
      <main className="flex w-full max-w-[640px] flex-col px-5 sm:px-0">
        {/* Hero */}
        <section className="mt-16 flex flex-col">
          <div className="flex items-center gap-2.5">
            <Logo />
            <h1 className="text-[20px] font-semibold tracking-tight text-fg">
              anscribe
            </h1>
          </div>

          <p className="mt-4 text-[17px] leading-[1.55] text-fg-soft">
            Capture live UI from your terminal app and hand it to an agent.{" "}
            <span className="font-semibold text-fg">
              Select, annotate, paste or pull through MCP
              <span className="caret" />
            </span>
          </p>
        </section>

        {/* Start capturing */}
        <section className="mt-12 flex flex-col gap-3">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-subtle">
            start capturing
          </h2>
          <p className="-mt-1 text-[13px] leading-[1.55] text-muted">
            Copy this and give it to your agent.
          </p>
          <AgentPromptBlock command={AGENT_PROMPT} />
        </section>

        {/* Install */}
        <section className="mt-12 flex flex-col gap-3">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-subtle">
            install
          </h2>
          <CodeBlock code={INSTALL_SNIPPET} />

          <div className="mt-1 flex flex-wrap items-center gap-2">
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3.5 py-1.5 text-[13px] font-medium text-fg-soft shadow-card transition-colors hover:border-subtle hover:text-fg"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56v-1.96c-3.2.7-3.87-1.54-3.87-1.54-.52-1.33-1.27-1.69-1.27-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.76 2.68 1.25 3.34.96.1-.74.4-1.25.72-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.05 0 0 .96-.31 3.15 1.18a10.95 10.95 0 0 1 5.74 0c2.19-1.49 3.15-1.18 3.15-1.18.62 1.59.23 2.76.11 3.05.73.81 1.18 1.84 1.18 3.1 0 4.42-2.7 5.39-5.27 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.68.8.56C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5Z" />
              </svg>
              GitHub
            </a>
            <a
              href={EXAMPLES_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3.5 py-1.5 text-[13px] font-medium text-fg-soft shadow-card transition-colors hover:border-subtle hover:text-fg"
            >
              <span className="font-mono text-[12px] text-accent">↓</span>
              examples
            </a>
            <a
              href={LLMS_TXT_URL}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3.5 py-1.5 text-[13px] font-medium text-fg-soft shadow-card transition-colors hover:border-subtle hover:text-fg"
            >
              <span className="font-mono text-[12px] text-accent">→</span>
              hand off to agent
            </a>
          </div>
        </section>

        {/* Docs body */}
        <article className="mt-16 mb-12 flex flex-col gap-12">
          <section className="flex flex-col gap-3">
            <SectionHeading id="capture-mode" num="01">
              OpenTUI Capture Mode
            </SectionHeading>
            <p className="text-[15px] leading-[1.65] text-fg-soft">
              Install Anscribe inside an OpenTUI app and pass the renderer to{" "}
              <Code>installCapture</Code>.
            </p>
            <CodeBlock code={SETUP_SNIPPET} language="ts" />
            <p className="text-[15px] leading-[1.65] text-muted">
              Out of the box, each committed Capture is written to the system
              clipboard via OSC52 as a markdown payload ready to paste into any
              agent. OSC52 means it works over SSH, inside dev containers, and
              on terminals without native bindings or permission prompts — zero
              configuration, zero filesystem footprint.
            </p>
            <p className="text-[15px] leading-[1.65] text-muted">
              <Code>installCapture(renderer, options?)</Code> options:{" "}
              <Code>keybinding</Code> (default <Code>ctrl+g</Code>),{" "}
              <Code>highlightColor</Code> hex for the current target, and{" "}
              <Code>selectedColor</Code> hex for selected targets. The returned
              handle exposes <Code>dispose()</Code> (sync) and{" "}
              <Code>close()</Code> (async); call one on shutdown. Additional
              destinations for committed Captures register themselves through a
              side-effect import — see{" "}
              <a
                href="#mcp"
                className="text-fg-soft underline decoration-divider underline-offset-2 hover:text-fg"
              >
                MCP
              </a>{" "}
              below.
            </p>

            <div className="mt-3 flex flex-col gap-2">
              <h3 className="font-mono text-[11px] uppercase tracking-[0.18em] text-subtle">
                opt in to the MCP queue
              </h3>
              <CodeBlock code={MCP_OPT_IN_SNIPPET} language="ts" />
              <p className="text-[13px] leading-[1.55] text-muted">
                The side-effect import{" "}
                <Code>import &quot;@anscribe/mcp/sink&quot;</Code> registers the
                SQLite Capture Store sink in <Code>@anscribe/core</Code>&apos;s
                shared registry before <Code>installCapture</Code> snapshots
                it. On first capture commit Anscribe opens a project-local
                store at{" "}
                <Code>&lt;project&gt;/.anscribe/captures.sqlite</Code> and
                writes a <Code>.gitignore</Code> alongside it; an existing
                gitignore is preserved untouched.
              </p>
            </div>

            <div className="mt-3 flex flex-col gap-2">
              <h3 className="font-mono text-[11px] uppercase tracking-[0.18em] text-subtle">
                custom destinations
              </h3>
              <p className="text-[13px] leading-[1.55] text-muted">
                Need to write captures to a webhook, a file, or somewhere else?
                Implement the <Code>CaptureSink</Code> interface from{" "}
                <Code>@anscribe/core</Code> and register it via{" "}
                <Code>registerCaptureSink</Code> from the same package. The
                same registry powers <Code>@anscribe/mcp/sink</Code> under the
                hood — see the{" "}
                <a
                  href="https://www.npmjs.com/package/@anscribe/core"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-fg-soft underline decoration-divider underline-offset-2 hover:text-fg"
                >
                  <Code>@anscribe/core</Code>
                </a>{" "}
                README for the full sink surface.
              </p>
            </div>
          </section>

          <section className="flex flex-col gap-4">
            <SectionHeading id="keybindings" num="02">
              Keybindings
            </SectionHeading>
            <p className="text-[15px] leading-[1.65] text-muted">
              While Capture Mode is active, Anscribe consumes input and draws a
              translucent overlay on the highlighted renderable. Normal app
              input resumes on exit. With mouse input enabled, a left-click
              selects the renderable under the pointer.
            </p>

            <div className="flex flex-col gap-2">
              <h3 className="font-mono text-[11px] uppercase tracking-[0.18em] text-subtle">
                selecting targets
              </h3>
              <KeyList items={SELECT_KEYBINDINGS} />
              <p className="text-[13px] leading-[1.55] text-muted">
                Aliases: next also accepts <Code>↓</Code>, <Code>→</Code>,{" "}
                <Code>j</Code>; previous accepts <Code>↑</Code>, <Code>←</Code>,{" "}
                <Code>k</Code>; toggle also accepts <Code>enter</Code>; exit
                also accepts <Code>q</Code>; deselect also accepts{" "}
                <Code>delete</Code>.
              </p>
            </div>

            <div className="mt-2 flex flex-col gap-2">
              <h3 className="font-mono text-[11px] uppercase tracking-[0.18em] text-subtle">
                drafting an instruction
              </h3>
              <KeyList items={DRAFT_KEYBINDINGS} />
              <p className="text-[13px] leading-[1.55] text-muted">
                After <Code>a</Code> opens the in-app prompt, the focused input
                owns every keystroke until you submit or cancel. Capture Mode
                stays active after saving so you can create another Capture.
              </p>
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <SectionHeading id="react" num="03">
              React Enrichment
            </SectionHeading>
            <p className="text-[15px] leading-[1.65] text-fg-soft">
              React OpenTUI apps get the same workflow through a headless{" "}
              <Code>{`<Anscribe />`}</Code> component. Import{" "}
              <Code>@anscribe/opentui/react/preload</Code> before{" "}
              <Code>@opentui/react</Code> so Anscribe installs its React
              DevTools hook before OpenTUI React creates its renderer.
            </p>
            <CodeBlock code={REACT_SNIPPET} language="tsx" />
            <p className="text-[15px] leading-[1.65] text-muted">
              <Code>{`<Anscribe />`}</Code> renders nothing. It reads the
              current renderer via <Code>useRenderer()</Code>, installs Capture
              Mode on mount, and disposes on unmount. Props mirror{" "}
              <Code>installCapture</Code> options. To opt in to the MCP queue,
              add the side-effect import alongside the preload:
            </p>
            <CodeBlock code={REACT_MCP_SNIPPET} language="tsx" />
            <p className="text-[15px] leading-[1.65] text-muted">
              If the preload is missing or imported late, Capture Mode still
              works — only React metadata is absent, and the component warns
              once in development.
            </p>
          </section>

          <section className="flex flex-col gap-3">
            <SectionHeading id="mcp" num="04">
              MCP Server (opt-in)
            </SectionHeading>
            <p className="text-[15px] leading-[1.65] text-fg-soft">
              When you add <Code>import &quot;@anscribe/mcp/sink&quot;</Code> to
              your entry file, every committed Capture is additionally written
              to a project-local SQLite store. The bundled{" "}
              <Code>anscribe-mcp</Code> stdio server reads pending Captures from
              that store and exposes them to your agent. Install with{" "}
              <Code>bun add @anscribe/mcp</Code>, then register the server with
              your agent.
            </p>

            <div className="flex flex-col gap-2">
              <h3 className="font-mono text-[11px] uppercase tracking-[0.18em] text-subtle">
                register with your agent
              </h3>
              <CodeBlock code={MCP_REGISTER_SNIPPET} />
              <p className="text-[13px] leading-[1.55] text-muted">
                <a
                  href="https://github.com/neondatabase/add-mcp"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-fg-soft underline decoration-divider underline-offset-2 hover:text-fg"
                >
                  <Code>add-mcp</Code>
                </a>{" "}
                auto-detects supported agents (Claude Code, Cursor, opencode,
                and others) and writes the <Code>anscribe</Code> entry into each
                agent&apos;s config. Or paste this snippet into your
                agent&apos;s MCP config manually:
              </p>
              <CodeBlock code={MCP_MANUAL_SNIPPET} language="json" />
            </div>

            <div className="mt-2 flex flex-col gap-2">
              <h3 className="font-mono text-[11px] uppercase tracking-[0.18em] text-subtle">
                project resolution
              </h3>
              <p className="text-[13px] leading-[1.55] text-muted">
                <Code>anscribe-mcp</Code> reads pending Captures from{" "}
                <Code>&lt;projectRoot&gt;/.anscribe/captures.sqlite</Code>.
                Project root resolution: <Code>--project &lt;path&gt;</Code>{" "}
                wins over <Code>ANSCRIBE_PROJECT_ROOT</Code>, which wins over{" "}
                <Code>process.cwd()</Code>. The resolved paths are written to
                stderr on startup so you can confirm which store is in use.
              </p>
              <CodeBlock code={MCP_PROJECT_SNIPPET} />
            </div>

            <div className="mt-2 flex flex-col gap-2">
              <h3 className="font-mono text-[11px] uppercase tracking-[0.18em] text-subtle">
                tools
              </h3>
              <p className="text-[13px] leading-[1.55] text-muted">
                <Code>list_pending_captures</Code> — returns pending Captures
                with their developer instruction and selected targets (type,
                terminal-cell bounds, ancestry, visible content, runtime
                metadata, optional source references).
              </p>
              <p className="text-[13px] leading-[1.55] text-muted">
                <Code>resolve_capture</Code> — takes{" "}
                <Code>{`{ captureId: string }`}</Code> and marks the Capture
                resolved.
              </p>
            </div>
          </section>
        </article>
      </main>

      <footer className="mt-auto flex w-full max-w-[640px] flex-col px-5 pb-12 sm:px-0">
        <div className="flex items-center gap-5 border-t border-divider pt-6 text-[13px]">
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted transition-colors hover:text-fg"
          >
            GitHub
          </a>
          <a
            href={EXAMPLES_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted transition-colors hover:text-fg"
          >
            Examples
          </a>
          <a
            href={LLMS_TXT_URL}
            className="text-muted transition-colors hover:text-fg"
          >
            llms.txt
          </a>
        </div>
      </footer>
    </div>
  );
}
