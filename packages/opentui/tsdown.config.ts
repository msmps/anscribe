import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    react: "src/react/index.ts",
    "react/preload": "src/react/preload.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
});
