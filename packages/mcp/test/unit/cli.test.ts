import { describe, expect, test } from "vitest";
import { parseArgs, resolveProjectRootFromEnv } from "../../src/cli";

describe("parseArgs", () => {
  test("returns run with no projectRoot when argv is empty", () => {
    expect(parseArgs([])).toEqual({ kind: "run", projectRoot: undefined });
  });

  test("recognises --help and -h", () => {
    expect(parseArgs(["--help"])).toEqual({ kind: "help" });
    expect(parseArgs(["-h"])).toEqual({ kind: "help" });
  });

  test("recognises --version and -v", () => {
    expect(parseArgs(["--version"])).toEqual({ kind: "version" });
    expect(parseArgs(["-v"])).toEqual({ kind: "version" });
  });

  test("parses --project <path>", () => {
    expect(parseArgs(["--project", "/tmp/x"])).toEqual({
      kind: "run",
      projectRoot: "/tmp/x",
    });
  });

  test("parses -p <path>", () => {
    expect(parseArgs(["-p", "/tmp/x"])).toEqual({
      kind: "run",
      projectRoot: "/tmp/x",
    });
  });

  test("parses --project=<path>", () => {
    expect(parseArgs(["--project=/tmp/x"])).toEqual({
      kind: "run",
      projectRoot: "/tmp/x",
    });
  });

  test("errors when --project has no value", () => {
    expect(parseArgs(["--project"])).toEqual({
      kind: "error",
      message: "--project requires a path argument",
    });
  });

  test("errors when --project is followed by another flag", () => {
    expect(parseArgs(["--project", "--help"])).toEqual({
      kind: "error",
      message: "--project requires a path argument",
    });
  });

  test("errors when --project= is empty", () => {
    expect(parseArgs(["--project="])).toEqual({
      kind: "error",
      message: "--project requires a path argument",
    });
  });

  test("errors on unknown arguments", () => {
    expect(parseArgs(["--unknown"])).toEqual({
      kind: "error",
      message: "unknown argument: --unknown",
    });
  });

  test("help short-circuits even when other flags are present", () => {
    expect(parseArgs(["--project", "/tmp/x", "--help"])).toEqual({ kind: "help" });
  });
});

describe("resolveProjectRootFromEnv", () => {
  test("CLI --project wins over env", () => {
    expect(
      resolveProjectRootFromEnv(
        { kind: "run", projectRoot: "/cli" },
        { ANSCRIBE_PROJECT_ROOT: "/env" },
      ),
    ).toBe("/cli");
  });

  test("falls back to env when CLI absent", () => {
    expect(
      resolveProjectRootFromEnv(
        { kind: "run", projectRoot: undefined },
        { ANSCRIBE_PROJECT_ROOT: "/env" },
      ),
    ).toBe("/env");
  });

  test("returns undefined when neither is set", () => {
    expect(resolveProjectRootFromEnv({ kind: "run", projectRoot: undefined }, {})).toBeUndefined();
  });

  test("treats empty env var as unset", () => {
    expect(
      resolveProjectRootFromEnv(
        { kind: "run", projectRoot: undefined },
        { ANSCRIBE_PROJECT_ROOT: "" },
      ),
    ).toBeUndefined();
  });
});
