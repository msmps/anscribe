import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    preload: "src/preload.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
});
