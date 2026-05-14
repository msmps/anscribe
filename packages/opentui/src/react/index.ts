import { CaptureMetadataEnrichment } from "@anscribe/core";
import { isReactRuntimeEnrichmentAvailable, reactMetadataEnricher } from "@anscribe/react";
import { useRenderer } from "@opentui/react";
import { useEffect } from "react";
import { installCaptureWithEnrichment, type InstallCaptureOptions } from "../internal/install";

let warnedReactPreloadUnavailable = false;
const reactEnrichmentLayer = CaptureMetadataEnrichment.layer(reactMetadataEnricher);
const isProductionEnv = readNodeEnv() === "production";

export function Anscribe(props: InstallCaptureOptions): null {
  const renderer = useRenderer();
  const { keybinding, highlightColor, selectedColor } = props;

  useEffect(() => {
    warnIfReactPreloadUnavailable();

    const capture = installCaptureWithEnrichment(
      renderer,
      { keybinding, highlightColor, selectedColor },
      reactEnrichmentLayer,
    );

    return () => {
      capture.dispose();
    };
  }, [keybinding, highlightColor, selectedColor, renderer]);

  return null;
}

function warnIfReactPreloadUnavailable(): void {
  if (warnedReactPreloadUnavailable || isProductionEnv) {
    return;
  }

  if (isReactRuntimeEnrichmentAvailable()) {
    return;
  }

  warnedReactPreloadUnavailable = true;
  const warn = globalThis.console["warn"];

  warn(
    'Anscribe React enrichment is unavailable. Import "@anscribe/opentui/react/preload" before "@opentui/react" to capture component metadata.',
  );
}

function readNodeEnv(): string | undefined {
  return (globalThis as { process?: { env?: { NODE_ENV?: string } } }).process?.env?.NODE_ENV;
}
