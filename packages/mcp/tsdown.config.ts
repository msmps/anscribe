import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    sink: "src/sink.ts",
    "anscribe-mcp": "bin/anscribe-mcp.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
});
