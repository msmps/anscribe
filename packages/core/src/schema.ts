import { Effect, Schema } from "effect";
import { customAlphabet } from "nanoid";

export const CaptureId = Schema.String.pipe(Schema.brand("CaptureId"));
export type CaptureId = typeof CaptureId.Type;

export const CapturedTargetId = Schema.String.pipe(Schema.brand("CapturedTargetId"));
export type CapturedTargetId = typeof CapturedTargetId.Type;

const generateNanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 12);

export const generateCaptureId = Effect.sync(() => CaptureId.make(generateNanoid()));

export const generateCapturedTargetId = Effect.sync(() => CapturedTargetId.make(generateNanoid()));

const isIsoTimestamp = Schema.makeFilter<string>((value) => {
  const hasTimestampShape =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value);

  return hasTimestampShape && parseIsoTimestampMillis(value) !== undefined
    ? true
    : "Expected ISO timestamp";
});

export function parseIsoTimestampMillis(value: string): number | undefined {
  const millis = Date.parse(value);

  return Number.isFinite(millis) ? millis : undefined;
}

export const IsoTimestamp = Schema.String.check(isIsoTimestamp).pipe(Schema.brand("IsoTimestamp"));
export type IsoTimestamp = typeof IsoTimestamp.Type;

export class CaptureValidationError extends Schema.TaggedErrorClass<CaptureValidationError>()(
  "CaptureValidationError",
  {
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Unknown),
  },
) {}

export class CapturePersistenceError extends Schema.TaggedErrorClass<CapturePersistenceError>()(
  "CapturePersistenceError",
  {
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Unknown),
  },
) {}

export class TerminalCellBounds extends Schema.Class<TerminalCellBounds>("TerminalCellBounds")({
  x: Schema.Finite,
  y: Schema.Finite,
  width: Schema.Finite,
  height: Schema.Finite,
}) {}

export class SourceReference extends Schema.Class<SourceReference>("SourceReference")({
  file: Schema.optionalKey(Schema.String),
  line: Schema.optionalKey(Schema.Finite),
  column: Schema.optionalKey(Schema.Finite),
  functionName: Schema.optionalKey(Schema.String),
  componentName: Schema.optionalKey(Schema.String),
  origin: Schema.optionalKey(Schema.String),
}) {}

export class CaptureMetadata extends Schema.Class<CaptureMetadata>("CaptureMetadata")({
  identifier: Schema.optionalKey(Schema.String),
  componentName: Schema.optionalKey(Schema.String),
  componentPath: Schema.optionalKey(Schema.String),
}) {}

export type CaptureStatus = "pending" | "resolved";

export const captureStatusSchema = Schema.Literals(["pending", "resolved"]);

export class CapturedTarget extends Schema.Class<CapturedTarget>("CapturedTarget")({
  id: CapturedTargetId,
  type: Schema.String,
  bounds: TerminalCellBounds,
  ancestry: Schema.Array(Schema.String),
  visibleContent: Schema.optionalKey(Schema.String),
  metadata: Schema.optionalKey(CaptureMetadata),
  sourceReferences: Schema.optionalKey(Schema.Array(SourceReference)),
}) {}

export class Capture extends Schema.Class<Capture>("Capture")({
  id: CaptureId,
  status: captureStatusSchema,
  createdAt: IsoTimestamp,
  instruction: Schema.optionalKey(Schema.String),
  targets: Schema.Array(CapturedTarget),
}) {}

export type CaptureInput = ConstructorParameters<typeof Capture>[0];

export const makeCapture = (input: CaptureInput) => decodeAnscribeDataEffect(Capture, input);

export function decodeAnscribeData<T>(schema: Schema.Schema<T>, input: unknown): T {
  try {
    return Schema.decodeUnknownSync(schema as Schema.Decoder<T>)(input) as T;
  } catch (cause) {
    throw new CaptureValidationError({ message: "Invalid Anscribe data", cause });
  }
}

export const decodeAnscribeDataEffect = <S extends Schema.Top>(schema: S, input: unknown) =>
  Schema.decodeUnknownEffect(schema)(input).pipe(
    Effect.mapError(
      (cause) => new CaptureValidationError({ message: "Invalid Anscribe data", cause }),
    ),
  );
