// CLI parsing for the `anscribe-mcp` bin. Kept separate from the bin file so
// it can be unit-tested without spawning a process.

export type ParsedArgs =
  | { readonly kind: "run"; readonly projectRoot: string | undefined }
  | { readonly kind: "help" }
  | { readonly kind: "version" }
  | { readonly kind: "error"; readonly message: string };

const HELP_TEXT = `anscribe-mcp - MCP server for Anscribe Captures

Usage:
  anscribe-mcp [options]

Options:
  -p, --project <path>   Project root for the Capture Store. Defaults to
                         $ANSCRIBE_PROJECT_ROOT, then process.cwd().
  -h, --help             Show this help message.
  -v, --version          Print the version.

Environment:
  ANSCRIBE_PROJECT_ROOT  Project root (overridden by --project).

The server reads pending Captures from <projectRoot>/.anscribe/captures.sqlite
and exposes the list_pending_captures and resolve_capture MCP tools over stdio.
`;

export const helpText = (): string => HELP_TEXT;

/**
 * Parse the `anscribe-mcp` bin's argv. Pure function so we can unit-test the
 * precedence and error reporting without spawning a child process.
 *
 * Precedence between `--project` and `ANSCRIBE_PROJECT_ROOT` is resolved by
 * the caller, not here — this parser only reports what was passed on the CLI.
 */
export const parseArgs = (argv: readonly string[]): ParsedArgs => {
  let projectRoot: string | undefined;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;

    if (arg === "--help" || arg === "-h") {
      return { kind: "help" };
    }

    if (arg === "--version" || arg === "-v") {
      return { kind: "version" };
    }

    if (arg === "--project" || arg === "-p") {
      const value = argv[index + 1];

      if (value === undefined || value.startsWith("-")) {
        return { kind: "error", message: "--project requires a path argument" };
      }

      projectRoot = value;
      index++;
      continue;
    }

    if (arg.startsWith("--project=")) {
      const value = arg.slice("--project=".length);

      if (value.length === 0) {
        return { kind: "error", message: "--project requires a path argument" };
      }

      projectRoot = value;
      continue;
    }

    return { kind: "error", message: `unknown argument: ${arg}` };
  }

  return { kind: "run", projectRoot };
};

/**
 * Resolve the project root the bin should hand to `CaptureStore.layer`.
 *
 * Precedence: CLI `--project` > `ANSCRIBE_PROJECT_ROOT` env > undefined
 * (the layer then falls back to `process.cwd()`).
 */
export const resolveProjectRootFromEnv = (
  parsed: Extract<ParsedArgs, { kind: "run" }>,
  env: Readonly<Record<string, string | undefined>>,
): string | undefined => {
  if (parsed.projectRoot !== undefined) {
    return parsed.projectRoot;
  }

  const envValue = env["ANSCRIBE_PROJECT_ROOT"];

  return envValue !== undefined && envValue.length > 0 ? envValue : undefined;
};
