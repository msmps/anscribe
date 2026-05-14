import type { CliRenderer } from "@opentui/core";
import { CaptureMetadataEnrichment } from "@anscribe/core";
import {
  installCaptureWithEnrichment,
  type CaptureInstallation,
  type InstallCaptureOptions,
} from "./internal/install";

export type {
  Capture,
  CaptureId,
  CaptureMetadata,
  CaptureSink,
  CaptureStatus,
} from "@anscribe/core";
export type {
  CapturedTarget,
  CapturedTargetId,
  IsoTimestamp,
  SourceReference,
  TerminalCellBounds,
} from "@anscribe/core";
export type { CaptureInstallation, InstallCaptureOptions } from "./internal/install";

export function installCapture(
  renderer: CliRenderer,
  options: InstallCaptureOptions = {},
): CaptureInstallation {
  return installCaptureWithEnrichment(renderer, options, CaptureMetadataEnrichment.live);
}
