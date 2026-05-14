import { customAlphabet } from "nanoid";

// Single source of nanoid generator used to suffix host-owned renderable
// ids. Length-12 lowercase-alphanumeric matches the previous per-file
// declarations; keeping the format stable means existing telemetry / log
// scrapes that key on the prefix-suffix shape don't drift.
export const generateRenderableIdSuffix = customAlphabet(
  "0123456789abcdefghijklmnopqrstuvwxyz",
  12,
);
